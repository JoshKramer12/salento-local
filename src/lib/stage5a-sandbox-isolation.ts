export type Stage5aEnvironment = Record<string, string | undefined>;

/** This guard is for the standalone Stage 5A test process, never the app worker. */
export function assertStage5aSandboxIsolation(env: Stage5aEnvironment) {
  if (env.STAGE5A_ISOLATED_SANDBOX !== "salento-stage5a-connect") {
    throw new Error("stage5a_isolation_marker_missing");
  }
  if (env.NODE_ENV === "production" || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID) {
    throw new Error("stage5a_hosted_environment_forbidden");
  }
  if (!/^file:\/tmp\/salento-stage5a-isolated\.[^/?]+\/[^/?]+\.db$/.test(env.DATABASE_URL ?? "")) {
    throw new Error("stage5a_database_not_isolated");
  }
  if (!env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ||
      !env.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
    throw new Error("stage5a_full_test_keys_required");
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(env.STAGE5A_EXPECTED_ACCOUNT_ID ?? "")) {
    throw new Error("stage5a_account_identity_required");
  }
  if (env.PUBLIC_LIVE_PAYMENTS_ENABLED === "true" ||
      env.PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED === "true" ||
      env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED === "true") {
    throw new Error("stage5a_production_send_flag_forbidden");
  }
  return {
    accountId: env.STAGE5A_EXPECTED_ACCOUNT_ID!,
    databaseUrl: env.DATABASE_URL!,
    secretKey: env.STRIPE_SECRET_KEY!,
  };
}
