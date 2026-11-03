import assert from "node:assert/strict";
import test from "node:test";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";
import { sandboxWithdrawalExecutionAllowed, withdrawalPaymentLivemode } from "@/lib/partner-withdrawal-sandbox-context";

const isolated = {
  STAGE5A_ISOLATED_SANDBOX: "salento-stage5a-connect",
  DATABASE_URL: "file:/tmp/salento-stage5a-isolated.example/sandbox.db",
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  STRIPE_PUBLISHABLE_KEY: "pk_test_synthetic",
  STAGE5A_EXPECTED_ACCOUNT_ID: "acct_synthetic",
};

test("Stage 5A preflight requires distinct local, test-mode, account-bound inputs", () => {
  assert.equal(assertStage5aSandboxIsolation(isolated).accountId, "acct_synthetic");
  const changes = [
    { STAGE5A_ISOLATED_SANDBOX: undefined },
    { DATABASE_URL: "file:/srv/production.db" },
    { DATABASE_URL: "file:/tmp/salento-stage5a-isolated.example/../production.db" },
    { STRIPE_SECRET_KEY: "sk_live_synthetic" },
    { STRIPE_SECRET_KEY: "rkcs_test_limited" },
    { STRIPE_PUBLISHABLE_KEY: "pk_live_synthetic" },
    { STAGE5A_EXPECTED_ACCOUNT_ID: undefined },
    { NODE_ENV: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { RAILWAY_PROJECT_ID: "hosted-project" },
    { PUBLIC_LIVE_PAYMENTS_ENABLED: "true" },
    { PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED: "true" },
    { PARTNER_WITHDRAWAL_PROCESSING_ENABLED: "true" },
  ];
  for (const change of changes) {
    assert.throws(() => assertStage5aSandboxIsolation({ ...isolated, ...change }));
  }
});

test("outside the verified sandbox callback, withdrawal evidence stays live-only", () => {
  assert.equal(withdrawalPaymentLivemode(), true);
  assert.equal(sandboxWithdrawalExecutionAllowed(), false);
});
