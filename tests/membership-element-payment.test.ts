import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { addUtcDays, isBusinessMembershipPublic } from "@/lib/business-membership";
import { ensureMembershipElementPayment, getMembershipElementSnapshot, reconcileMembershipElementIntent, syncMembershipElementPayment } from "@/lib/membership-element-payment";
import { ensurePartnerRefundRepurchaseCommissionForPayment, ensurePartnerRenewalCommissionForPayment } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { attemptMembershipPaymentOutcomeDelivery } from "@/lib/membership-payment-outcomes";
import { retryPendingMembershipPaymentOutcomes } from "@/lib/membership-payment-outcomes";
import { createRefundFixture } from "./helpers/refund-fixture";
import { membershipStripeHarness } from "./helpers/membership-stripe-harness";

const priorStripeSecret = process.env.STRIPE_SECRET_KEY;
const priorStripePublishable = process.env.STRIPE_PUBLISHABLE_KEY;
process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_membership_only";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_membership_only";
const directory = mkdtempSync(join(tmpdir(), "salento-membership-element-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => {
  await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true });
  if (priorStripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = priorStripeSecret;
  if (priorStripePublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
  else process.env.STRIPE_PUBLISHABLE_KEY = priorStripePublishable;
});
let sequence = 0;
async function fixture() {
  const f = await createRefundFixture(prisma, `element-${++sequence}`);
  const h = membershipStripeHarness();
  const messages: Array<{ idempotencyKey?: string; to: string }> = [];
  const attemptOutcome = (paymentId: string) => attemptMembershipPaymentOutcomeDelivery(paymentId, {
    sendEmail: async (message) => {
      messages.push(message);
      return { messageId: `message-${messages.length}`, provider: "resend" as const, success: true };
    },
  });
  const dependencies = { stripe: h.stripe,
    renewalCommission: (args: Parameters<typeof ensurePartnerRenewalCommissionForPayment>[0]) => ensurePartnerRenewalCommissionForPayment(args, { revalidatePaths: () => {} }),
    repurchaseCommission: (args: Parameters<typeof ensurePartnerRefundRepurchaseCommissionForPayment>[0]) => ensurePartnerRefundRepurchaseCommissionForPayment(args, { revalidatePaths: () => {} }),
    attemptOutcome,
  };
  const prepare = (automaticRenewal = false) => ensureMembershipElementPayment({ businessId: f.business.id, userId: f.owner.id, automaticRenewal }, dependencies);
  return { f, h, dependencies, prepare, messages };
}

for (const delivery of ["return first", "webhook first", "concurrent return and webhook"]) {
  test(`manual renewal converges once: ${delivery}`, async () => {
    const { f, h, dependencies, prepare, messages } = await fixture();
    const payment = (await prepare())!;
    assert.equal(payment.purpose, "ANNUAL_RENEWAL"); assert.equal(payment.businessId, f.business.id);
    assert.equal(payment.stripeCheckoutSessionId, null);
    assert.equal((await prepare())?.id, payment.id); assert.equal(h.intents.size, 1);
    assert.equal(await syncMembershipElementPayment(payment.id, dependencies), null);
    h.succeed(payment);
    const webhook = { ...dependencies, eventId: `evt_test_${f.business.id}`, eventType: "payment_intent.succeeded" };
    if (delivery === "concurrent return and webhook") {
      await Promise.all([syncMembershipElementPayment(payment.id, dependencies), syncMembershipElementPayment(payment.id, webhook)]);
    } else {
      await syncMembershipElementPayment(payment.id, delivery === "webhook first" ? webhook : dependencies);
      await syncMembershipElementPayment(payment.id, delivery === "webhook first" ? dependencies : webhook);
    }
    await syncMembershipElementPayment(payment.id, webhook);
    const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
    assert.equal(membership.currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
    const commissions = await prisma.partnerCommission.findMany({ where: { businessId: f.business.id, type: "COMMISSION" } });
    assert.equal(commissions.filter((c) => c.amountCents === 5000).length, 1);
    assert.equal(commissions.filter((c) => c.amountCents === 1500).length, 1);
    assert.equal(await prisma.business.count({ where: { id: f.business.id } }), 1);
    assert.equal(messages.length, 1);
    assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: payment.id } }), 1);
  });
}

