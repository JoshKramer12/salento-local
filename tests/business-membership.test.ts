import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUSINESS_MEMBERSHIP_GRACE_DAYS,
  BUSINESS_MEMBERSHIP_PERIOD_DAYS,
  ensureInitialBusinessMembership,
  getBusinessMembershipPeriod,
  getBusinessMembershipStatus,
  isBusinessMembershipPublic,
} from "@/lib/business-membership";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { DEFAULT_COMMISSION_CENTS } from "@/lib/payment";
import { getMembershipPaymentPurpose, getPaymentPurposeLabel } from "@/lib/membership-renewal";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const paymentSync = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const bankTransferAction = readFileSync("src/app/(account)/actions.ts", "utf8");
const publishForm = readFileSync("src/components/account/publish-form.tsx", "utf8");
const publicData = readFileSync("src/lib/public-data.ts", "utf8");
const businessPage = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");
const townPage = readFileSync("src/app/towns/[slug]/page.tsx", "utf8");
const localityPage = readFileSync("src/app/localities/[slug]/page.tsx", "utf8");
const searchSuggestions = readFileSync("src/app/api/search-suggestions/route.ts", "utf8");
const ownerDashboard = readFileSync("src/components/account/business-owner-dashboard.tsx", "utf8");
const paymentSyncSource = readFileSync("src/lib/stripe-payment-sync.ts", "utf8");
const webhookRoute = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const renewalCheckout = readFileSync("src/lib/membership-renewal-checkout.ts", "utf8");
const renewalActions = readFileSync("src/app/(account)/membership-actions.ts", "utf8");

test("BusinessMembership is one-to-one with a business and independent of its owner", () => {
  assert.match(schema, /model BusinessMembership/);
  assert.match(schema, /businessId\s+String\s+@unique/);
  assert.match(schema, /membership\s+BusinessMembership\?/);
  assert.doesNotMatch(schema, /ownerUserId\s+String.*BusinessMembership/);
});

test("membership periods use exact 365-day paid terms and 14-day grace periods", () => {
  const paidAt = new Date("2026-01-01T12:00:00.000Z");
  const initial = getBusinessMembershipPeriod({ paidAt });

  assert.equal(BUSINESS_MEMBERSHIP_PERIOD_DAYS, 365);
  assert.equal(BUSINESS_MEMBERSHIP_GRACE_DAYS, 14);
  assert.equal(initial.currentPeriodStart.toISOString(), "2026-01-01T12:00:00.000Z");
  assert.equal(initial.currentPeriodEnd.toISOString(), "2027-01-01T12:00:00.000Z");
  assert.equal(initial.graceEndsAt.toISOString(), "2027-01-15T12:00:00.000Z");
  assert.equal(getBusinessMembershipStatus({ ...initial, now: new Date("2026-12-31T12:00:00.000Z") }), "ACTIVE");
  assert.equal(getBusinessMembershipStatus({ ...initial, now: initial.currentPeriodEnd }), "GRACE");
  assert.equal(getBusinessMembershipStatus({ ...initial, now: initial.graceEndsAt }), "EXPIRED");
});

test("renewals preserve the anniversary through active and grace periods, but expired reactivation starts at payment", () => {
  const currentPeriodEnd = new Date("2027-01-01T12:00:00.000Z");
  const graceEndsAt = new Date("2027-01-15T12:00:00.000Z");

  const earlyRenewal = getBusinessMembershipPeriod({
    currentPeriodEnd,
    graceEndsAt,
    paidAt: new Date("2026-12-10T12:00:00.000Z"),
  });
  const graceRenewal = getBusinessMembershipPeriod({
    currentPeriodEnd,
    graceEndsAt,
    paidAt: new Date("2027-01-10T12:00:00.000Z"),
  });
  const reactivation = getBusinessMembershipPeriod({
    currentPeriodEnd,
    graceEndsAt,
    paidAt: new Date("2027-01-16T12:00:00.000Z"),
  });

  assert.equal(earlyRenewal.currentPeriodStart.toISOString(), currentPeriodEnd.toISOString());
  assert.equal(graceRenewal.currentPeriodStart.toISOString(), currentPeriodEnd.toISOString());
  assert.equal(reactivation.currentPeriodStart.toISOString(), "2027-01-16T12:00:00.000Z");
});

