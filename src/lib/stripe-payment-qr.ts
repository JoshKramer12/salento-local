import QRCode from "qrcode";
import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

const checkoutSessionIdPattern = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
const stripeCheckoutHostname = "checkout.stripe.com";

type CheckoutSessionForQr = Pick<
  Stripe.Checkout.Session,
  "id" | "metadata" | "status" | "url"
>;

export const STRIPE_PAYMENT_QR_OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 4,
  width: 240,
};

export function getValidatedStripeCheckoutUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== stripeCheckoutHostname ||
      !parsed.pathname.startsWith("/c/pay/")
    ) {
      return null;
    }

    // Validate with URL, but preserve Stripe's returned string byte-for-byte.
    return candidate;
  } catch {
    return null;
  }
}

export function buildStripePaymentQrPayload(params: {
  appUrl: string;
  checkoutSessionId: string;
  checkoutUrl: string | null;
  runtimeEnvironment?: string;
}) {
  if (!checkoutSessionIdPattern.test(params.checkoutSessionId)) {
    throw new Error("invalid_stripe_checkout_session_id");
  }

  const checkoutUrl = getValidatedStripeCheckoutUrl(params.checkoutUrl);
  if (!checkoutUrl) {
    throw new Error("invalid_stripe_checkout_url");
  }

  const appUrl = new URL(params.appUrl);
  const hostname = appUrl.hostname.toLowerCase();
  const isLocalHostname = hostname === "localhost" || hostname === "127.0.0.1";
  const isPrivateRailwayHostname = hostname.endsWith(".railway.internal");
  const isAuditHostname = hostname.includes("stripe-audit-web");
  const runtimeEnvironment = params.runtimeEnvironment ?? process.env.NODE_ENV;

  if (
    isPrivateRailwayHostname ||
    isAuditHostname ||
    (runtimeEnvironment === "production" && isLocalHostname) ||
    (appUrl.protocol !== "https:" && !(runtimeEnvironment !== "production" && isLocalHostname))
  ) {
    throw new Error("invalid_public_app_url");
  }

  const appOrigin = appUrl.origin;
  const qrUrl = new URL(
    `/pay/stripe/${encodeURIComponent(params.checkoutSessionId)}`,
    appOrigin,
  );

  return {
    checkoutUrl,
    qrValue: qrUrl.toString(),
  };
}

export async function generateStripePaymentQrDataUrl(qrValue: string) {
  return QRCode.toDataURL(qrValue, STRIPE_PAYMENT_QR_OPTIONS);
}

export async function resolveStripePaymentQrDestination(
  checkoutSessionId: string,
  dependencies: {
    findPayment?: (checkoutSessionId: string) => Promise<{
      businessSubmissionId: string;
    } | null>;
    retrieveCheckoutSession?: (
      checkoutSessionId: string,
    ) => Promise<CheckoutSessionForQr>;
  } = {},
) {
  if (!checkoutSessionIdPattern.test(checkoutSessionId)) {
    return { status: "invalid" as const, url: null };
  }

  const findPayment = dependencies.findPayment ?? ((sessionId: string) =>
    prisma.payment.findFirst({
      where: {
        method: "STRIPE_CHECKOUT",
        status: "PENDING_PAYMENT",
        stripeCheckoutSessionId: sessionId,
      },
      select: { businessSubmissionId: true },
    }));
  let payment;
  try {
    payment = await findPayment(checkoutSessionId);
  } catch {
    return { status: "unavailable" as const, url: null };
  }
  if (!payment) {
    return { status: "not_found" as const, url: null };
  }

  const retrieveCheckoutSession = dependencies.retrieveCheckoutSession ??
    ((sessionId: string) => getStripe().checkout.sessions.retrieve(
      sessionId,
      {},
      { maxNetworkRetries: 0, timeout: 10_000 },
    ));

  let session: CheckoutSessionForQr;
  try {
    session = await retrieveCheckoutSession(checkoutSessionId);
  } catch {
    return { status: "unavailable" as const, url: null };
  }

  if (
    session.id !== checkoutSessionId ||
    session.status !== "open" ||
    session.metadata?.businessSubmissionId?.trim() !== payment.businessSubmissionId
  ) {
    return { status: "not_available" as const, url: null };
  }

  const checkoutUrl = getValidatedStripeCheckoutUrl(session.url);
  if (!checkoutUrl) {
    return { status: "not_available" as const, url: null };
  }

  return { status: "ready" as const, url: checkoutUrl };
}
