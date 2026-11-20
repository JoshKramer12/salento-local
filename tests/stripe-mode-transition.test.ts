import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import type { Payment } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureStripeBankTransferIntent, ensureStripeCheckoutSession } from "@/lib/stripe-checkout";
import { areRealPartnerDisbursementsAllowed, assertLivePaymentCreationScope, assertReusableStripeObjectMode, assertStripeSettlementMode, isPublicFinancialHold } from "@/lib/stripe";
import { beginEmbeddedPaymentOperation, ensureEmbeddedPaymentSubscription } from "@/lib/embedded-subscription";
import { ensureMembershipElementPayment } from "@/lib/membership-element-payment";
import { ensureMembershipRenewalBankTransferIntent, ensureMembershipRenewalCheckout } from "@/lib/membership-renewal-checkout";
import { ensureManualElementPaymentIntent } from "@/lib/no-email-payment";
import { POST as runMembershipCron } from "@/app/api/internal/membership-reminders/route";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";

const prior = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
  PUBLIC_LIVE_PAYMENTS_ENABLED: process.env.PUBLIC_LIVE_PAYMENTS_ENABLED,
  LIVE_PAYMENT_SCOPE: process.env.LIVE_PAYMENT_SCOPE,
  LIVE_PAYMENT_CANARY_SUBMISSION_ID: process.env.LIVE_PAYMENT_CANARY_SUBMISSION_ID,
  MEMBERSHIP_REMINDER_CRON_SECRET: process.env.MEMBERSHIP_REMINDER_CRON_SECRET,
};