test("public entitlement keeps active and grace businesses visible but removes expired or revoked memberships", () => {
  const now = new Date("2027-01-10T12:00:00.000Z");
  assert.equal(isBusinessMembershipPublic({ graceEndsAt: new Date("2027-01-15T00:00:00.000Z"), now }), true);
  assert.equal(isBusinessMembershipPublic({ graceEndsAt: now, now }), false);
  assert.equal(isBusinessMembershipPublic({ graceEndsAt: new Date("2027-02-01T00:00:00.000Z"), entitlementRevokedAt: now, now }), false);
  assert.equal(isBusinessMembershipPublic({ now }), true);
});

test("one owner can have active, grace, and expired memberships independently", () => {
  const now = new Date("2027-01-10T12:00:00.000Z");
  assert.equal(getBusinessMembershipStatus({ currentPeriodEnd: new Date("2027-02-01T00:00:00.000Z"), graceEndsAt: new Date("2027-02-15T00:00:00.000Z"), now }), "ACTIVE");
  assert.equal(getBusinessMembershipStatus({ currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"), graceEndsAt: new Date("2027-01-15T00:00:00.000Z"), now }), "GRACE");
  assert.equal(getBusinessMembershipStatus({ currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"), graceEndsAt: new Date("2026-12-15T00:00:00.000Z"), now }), "EXPIRED");
});

function createMembershipDb(role: "BUSINESS_OWNER" | "GETTER") {
  const memberships = new Map<string, Record<string, unknown>>();
  const db = {
    businessMembership: {
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown>; where: { businessId: string } }) => {
        const existing = memberships.get(args.where.businessId);
        if (existing) return existing;
        memberships.set(args.where.businessId, args.create);
        return args.create;
      },
    },
    businessSubmission: {
      findUnique: async () => ({ user: { id: "partner_or_owner", role } }),
    },
  };

  return { db, memberships };
}

test("initial payment creates one membership per business and webhook or sync retries do not shift the period", async () => {
  const { db, memberships } = createMembershipDb("GETTER");
  const paidAt = new Date("2026-04-01T00:00:00.000Z");

  await ensureInitialBusinessMembership({
    businessId: "business-a",
    db: db as never,
    paidAt,
    submissionId: "submission-a",
  });
  await ensureInitialBusinessMembership({
    businessId: "business-a",
    db: db as never,
    paidAt: new Date("2026-04-02T00:00:00.000Z"),
    submissionId: "submission-a",
  });
  await ensureInitialBusinessMembership({
    businessId: "business-b",
    db: db as never,
    paidAt,
    submissionId: "submission-b",
  });

  assert.equal(memberships.size, 2);
  assert.equal(memberships.get("business-a")?.annualPriceCents, 10000);
  assert.equal(memberships.get("business-a")?.originatingPartnerUserId, "partner_or_owner");
  assert.equal(memberships.get("business-a")?.currentPeriodStart instanceof Date, true);
  assert.equal((memberships.get("business-a")?.currentPeriodStart as Date).toISOString(), paidAt.toISOString());
  assert.equal(memberships.get("business-b")?.businessId, "business-b");
});

test("owner-originated memberships have no originating Partner", async () => {
  const { db, memberships } = createMembershipDb("BUSINESS_OWNER");

  await ensureInitialBusinessMembership({
    businessId: "owner-business",
    db: db as never,
    paidAt: new Date("2026-04-01T00:00:00.000Z"),
    submissionId: "owner-submission",
  });

  assert.equal(memberships.get("owner-business")?.originatingPartnerUserId, null);
});

test("annual membership pricing is €100 while the initial Partner commission remains €50", () => {
  assert.equal(LISTING_OFFER.annualPriceCents, 10000);
  assert.equal(LISTING_OFFER.renewalPriceCents, 10000);
  assert.equal(DEFAULT_COMMISSION_CENTS, 5000);
});

test("initial payment finalizers create the membership without changing QR or Checkout mechanics", () => {
  assert.match(paymentSync, /ensureInitialBusinessMembership/);
  assert.match(bankTransferAction, /ensureInitialBusinessMembership/);
  assert.match(publishForm, /<PaymentChoiceButton method="ONLINE"/);
  assert.match(publishForm, /<PaymentChoiceButton method="BANK_TRANSFER"/);
  assert.match(publishForm, /Mostra QR di pagamento/);
  assert.match(publishForm, /Show payment QR/);
});

test("public discovery and direct pages enforce membership eligibility on the server", () => {
  for (const source of [publicData, townPage, localityPage, searchSuggestions]) {
    assert.match(source, /getPublicBusinessMembershipWhere/);
  }
  assert.match(businessPage, /findFirst\(\{[\s\S]*getPublicBusinessMembershipWhere/);
  assert.match(businessPage, /if \(!business\) \{\s*notFound\(\);/);
  assert.match(publicData, /PUBLIC_DATA_REVALIDATE_SECONDS = 0/);
});

test("expired-business enforcement preserves business records, owner access, and membership-specific owner status UI", () => {
  assert.doesNotMatch(paymentSyncSource, /business\.delete|businessSubmission\.delete|ownerAccess.*delete/i);
  assert.match(ownerDashboard, /ACTIVE/);
  assert.match(ownerDashboard, /PAYMENT DUE/);
  assert.match(ownerDashboard, /INACTIVE/);
  assert.match(ownerDashboard, /Active until/);
  assert.match(ownerDashboard, /Grace period ends/);
  assert.match(ownerDashboard, /Expired on/);
  assert.match(ownerDashboard, /Your business information is still saved/);
});

test("only full refunds and confirmed lost disputes revoke public membership entitlement", () => {
  assert.match(webhookRoute, /revokeMembershipEntitlement: charge\.amount_refunded >= charge\.amount/);
  assert.match(webhookRoute, /event\.type === "charge\.dispute\.closed"/);
  assert.match(webhookRoute, /dispute\.status === "lost"/);
  assert.match(paymentSyncSource, /entitlementRevokedAt: new Date\(\)/);
});

test("old €50 business-renewal and first-year-only offer copy is absent", () => {
  const customerOfferSources = [
    readFileSync("src/components/account/publish-form.tsx", "utf8"),
    readFileSync("src/components/account/partner-first-run-onboarding.tsx", "utf8"),
    readFileSync("src/app/earn/page.tsx", "utf8"),
    readFileSync("src/lib/receipts.ts", "utf8"),
  ].join("\n");

  assert.doesNotMatch(customerOfferSources, /€50\/(?:year|anno)/i);
  assert.doesNotMatch(customerOfferSources, /then\s+(?:just\s+)?€50/i);
  assert.doesNotMatch(customerOfferSources, /poi\s+(?:solo\s+)?€50/i);
  assert.doesNotMatch(customerOfferSources, /no automatic renewal/i);
  assert.doesNotMatch(customerOfferSources, /nessun rinnovo automatico/i);
});

test("renewal lifecycle labels active/grace as annual renewal and expired as reactivation", () => {
  assert.equal(getMembershipPaymentPurpose({ currentPeriodEnd: new Date("2027-01-10"), graceEndsAt: new Date("2027-01-24"), now: new Date("2027-01-09") }), "ANNUAL_RENEWAL");
  assert.equal(getMembershipPaymentPurpose({ currentPeriodEnd: new Date("2027-01-10"), graceEndsAt: new Date("2027-01-24"), now: new Date("2027-01-25") }), "REACTIVATION");
  assert.equal(getPaymentPurposeLabel("INITIAL_MEMBERSHIP", "en"), "Initial membership");
  assert.equal(getPaymentPurposeLabel("ANNUAL_RENEWAL", "it"), "Rinnovo annuale");
});

test("renewal Checkout and webhooks are isolated from the Partner initial QR flow", () => {
  assert.match(schema, /enum PaymentPurpose[\s\S]*ANNUAL_RENEWAL[\s\S]*REACTIVATION/);
  assert.match(schema, /stripeInvoiceId\s+String\?\s+@unique/);
  assert.match(renewalCheckout, /paymentFlow: "MEMBERSHIP_RENEWAL"/);
  assert.match(renewalCheckout, /mode: automaticRenewal \? "subscription" : "payment"/);
  assert.match(webhookRoute, /event\.type === "invoice\.paid"/);
  assert.match(webhookRoute, /invoice\.billing_reason === "subscription_create"/);
  assert.match(webhookRoute, /finalizeMembershipRenewalPayment/);
  assert.doesNotMatch(renewalCheckout, /ensurePartnerCommission|publishSubmissionAfterPayment/);
});

test("owner controls use cancel-at-period-end and never claim a card-less subscription is enabled", () => {
  assert.match(renewalActions, /cancel_at_period_end: true/);
  assert.match(renewalActions, /cancel_at_period_end: false/);
  assert.match(renewalActions, /automaticRenewal: true/);
  assert.match(readFileSync("src/components/account/auto-renew-cancel-control.tsx", "utf8"), /Turn off automatic renewal/);
  assert.match(ownerDashboard, /Turn on automatic renewal/);
  assert.match(publishForm, /Automatic annual renewal/);
  assert.match(publishForm, /Renew manually/);
  assert.match(readFileSync("src/app/(account)/actions.ts", "utf8"), /Choose automatic or manual renewal before continuing/);
});