test("expired reactivation retains one Business and earns only the renewal commission", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { currentPeriodEnd: addUtcDays(new Date(), -20), graceEndsAt: addUtcDays(new Date(), -6) } });
  const payment = (await prepare())!; assert.equal(payment.purpose, "REACTIVATION");
  h.succeed(payment); const now = new Date();
  const result = await syncMembershipElementPayment(payment.id, { ...dependencies, now });
  assert.equal(result?.purpose, "REACTIVATION");
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  assert.equal(membership.currentPeriodStart.toISOString(), now.toISOString()); assert.ok(isBusinessMembershipPublic(membership));
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 5000 } }), 0);
});

test("completed self-service refund repurchase is classified only by the existing finalizer", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED", refundStatus: "succeeded", selfServiceRefundedAt: new Date() } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "REVERSED" } });
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { entitlementRevokedAt: new Date() } });
  const payment = (await prepare())!; assert.equal(payment.purpose, "REACTIVATION");
  h.succeed(payment);
  const result = await syncMembershipElementPayment(payment.id, dependencies);
  assert.equal(result?.purpose, "INITIAL_MEMBERSHIP");
  await syncMembershipElementPayment(payment.id, dependencies);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 5000 } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 0);
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: f.business.id } })).ownerUserId, f.owner.id);
  assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: payment.id } }), 1);
});

test("an embedded paid return stays confirmed when email fails, then retries without a second term or commission", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  const payment = (await prepare())!;
  h.succeed(payment);
  const keys: string[] = [];
  const failing = { ...dependencies, attemptOutcome: (paymentId: string) => attemptMembershipPaymentOutcomeDelivery(paymentId, {
    sendEmail: async (message) => { keys.push(message.idempotencyKey!); throw new Error("synthetic_provider_failure"); },
  }) };
  const result = await syncMembershipElementPayment(payment.id, failing);
  assert.ok(result);
  assert.equal(Boolean(result), true); // The return page uses this to show confirmation.
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "PAID");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 1);
  const pending = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: payment.id } });
  assert.equal(pending.acceptedAt, null);
  await syncMembershipElementPayment(payment.id, failing);
  assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: payment.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 1);
  assert.equal(keys.length, 1); // The duplicate sees the pending lease, then the job retries.
  const accepted = await retryPendingMembershipPaymentOutcomes({ now: new Date(pending.nextAttemptAt.getTime() + 1),
    sendEmail: async (message) => { keys.push(message.idempotencyKey!); return { messageId: "resend-retry", provider: "resend", success: true }; } });
  assert.deepEqual(accepted, { accepted: 1, due: 1 });
  assert.equal(keys[0], keys[1]);
  assert.ok((await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: payment.id } })).acceptedAt);
});

test("automatic renewal keeps exact subscription/invoice identity, one term, and recurring readiness", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  const payment = (await prepare(true))!;
  assert.ok(payment.stripeSubscriptionId); assert.ok(payment.stripeInvoiceId); assert.ok(payment.stripeCustomerId);
  assert.equal((await prepare(true))?.stripeSubscriptionId, payment.stripeSubscriptionId);
  assert.equal(h.subscriptions.size, 1); assert.equal(await prepare(false), null);
  assert.equal(await syncMembershipElementPayment(payment.id, dependencies), null);
  h.succeed(payment); await syncMembershipElementPayment(payment.id, dependencies);
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  assert.equal(membership.stripeSubscriptionId, payment.stripeSubscriptionId);
  assert.equal(membership.automaticRenewal, true); assert.equal(membership.recurringPaymentReady, true);
  assert.equal(await prepare(true), null); // Never create a second live subscription.
});

test("subscription cancellation already confirmed by Stripe is retained at finalization", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  const payment = (await prepare(true))!; h.succeed(payment);
  h.subscriptions.get(payment.stripeSubscriptionId!)!.cancel_at_period_end = true;
  await syncMembershipElementPayment(payment.id, dependencies);
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  assert.equal(membership.automaticRenewal, false); assert.equal(membership.stripeCancelAtPeriodEnd, true);
  assert.equal(membership.stripeSubscriptionId, payment.stripeSubscriptionId);
});

