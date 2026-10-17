import Stripe from "stripe";

import { normalizeEnvValue } from "@/lib/env";

let stripeClient: Stripe | null = null;
const STRIPE_ACCOUNTS_V2_NOTICE = "We recommend building your integration using Accounts v2.";

function installStripeWarningFilter() {
  if (typeof process.emitWarning !== "function") {
    return;
  }

  const globalWithStripeFilter = globalThis as typeof globalThis & {
    __salentoStripeWarningFilterInstalled?: boolean;
  };

  if (globalWithStripeFilter.__salentoStripeWarningFilterInstalled) {
    return;
  }

  const originalEmitWarning = process.emitWarning.bind(process) as typeof process.emitWarning;

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const category = typeof args[0] === "string" ? args[0] : undefined;
    const message =
      typeof warning === "string"
        ? warning
        : warning instanceof Error
          ? warning.message
          : String(warning);

    if (category === "Stripe" && message.includes(STRIPE_ACCOUNTS_V2_NOTICE)) {
      return;
    }

    return (originalEmitWarning as (...emitArgs: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  globalWithStripeFilter.__salentoStripeWarningFilterInstalled = true;
}

export function isStripeSandboxMode() {
  const secretKey = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);

  return secretKey.startsWith("sk_test_");
}

export function configuredStripeMode() {
  const secret = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  const publishable = normalizeEnvValue(process.env.STRIPE_PUBLISHABLE_KEY) ||
    normalizeEnvValue(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  if (secret.startsWith("sk_test_") && publishable.startsWith("pk_test_")) return "test" as const;
  if (secret.startsWith("sk_live_") && publishable.startsWith("pk_live_")) return "live" as const;
  return null;
}

export function assertStripeObjectMode(livemode: boolean | undefined | null) {
  if (typeof livemode !== "boolean" || configuredStripeMode() !== (livemode ? "live" : "test")) {
    throw new Error("stripe_payment_mode_mismatch");
  }
}

/** Public production shares a real customer ledger. It remains financially
 * closed until a separate live-payment release explicitly enables it. */
export function isPublicFinancialHold() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return false;
  const mode = configuredStripeMode();
  return !((mode === "test" && process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED === "true") ||
    (mode === "live" && process.env.PUBLIC_LIVE_PAYMENTS_ENABLED === "true"));
}

export function assertFinancialPaymentAllowed() {
  if (isPublicFinancialHold()) throw new Error("public_financial_payment_paused");
}

/** Test payments may run on the public site, but Partner disbursements require
 * a separate live financial release. This also protects PayPal payouts. */
export function areRealPartnerDisbursementsAllowed() {
  return process.env.RAILWAY_ENVIRONMENT_NAME !== "production" ||
    (configuredStripeMode() === "live" && process.env.PUBLIC_LIVE_PAYMENTS_ENABLED === "true");
}

export function assertRealPartnerDisbursementsAllowed() {
  if (!areRealPartnerDisbursementsAllowed()) throw new Error("partner_real_payouts_paused");
}

/** Live owner refunds require an independent release switch after live-mode review. */
export function canRequestOwnerRefunds() {
  if (isStripeSandboxMode()) return true;
  const secret = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  const publishable = normalizeEnvValue(process.env.STRIPE_PUBLISHABLE_KEY) ||
    normalizeEnvValue(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  return secret.startsWith("sk_live_") && publishable.startsWith("pk_live_") &&
    process.env.LIVE_OWNER_REFUNDS_ENABLED === "true";
}

export function getPaymentElementPublishableKey() {
  const secret = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);
  if (!secret.startsWith("sk_test_") && !secret.startsWith("sk_live_")) return null;
  const key = normalizeEnvValue(process.env.STRIPE_PUBLISHABLE_KEY) ||
    normalizeEnvValue(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const expectedPrefix = isStripeSandboxMode() ? "pk_test_" : "pk_live_";
  return key.startsWith(expectedPrefix) ? key : null;
}

export function canUseStripeBankTransferTestSimulation() {
  return isStripeSandboxMode() && process.env.NODE_ENV !== "production";
}

export function getStripe() {
  if (stripeClient) {
    return stripeClient;
  }

  installStripeWarningFilter();

  const secretKey = normalizeEnvValue(process.env.STRIPE_SECRET_KEY);

  if (!secretKey) {
    throw new Error("stripe_secret_key_missing");
  }

  stripeClient = new Stripe(secretKey, {
    appInfo: {
      name: "Salento Local",
    },
  });

  return stripeClient;
}
