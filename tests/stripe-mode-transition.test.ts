import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { ensureStripeBankTransferIntent, ensureStripeCheckoutSession } from "@/lib/stripe-checkout";
import { assertReusableStripeObjectMode } from "@/lib/stripe";

const prior = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  RAILWAY_ENVIRONMENT_NAME: process.env.RAILWAY_ENVIRONMENT_NAME,
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