test("failure, processing, navigation and cancel cannot mark a membership paid", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  const payment = (await prepare())!;
  for (const status of ["requires_payment_method", "requires_action", "processing", "canceled"] as const) {
    h.intents.get(payment.stripePaymentIntentId!)!.status = status;
    assert.equal(await syncMembershipElementPayment(payment.id, dependencies), null);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), f.membership.currentPeriodEnd.toISOString());
  }
  const retry = (await prepare())!; assert.equal(retry.id, payment.id);
  assert.notEqual(retry.stripePaymentIntentId, payment.stripePaymentIntentId); assert.equal(retry.stripeSetupGeneration, 1);
  h.succeed(retry); await syncMembershipElementPayment(retry.id, dependencies);
});

test("provider metadata and amount tampering fail closed", async () => {
  const { h, dependencies, prepare } = await fixture(); const payment = (await prepare())!;
  h.succeed(payment); const intent = h.intents.get(payment.stripePaymentIntentId!)!;
  intent.amount_received = 9999; assert.equal(await syncMembershipElementPayment(payment.id, dependencies), null);
  intent.amount_received = 10000; intent.metadata.businessId = "other";
  await assert.rejects(syncMembershipElementPayment(payment.id, dependencies), /intent_mismatch/);
});

test("subscription invoice or annual price mismatch cannot finalize", async () => {
  const { h, dependencies, prepare } = await fixture(); const payment = (await prepare(true))!;
  h.succeed(payment); h.subscriptions.get(payment.stripeSubscriptionId!)!.items.data[0].price.unit_amount = 9999;
  await assert.rejects(getMembershipElementSnapshot(payment, dependencies), /subscription_mismatch/);
});

test("unresolved refund and outstanding bank transfer block a parallel card payment", async () => {
  const { f, h, prepare } = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "pending" } });
  assert.equal(await prepare(), null); assert.equal(h.intents.size, 0);
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: null, refundStatus: null } });
  await prisma.payment.create({ data: { businessId: f.business.id, businessSubmissionId: f.submission.id, userId: f.owner.id,
    amountCents: 10000, purpose: "ANNUAL_RENEWAL", method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER" } });
  assert.equal(await prepare(), null); assert.equal(h.intents.size, 0);
});

test("historical unpaid Checkout is expired while its audit record remains", async () => {
  const { f, h, prepare } = await fixture();
  const historical = await prisma.payment.create({ data: { businessId: f.business.id, businessSubmissionId: f.submission.id, userId: f.owner.id,
    amountCents: 10000, purpose: "ANNUAL_RENEWAL", method: "STRIPE_CHECKOUT", status: "PENDING_PAYMENT", stripeCheckoutSessionId: "cs_test_historical" } });
  assert.ok(await prepare()); assert.equal(h.expireCount, 1);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: historical.id } })).stripeCheckoutSessionId, "cs_test_historical");
  h.setCheckout({ status: "complete", payment_status: "paid" });
  assert.equal(await prepare(), null);
});

test("one-time and subscription choices cannot both create a payable alternative", async () => {
  const { h, prepare } = await fixture(); await prepare();
  assert.equal(await prepare(true), null); assert.equal(h.subscriptions.size, 0);
});

test("every in-site payment uses the shared editable Italy default and dashboard authorization", () => {
  const form = readFileSync("src/components/account/no-email-payment-form.tsx", "utf8");
  assert.match(form, /defaultValues: \{ billingDetails: \{ address: \{ country: "IT" \} \} \}/);
  assert.doesNotMatch(form, /country: "never"|country: "CA"/);
  const action = readFileSync("src/app/(account)/membership-actions.ts", "utf8");
  assert.doesNotMatch(action, /ensureMembershipRenewalCheckout|redirect\(session.url\)/);
  assert.match(action, /canManageBusiness/);
  assert.match(readFileSync("src/app/(account)/dashboard/membership/payment/page.tsx", "utf8"), /canManageBusiness/);
});


