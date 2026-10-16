import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import { inspectMembershipRenewalRecovery } from "@/lib/membership-renewal-recovery";
import { prisma } from "@/lib/prisma";

const membership = {
  automaticRenewal: true, entitlementRevokedAt: null,
  stripeCustomerId: "cus_synthetic", stripeSubscriptionId: "sub_synthetic",
};
const subscription = {
  id: "sub_synthetic", customer: "cus_synthetic", status: "past_due",
  latest_invoice: "in_synthetic", cancel_at_period_end: false, livemode: false,
  payment_settings: { save_default_payment_method: "on_subscription" },
};
const invoice = {
  id: "in_synthetic", status: "open", customer: "cus_synthetic",
  parent: { subscription_details: { subscription: "sub_synthetic" } },
  billing_reason: "subscription_cycle", collection_method: "charge_automatically",
  currency: "eur", amount_due: 10000, livemode: false,
  hosted_invoice_url: "https://invoice.stripe.com/i/test_synthetic",
};

function dependencies(overrides: {
  membership?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
} = {}) {
  const db = { businessMembership: { findUnique: async () => ({ ...membership, ...overrides.membership }) } } as unknown as typeof prisma;
  const stripe = { subscriptions: { retrieve: async () => ({ ...subscription, ...overrides.subscription }) },
    invoices: { retrieve: async () => ({ ...invoice, ...overrides.invoice }) } } as unknown as Stripe;
  return { db, stripe, sandbox: true };
}

test("owner recovery points to the exact open Stripe-hosted renewal invoice", async () => {
  assert.deepEqual(await inspectMembershipRenewalRecovery("business_synthetic", dependencies()),
    { state: "ready", url: invoice.hosted_invoice_url });
});

test("a mismatched customer, subscription, amount, mode or URL blocks a second payment", async () => {
  for (const invalid of [
    { invoice: { customer: "cus_other" } },
    { invoice: { parent: { subscription_details: { subscription: "sub_other" } } } },
    { invoice: { amount_due: 20000 } },
    { invoice: { livemode: true } },
    { invoice: { hosted_invoice_url: "https://example.test/invoice" } },
    { subscription: { payment_settings: { save_default_payment_method: "off" } } },
    { subscription: { cancel_at_period_end: true } },
  ]) {
    assert.deepEqual(await inspectMembershipRenewalRecovery("business_synthetic", dependencies(invalid)),
      { state: "blocked" });
  }
});

test("a paid invoice or canceled subscription does not trigger another recovery payment", async () => {
  assert.deepEqual(await inspectMembershipRenewalRecovery("business_synthetic", dependencies({ invoice: { status: "paid" } })),
    { state: "none" });
  assert.deepEqual(await inspectMembershipRenewalRecovery("business_synthetic", dependencies({ subscription: { status: "canceled" } })),
    { state: "none" });
});
