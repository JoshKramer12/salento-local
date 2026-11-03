import assert from "node:assert/strict";
import test from "node:test";
import { runWeeklyPartnerPayouts } from "@/lib/partner-ledger";
import { cashoutRequestsEnabled, cashoutUiEnabled } from "@/lib/partner-cashout-view";
import { runPartnerWithdrawalWorker, withdrawalExecutionAllowed } from "@/lib/partner-withdrawal-processing";

const keys = [
  "RAILWAY_ENVIRONMENT_NAME", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY",
  "PUBLIC_LIVE_PAYMENTS_ENABLED", "PARTNER_CASHOUT_UI_ENABLED",
  "PARTNER_CASHOUT_REQUESTS_ENABLED", "PARTNER_WITHDRAWAL_PROCESSING_ENABLED",
  "PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED",
] as const;

test("request, worker, and legacy send gates fail closed and production test keys cannot disburse", async () => {
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    assert.equal(cashoutUiEnabled(), false);
    assert.equal(cashoutRequestsEnabled(), false);
    assert.equal(withdrawalExecutionAllowed(), false);
    assert.deepEqual(await runPartnerWithdrawalWorker(), { status: "paused", processed: 0 });
    assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped-payouts-disabled");

    process.env.PARTNER_CASHOUT_UI_ENABLED = "true";
    process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
    process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "true";
    process.env.PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED = "true";
    process.env.PUBLIC_LIVE_PAYMENTS_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_only";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_only";
    assert.equal(cashoutUiEnabled(), true);
    assert.equal(cashoutRequestsEnabled(), false);
    assert.equal(withdrawalExecutionAllowed(), false);
    assert.deepEqual(await runPartnerWithdrawalWorker(), { status: "paused", processed: 0 });
    assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped-payouts-disabled");

    process.env.RAILWAY_ENVIRONMENT_NAME = "stage4-isolated";
    delete process.env.PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED;
    assert.equal(cashoutRequestsEnabled(), true);
    assert.equal(withdrawalExecutionAllowed(), true);
    assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped-payouts-disabled");
    delete process.env.PARTNER_CASHOUT_REQUESTS_ENABLED;
    assert.equal(cashoutRequestsEnabled(), false);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
