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