test.after(() => {
  for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function liveMode() {
  process.env.STRIPE_SECRET_KEY = "sk_live_synthetic_only";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_synthetic_only";
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
}

const submission = {
  amountOwedCents: 10000,
  businessName: "Synthetic business",
  id: "submission-synthetic",
  ownerEmail: "owner@example.test",
  userId: "owner-synthetic",
};
const viewer = { id: "owner-synthetic", role: "BUSINESS_OWNER" as const, email: "owner@example.test" };

test("a live key cannot reuse an untagged or tagged-test provider object", () => {
  liveMode();
  assert.throws(() => assertReusableStripeObjectMode(null), /stripe_payment_mode_mismatch/);
  assert.throws(() => assertReusableStripeObjectMode(false), /stripe_payment_mode_mismatch/);
  assert.doesNotThrow(() => assertReusableStripeObjectMode(true));
});

test("live Checkout transition stops before any provider read or mutation for a legacy pending session", async () => {
  liveMode();
  let providerCalls = 0;
  const stripe = { checkout: { sessions: {
    retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
    create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
  } } } as unknown as Stripe;
  const db = { payment: { findFirst: async () => ({ id: "pending-old", stripeCheckoutSessionId: "cs_test_old", stripeLivemode: null }) } } as unknown as typeof prisma;
  await assert.rejects(() => ensureStripeCheckoutSession({ submission, viewer }, { db, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("live bank-transfer transition stops before creating a customer or intent for a legacy pending intent", async () => {
  liveMode();
  let providerCalls = 0;
  const stripe = {
    paymentIntents: {
      retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
      create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
    },
    customers: { create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } },
  } as unknown as Stripe;
  const db = { payment: { findFirst: async () => ({ id: "pending-bank-old", stripePaymentIntentId: "pi_test_old", stripeLivemode: null }) } } as unknown as typeof prisma;
  await assert.rejects(() => ensureStripeBankTransferIntent({ submission, viewer }, { db, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("live embedded setup rejects an untagged historical operation before a provider call", async () => {
  liveMode();
  let providerCalls = 0;
  const payment = {
    id: "initial-element:synthetic", status: "PENDING_PAYMENT", stripeLivemode: null,
    stripeSetupOperation: "product", stripeSetupStartedAt: new Date(), stripeSetupGeneration: 0,
  } as unknown as Payment;
  const stripe = { products: { create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } } } as unknown as Stripe;
  await assert.rejects(() => ensureEmbeddedPaymentSubscription(payment, {
    businessName: "Synthetic", ownerEmail: "owner@example.test", ownerName: "Owner", ownerPhone: "",
    flow: "INITIAL_SUBSCRIPTION_ELEMENT", metadata: { businessSubmissionId: "submission-synthetic", paymentId: payment.id },
  }, { db: prisma, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("a fresh live embedded operation records mode before any provider request", async () => {
  liveMode();
  let recorded: unknown;
  const db = { payment: { updateMany: async (args: { data: unknown }) => { recorded = args.data; return { count: 1 }; } } } as unknown as typeof prisma;
  const payment = {
    id: "initial-element:fresh", status: "PENDING_PAYMENT", stripeLivemode: null,
    stripeSetupOperation: null, stripeSetupStartedAt: null, stripeSetupGeneration: 0,
  } as unknown as Payment;
  const claimed = await beginEmbeddedPaymentOperation(db, payment, "product", new Date());
  assert.equal((recorded as { stripeLivemode: boolean }).stripeLivemode, true);
  assert.equal(claimed.stripeLivemode, true);
});

test("live automatic renewal does not read a historical stored subscription", async () => {
  liveMode();
  let providerCalls = 0;
  const membership = {
    automaticRenewal: false, entitlementRevokedAt: null, stripeSubscriptionId: "sub_test_old",
    business: { name: "Synthetic", submissions: [{ id: "submission-synthetic", ownerEmail: "owner@example.test" }] },
  };
  const db = {
    businessMembership: { findUnique: async () => membership },
    payment: { findFirst: async () => null },
  } as unknown as typeof prisma;
  const stripe = { subscriptions: { retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } } } as unknown as Stripe;
  const result = await ensureMembershipElementPayment({ businessId: "business-synthetic", userId: "owner-synthetic", automaticRenewal: true }, { db, stripe });
  assert.equal(result, null);
  assert.equal(providerCalls, 0);
});

test("live manual renewal stops before using a historical customer or subscription", async () => {
  liveMode();
  let providerCalls = 0;
  const membership = {
    businessId: "business-synthetic", automaticRenewal: true, stripeCustomerId: "cus_test_old",
    stripeSubscriptionId: "sub_test_old", business: { name: "Synthetic", submissions: [{ id: "submission-synthetic", ownerEmail: "owner@example.test" }] },
  };
  const db = { businessMembership: { findUnique: async () => membership }, payment: { findFirst: async () => null } } as unknown as typeof prisma;
  const stripe = {
    checkout: { sessions: { create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } } },
    customers: { create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } },
    paymentIntents: { create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } },
  } as unknown as Stripe;
  const params = { businessId: "business-synthetic", userId: "owner-synthetic" };
  await assert.rejects(() => ensureMembershipRenewalCheckout(params, { db, stripe }), /stripe_payment_mode_mismatch/);
  await assert.rejects(() => ensureMembershipRenewalBankTransferIntent(params, { db, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("live renewal refuses an untagged pending Checkout or bank intent before provider access", async () => {
  liveMode();
  let providerCalls = 0;
  const membership = {
    businessId: "business-synthetic", automaticRenewal: false, stripeCustomerId: null,
    stripeSubscriptionId: null, business: { name: "Synthetic", submissions: [{ id: "submission-synthetic", ownerEmail: "owner@example.test" }] },
  };
  const db = {
    businessMembership: { findUnique: async () => membership },
    payment: { findFirst: async (args: { where: { purpose?: unknown; method?: string } }) =>
      args.where.purpose === "INITIAL_MEMBERSHIP" ? null : { id: "pending-old", stripeCheckoutSessionId: "cs_test_old", stripePaymentIntentId: "pi_test_old", stripeLivemode: null } },
  } as unknown as typeof prisma;
  const stripe = {
    checkout: { sessions: { retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } } },
    paymentIntents: { retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); } },
  } as unknown as Stripe;
  const params = { businessId: "business-synthetic", userId: "owner-synthetic" };
  await assert.rejects(() => ensureMembershipRenewalCheckout(params, { db, stripe }), /stripe_payment_mode_mismatch/);
  await assert.rejects(() => ensureMembershipRenewalBankTransferIntent(params, { db, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("a fresh live manual renewal records mode with its new Checkout session", async () => {
  liveMode();
  let recorded: unknown;
  const membership = {
    businessId: "business-synthetic", automaticRenewal: false, stripeCustomerId: null,
    stripeSubscriptionId: null, graceEndsAt: new Date(Date.now() + 86_400_000),
    business: { name: "Synthetic", submissions: [{ id: "submission-synthetic" }] },
  };
  const db = {
    businessMembership: { findUnique: async () => membership },
    payment: { findFirst: async () => null, create: async (args: { data: unknown }) => { recorded = args.data; return { id: "new-payment" }; } },
  } as unknown as typeof prisma;
  const stripe = { checkout: { sessions: { create: async () => ({ id: "cs_live_new", livemode: true, url: "https://checkout.stripe.com/synthetic" }) } } } as unknown as Stripe;
  const result = await ensureMembershipRenewalCheckout({ businessId: "business-synthetic", userId: "owner-synthetic", appUrl: "https://example.test" }, { db, stripe });
  assert.equal(result?.url, "https://checkout.stripe.com/synthetic");
  assert.equal((recorded as { stripeLivemode: boolean }).stripeLivemode, true);
});

test("live initial Payment Element refuses an untagged historical intent before provider access", async () => {
  liveMode();
  let providerCalls = 0;
  const submission = {
    id: "submission-synthetic", userId: "owner-synthetic", user: { role: "BUSINESS_OWNER" },
    ownerEmail: "owner@example.test", ownerPhone: "", automaticRenewalAtAcceptance: false,
    paymentMethod: "ONLINE", paymentStatus: "PENDING_PAYMENT", status: "AWAITING_PAYMENT",
    agreementSignature: "signed", signedAt: new Date(), businessTermsAcceptedAt: new Date(),
    amountOwedCents: 10000,
  };
  const payment = {
    id: "initial-element:submission-synthetic", status: "PENDING_PAYMENT", amountCents: 10000,
    currency: "eur", partnerUserId: null, userId: "owner-synthetic", stripeSubscriptionId: null,
    stripeInvoiceId: null, stripeCustomerId: null, stripePaymentIntentId: "pi_test_old", stripeLivemode: null,
  };
  const db = {
    businessSubmission: { findUnique: async () => submission },
    payment: { findFirst: async () => null, findMany: async () => [], upsert: async () => payment },
  } as unknown as typeof prisma;
  const stripe = { paymentIntents: {
    retrieve: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
    create: async () => { providerCalls++; throw new Error("provider_should_not_be_called"); },
  } } as unknown as Stripe;
  await assert.rejects(() => ensureManualElementPaymentIntent(submission.id, { db, stripe }), /stripe_payment_mode_mismatch/);
  assert.equal(providerCalls, 0);
});

test("fresh live initial Payment Element claims mode before provider creation", async () => {
  liveMode();
  const claims: unknown[] = [];
  const submission = {
    id: "submission-synthetic", userId: "owner-synthetic", user: { role: "BUSINESS_OWNER" },
    businessName: "Synthetic", ownerEmail: "owner@example.test", ownerPhone: "",
    automaticRenewalAtAcceptance: false, paymentMethod: "ONLINE", paymentStatus: "PENDING_PAYMENT",
    status: "AWAITING_PAYMENT", agreementSignature: "signed", signedAt: new Date(),
    businessTermsAcceptedAt: new Date(), amountOwedCents: 10000,
  };
  const payment = {
    id: "initial-element:submission-synthetic", status: "PENDING_PAYMENT", amountCents: 10000,
    currency: "eur", partnerUserId: null, userId: "owner-synthetic", stripeSubscriptionId: null,
    stripeInvoiceId: null, stripeCustomerId: null, stripePaymentIntentId: null, stripeLivemode: null,
  };
  const db = {
    businessSubmission: { findUnique: async () => submission },
    payment: { findFirst: async () => null, findMany: async () => [], upsert: async () => payment,
      updateMany: async (args: { data: unknown }) => { claims.push(args.data); return { count: 1 }; } },
  } as unknown as typeof prisma;
  const stripe = { paymentIntents: { create: async () => {
    assert.deepEqual(claims[0], { stripeLivemode: true });
    return { id: "pi_live_synthetic", livemode: true };
  } } } as unknown as Stripe;
  const result = await ensureManualElementPaymentIntent(submission.id, { db, stripe });
  assert.equal(result?.stripeLivemode, true);
  assert.equal(result?.stripePaymentIntentId, "pi_live_synthetic");
});

test("production LIVE canary permits one manual card submission and still blocks payouts", async () => {
  liveMode();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "true";
  delete process.env.LIVE_PAYMENT_SCOPE;
  assert.equal(isPublicFinancialHold(), true);
  process.env.LIVE_PAYMENT_SCOPE = "canary";
  assert.equal(isPublicFinancialHold(), true);
  process.env.LIVE_PAYMENT_CANARY_SUBMISSION_ID = "submission-allowed";
  assert.equal(isPublicFinancialHold(), false);
  assert.doesNotThrow(() => assertLivePaymentCreationScope("submission-allowed", "initial_card"));
  for (const [id, kind] of [
    ["submission-other", "initial_card"], ["submission-allowed", "initial_bank"],
    ["submission-allowed", "initial_recurring"], [null, "renewal"],
  ] as const) {
    assert.throws(() => assertLivePaymentCreationScope(id, kind), /live_payment_canary_scope_mismatch/);
  }
  assert.equal(areRealPartnerDisbursementsAllowed(), false);
  let dbCalls = 0;
  const db = { businessSubmission: { findUnique: async () => { dbCalls++; throw new Error("db_should_not_be_called"); } } } as unknown as typeof prisma;
  await assert.rejects(() => ensureManualElementPaymentIntent("submission-other", { db }), /live_payment_canary_scope_mismatch/);
  assert.equal(dbCalls, 0);
  process.env.LIVE_PAYMENT_SCOPE = "public";
  assert.equal(isPublicFinancialHold(), false);
  assert.equal(areRealPartnerDisbursementsAllowed(), true);
});

test("the existing membership cron does not retry historical TEST deliveries during a LIVE canary", async () => {
  liveMode();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "true";
  process.env.LIVE_PAYMENT_SCOPE = "canary";
  process.env.LIVE_PAYMENT_CANARY_SUBMISSION_ID = "submission-allowed";
  process.env.MEMBERSHIP_REMINDER_CRON_SECRET = "synthetic-cron-secret";
  const response = await runMembershipCron(new Request("https://example.test/api/internal/membership-reminders?outcomes=only", {
    method: "POST", headers: { authorization: "Bearer synthetic-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { pausedForLiveCanary: true });
});

test("closing payment creation still allows a verified LIVE settlement", async () => {
  liveMode();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "false";
  process.env.LIVE_PAYMENT_SCOPE = "canary";
  assert.equal(isPublicFinancialHold(), true);
  assert.doesNotThrow(() => assertStripeSettlementMode(true));
  assert.throws(() => assertStripeSettlementMode(false), /stripe_payment_mode_mismatch/);
  assert.throws(() => assertStripeSettlementMode(null), /stripe_payment_mode_mismatch/);
  const db = { businessMembership: { findFirst: async () => null } } as unknown as Parameters<typeof finalizeMembershipRenewalPayment>[0]["db"];
  assert.equal(await finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: "business-synthetic",
    db, method: "STRIPE_CHECKOUT", paidAt: new Date(), stripeLivemode: true }), null);
});
