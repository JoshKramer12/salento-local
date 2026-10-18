import assert from "node:assert/strict";
import test from "node:test";

import { assertPartnerPayoutHasOnlyLivePayments, runWeeklyPartnerPayouts } from "@/lib/partner-ledger";
import { createPaypalPayout } from "@/lib/partner-payout-methods";
import { areRealPartnerDisbursementsAllowed, isPublicFinancialHold } from "@/lib/stripe";

test("production test payments never open real Partner payout paths", async () => {
  const names = ["RAILWAY_ENVIRONMENT_NAME", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED", "PUBLIC_LIVE_PAYMENTS_ENABLED", "LIVE_PARTNER_PAYOUTS_ENABLED", "PAYPAL_MODE"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    process.env.STRIPE_SECRET_KEY = "sk_test_synthetic";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic";
    process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED = "true";
    process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "true";
    process.env.LIVE_PARTNER_PAYOUTS_ENABLED = "true";
    process.env.PAYPAL_MODE = "live";

    assert.equal(isPublicFinancialHold(), false);
    assert.equal(areRealPartnerDisbursementsAllowed(), false);
    assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped-payouts-disabled");
    let queried = false;
    await assert.rejects(assertPartnerPayoutHasOnlyLivePayments("historical-retry", {
      partnerPayout: { findUnique: async () => { queried = true; return null; } },
    } as never), /partner_real_payouts_paused/);
    assert.equal(queried, false);
    await assert.rejects(createPaypalPayout({ amountCents: 5000, payoutId: "test", recipientEmail: "synthetic@example.test" }), /partner_real_payouts_paused/);

    process.env.STRIPE_SECRET_KEY = "sk_live_synthetic";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_synthetic";
    process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "false";
    assert.equal(areRealPartnerDisbursementsAllowed(), false);
    process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "true";
    process.env.LIVE_PARTNER_PAYOUTS_ENABLED = "false";
    assert.equal(areRealPartnerDisbursementsAllowed(), false);
    process.env.LIVE_PARTNER_PAYOUTS_ENABLED = "true";
    assert.equal(areRealPartnerDisbursementsAllowed(), true);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
