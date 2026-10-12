import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getBusinessMembershipPeriod, getBusinessMembershipStatus } from "@/lib/business-membership";
import { getMembershipPaymentPurpose } from "@/lib/membership-renewal";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260914120000_add_business_membership/migration.sql", "utf8");
const sync = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const reminders = readFileSync("src/lib/membership-reminders.ts", "utf8");
const renewal = readFileSync("src/lib/membership-renewal-checkout.ts", "utf8");
const renewalFinalizer = readFileSync("src/lib/membership-renewal.ts", "utf8");
const claim = readFileSync("src/app/(account)/claim/page.tsx", "utf8");
const adminList = readFileSync("src/app/(account)/dashboard/admin/memberships/page.tsx", "utf8");
const adminDetail = readFileSync("src/app/(account)/dashboard/admin/memberships/[businessId]/page.tsx", "utf8");
const ledger = readFileSync("src/lib/partner-ledger.ts", "utf8");

test("polling retrieves a server-side subscription snapshot before the initial payment finalizer", () => {
  assert.match(sync, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(sync, /stripeCustomerId: typeof session\.customer/);
  assert.match(sync, /stripeSubscriptionId: subscriptionId/);
  assert.match(sync, /stripeSubscriptionStatus: subscription\?\.status/);
  assert.match(sync, /stripeCancelAtPeriodEnd: subscription\?\.cancel_at_period_end/);
});

test("webhook and polling carry the same subscription association fields", () => {
  assert.match(webhook, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
  assert.match(webhook, /stripeSubscriptionStatus: subscription\?\.status/);
  assert.match(sync, /ensureInitialBusinessMembership\([\s\S]*stripeSubscriptionId/);
});

test("initial subscription retries cannot create another paid term", () => {
  assert.match(sync, /stripeLastEventId/);
  assert.match(sync, /stripeCheckoutSessionId/);
  assert.match(sync, /stripePaymentIntentId/);
  assert.match(schema, /businessId\s+String\s+@unique/);
});

for (const deliveryOrder of [
  "webhook arrives first",
  "polling arrives first",
  "polling succeeds and webhook never arrives",
  "webhook arrives after polling",
  "polling occurs after webhook",
  "repeated polling",
  "duplicate webhook",
]) {
  test(`initial subscription delivery convergence: ${deliveryOrder}`, () => {
    // Both delivery mechanisms call the same finalizer. Its Payment lookup
    // and business-unique upsert are the convergence boundary, not delivery
    // order or a browser callback.
    assert.match(sync, /finalizeStripeManagedPayment/);
    assert.match(sync, /stripeCheckoutSessionId/);
    assert.match(sync, /stripePaymentIntentId/);
    assert.match(sync, /ensureInitialBusinessMembership/);
    assert.match(schema, /businessId\s+String\s+@unique/);
  });
}

test("an invoice renewal stores Stripe's current invoice payment-intent identity", () => {
  assert.match(webhook, /invoice\.payments\?\.data\.find/);
  assert.match(webhook, /paidPayment\?\.payment\.payment_intent/);
  assert.match(webhook, /paymentIntentId:/);
  assert.match(schema, /stripeInvoiceId\s+String\?\s+@unique/);
});

test("a renewal refund finds and reverses only its matching commission once", () => {
  assert.match(ledger, /stripePaymentIntentId/);
  assert.match(ledger, /commission:reversal:\$\{original\.id\}/);
  assert.match(ledger, /sourceKey: reversalKey/);
  assert.match(webhook, /charge\.amount_refunded >= charge\.amount/);
  assert.match(webhook, /reversePartnerCommissionForPayment/);
});

test("a dispute reverses commission only after Stripe confirms a lost outcome", () => {
  assert.match(webhook, /event\.type === "charge\.dispute\.closed"/);
  assert.match(webhook, /reconcilePartnerPaymentDispute\(event\.data\.object\.id, \{ stripe \}\)/);
  assert.match(webhook, /outcome\.status === "lost"/);
  assert.match(webhook, /reason: "payment_dispute_lost"/);
});

test("renewal refund keeps the original submission payment audit record intact", () => {
  assert.match(sync, /payment\.purpose === "INITIAL_MEMBERSHIP"/);
  assert.match(sync, /A renewal\/re-activation is a new membership payment/);
});

test("reminder idempotency is scoped to exact 365-day membership cycle", () => {
  assert.match(schema, /cycleEndsAt\s+DateTime/);
  assert.match(schema, /@@unique\(\[membershipId, cycleEndsAt, type\]\)/);
  assert.match(reminders, /cycleEndsAt: membership\.currentPeriodEnd/);
  assert.match(reminders, /membership\.currentPeriodEnd\.toISOString\(\)/);
  assert.match(migration, /"cycleEndsAt" DATETIME NOT NULL/);
  assert.match(migration, /MembershipReminder_membershipId_cycleEndsAt_type_key/);
});

test("two annual cycles deliberately have different reminder keys", () => {
  const first = getBusinessMembershipPeriod({ paidAt: new Date("2027-06-14T00:00:00.000Z") });
  const second = getBusinessMembershipPeriod({ currentPeriodEnd: first.currentPeriodEnd, graceEndsAt: first.graceEndsAt, paidAt: new Date("2028-05-20T00:00:00.000Z") });
  assert.notEqual(first.currentPeriodEnd.toISOString(), second.currentPeriodEnd.toISOString());
});

test("manual bank transfer is an isolated membership renewal flow", () => {
  assert.match(renewal, /ensureMembershipRenewalBankTransferIntent/);
  assert.match(renewal, /paymentFlow: "MEMBERSHIP_RENEWAL_BANK_TRANSFER"/);
  assert.match(renewal, /payment_method_types: \["customer_balance"\]/);
  assert.doesNotMatch(renewal.slice(renewal.indexOf("ensureMembershipRenewalBankTransferIntent")), /recurring:/);
});

test("pending bank instructions do not extend an active or grace membership", () => {
  assert.match(renewal, /status: "AWAITING_BANK_TRANSFER"/);
  assert.doesNotMatch(renewal.slice(renewal.indexOf("ensureMembershipRenewalBankTransferIntent")), /businessMembership\.update/);
  assert.match(webhook, /paymentFlow === "MEMBERSHIP_RENEWAL_BANK_TRANSFER"/);
  assert.match(webhook, /finalizeMembershipRenewalPayment/);
});

test("bank confirmation renews active or grace from period end and reactivates expired from paid time", () => {
  const end = new Date("2027-01-01T00:00:00.000Z");
  const grace = new Date("2027-01-15T00:00:00.000Z");
  assert.equal(getMembershipPaymentPurpose({ currentPeriodEnd: end, graceEndsAt: grace, now: new Date("2027-01-10") }), "ANNUAL_RENEWAL");
  assert.equal(getMembershipPaymentPurpose({ currentPeriodEnd: end, graceEndsAt: grace, now: new Date("2027-01-16") }), "REACTIVATION");
  assert.equal(getBusinessMembershipStatus({ currentPeriodEnd: end, graceEndsAt: grace, now: new Date("2027-01-16") }), "EXPIRED");
  assert.match(renewalFinalizer, /Use the authoritative confirmation time/);
  assert.match(renewalFinalizer, /purpose,/);
});

test("expired business lookup remains available only to owner access or admin", () => {
  assert.match(claim, /getPublicBusinessMembershipWhere/);
  assert.match(claim, /ownerUserId: viewer\.id/);
  assert.match(claim, /ownerAccesses: \{ some: \{ userId: viewer\.id \} \}/);
  assert.match(claim, /viewer\.role === "ADMIN"/);
});

test("admin membership inspection is explicitly read-only and includes operations details", () => {
  assert.match(adminList, /read only/);
  assert.match(adminList, /pastDue/);
  assert.match(adminList, /upcoming/);
  assert.match(adminDetail, /Payment history/);
  assert.match(adminDetail, /Partner commissions/);
  assert.doesNotMatch(`${adminList}\n${adminDetail}`, /update\(|delete\(|cancel_at_period_end/);
});