test("a lost intent response replays once, fails closed beyond 23 hours, and supports exact recovery", async () => {
  const { f, h, dependencies } = await fixture();
  let fail = true;
  const paymentModel = new Proxy(prisma.payment, { get(target, key) {
    if (key !== "updateMany") return Reflect.get(target, key);
    return async (args: Parameters<typeof prisma.payment.updateMany>[0]) => {
      if (fail && args?.data.stripePaymentIntentId) { fail = false; throw new Error("synthetic_lost_response"); }
      return target.updateMany(args);
    };
  } });
  const db = new Proxy(prisma, { get(target, key) { return key === "payment" ? paymentModel : Reflect.get(target, key); } });
  const now = new Date();
  const params = { businessId: f.business.id, userId: f.owner.id };
  await assert.rejects(ensureMembershipElementPayment(params, { ...dependencies, db, now }), /lost_response/);
  assert.equal(h.intents.size, 1);
  await assert.rejects(ensureMembershipElementPayment(params, { ...dependencies, now: addUtcDays(now, 2) }), /reconciliation_required/);
  assert.equal(h.intents.size, 1);
  const pending = await prisma.payment.findFirstOrThrow({ where: { businessId: f.business.id, status: "PENDING_PAYMENT" } });
  assert.equal(pending.stripePaymentIntentId, null);
  await assert.rejects(syncMembershipElementPayment(pending.id, dependencies), /payment_mismatch/);
  const intentId = [...h.intents.keys()][0];
  await reconcileMembershipElementIntent({ paymentId: pending.id, intentId }, dependencies);
  assert.equal((await ensureMembershipElementPayment(params, dependencies))?.stripePaymentIntentId, intentId);
  assert.equal(h.intents.size, 1);
});

test("interrupted setup within the replay window creates one Stripe intent", async () => {
  const { f, h, dependencies } = await fixture(); let fail = true;
  const paymentModel = new Proxy(prisma.payment, { get(target, key) {
    if (key !== "updateMany") return Reflect.get(target, key);
    return async (args: Parameters<typeof prisma.payment.updateMany>[0]) => {
      if (fail && args?.data.stripePaymentIntentId) { fail = false; throw new Error("synthetic_lost_response"); }
      return target.updateMany(args);
    };
  } });
  const db = new Proxy(prisma, { get(target, key) { return key === "payment" ? paymentModel : Reflect.get(target, key); } });
  const params = { businessId: f.business.id, userId: f.owner.id };
  await assert.rejects(ensureMembershipElementPayment(params, { ...dependencies, db }), /lost_response/);
  const payment = await ensureMembershipElementPayment(params, dependencies);
  assert.ok(payment?.stripePaymentIntentId); assert.equal(h.intents.size, 1);
});


test("future cycle invoices retain recurring authority and cancellation on the same subscription", async () => {
  const { f, h, dependencies, prepare } = await fixture();
  const payment = (await prepare(true))!; h.succeed(payment);
  await syncMembershipElementPayment(payment.id, dependencies);
  const paid = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  const invoice = { amountPaidCents: 10000, db: prisma, method: "STRIPE_CHECKOUT" as const,
    paidAt: paid.currentPeriodEnd, subscriptionId: payment.stripeSubscriptionId,
    invoiceId: `in_cycle_${f.business.id}`, paymentIntentId: `pi_cycle_${f.business.id}` };
  await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...invoice, db }));
  await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...invoice, db }));
  const after = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  assert.equal(after.currentPeriodEnd.toISOString(), addUtcDays(paid.currentPeriodEnd, 365).toISOString());
  assert.equal(after.automaticRenewal, true); assert.equal(after.recurringPaymentReady, true);
  assert.equal(after.stripeSubscriptionId, payment.stripeSubscriptionId);
  await prisma.businessMembership.update({ where: { id: after.id }, data: { automaticRenewal: false, recurringPaymentReady: false, stripeCancelAtPeriodEnd: true } });
  await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...invoice, db, paidAt: after.currentPeriodEnd,
    invoiceId: `in_last_cycle_${f.business.id}`, paymentIntentId: `pi_last_cycle_${f.business.id}` }));
  const canceled = await prisma.businessMembership.findUniqueOrThrow({ where: { id: after.id } });
  assert.equal(canceled.automaticRenewal, false); assert.equal(canceled.recurringPaymentReady, false);
  assert.equal(canceled.stripeCancelAtPeriodEnd, true);
});
