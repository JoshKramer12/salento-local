import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";

import { DEFAULT_CURRENCY } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { assertFinancialPaymentAllowed, getStripe } from "@/lib/stripe";
import { normalizePhoneNumber } from "@/lib/validation";

export const NO_EMAIL_PAYMENT_FLOW = "NO_EMAIL_PAYMENT_ELEMENT";
export const EMAIL_MANUAL_PAYMENT_FLOW = "EMAIL_MANUAL_PAYMENT_ELEMENT";
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export function getInitialOnlinePaymentInterface(params: { ownerEmail?: string | null; submitterRole: string }): "ELEMENT" {
  void params;
  return "ELEMENT" as const;
}

export function hasValidNoEmailOwnerPhone(ownerPhone: string | null | undefined) {
  return Boolean(normalizePhoneNumber(ownerPhone));
}

export function getNoEmailPaymentPhoneError(params: {
  locale: "en" | "it";
  ownerEmail?: string | null;
  ownerPhone: string;
  paymentMethod?: string | null;
  submitterRole: string;
}) {
  if (params.paymentMethod !== "ONLINE" || params.submitterRole !== "GETTER" || params.ownerEmail?.trim() ||
    hasValidNoEmailOwnerPhone(params.ownerPhone)) return null;

  const message = params.locale === "it"
    ? "Inserisci un numero del titolare valido per aprire il QR di pagamento."
    : "Enter a valid owner phone number before opening the payment QR.";
  return { error: message, fieldErrors: { ownerPhone: message }, invalidFields: ["ownerPhone"] };
}

type EligibleSubmission = {
  agreementSignature: string | null;
  amountOwedCents: number;
  automaticRenewalAtAcceptance: boolean | null;
  businessTermsAcceptedAt: Date | null;
  ownerEmail: string;
  ownerPhone: string;
  paymentMethod: string | null;
  paymentStatus: string;
  signedAt: Date | null;
  status: string;
  submittingUserRole?: string;
};

export function isNoEmailElementEligible(submission: EligibleSubmission) {
  return !submission.ownerEmail.trim() &&
    submission.submittingUserRole === "GETTER" &&
    hasValidNoEmailOwnerPhone(submission.ownerPhone) &&
    submission.paymentMethod === "ONLINE" &&
    submission.paymentStatus === "PENDING_PAYMENT" &&
    submission.status === "AWAITING_PAYMENT" &&
    !submission.automaticRenewalAtAcceptance &&
    Boolean(submission.agreementSignature && submission.signedAt && submission.businessTermsAcceptedAt) &&
    submission.amountOwedCents > 0;
}

export function isInitialElementEligible(submission: EligibleSubmission) {
  return submission.ownerEmail.trim()
    ? submission.paymentMethod === "ONLINE" && submission.paymentStatus === "PENDING_PAYMENT" &&
      submission.status === "AWAITING_PAYMENT" &&
      Boolean(submission.agreementSignature && submission.signedAt && submission.businessTermsAcceptedAt) &&
      submission.amountOwedCents > 0
    : isNoEmailElementEligible(submission);
}

function tokenSecret() {
  const secret = process.env.OWNER_ACCESS_TOKEN_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("no_email_payment_token_secret_missing");
  return secret;
}

export function createNoEmailPaymentToken(paymentId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS,
    paymentId,
  })).toString("base64url");
  const signature = createHmac("sha256", tokenSecret()).update(`no-email-payment:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function parseNoEmailPaymentToken(token: string, now = Date.now()): string | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || token.length > 500) return null;
  const expected = createHmac("sha256", tokenSecret()).update(`no-email-payment:${payload}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown; paymentId?: unknown };
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(now / 1000) ||
      typeof parsed.paymentId !== "string" || !parsed.paymentId.startsWith("initial-element:")) return null;
    return parsed.paymentId;
  } catch { return null; }
}

export async function findNoEmailTokenPayment(token: string, required?: { paymentId?: string; submissionId?: string; paid?: boolean }, dependencies: { db?: typeof prisma } = {}) {
  const payment = await findInitialElementTokenPayment(token, required, dependencies);
  return payment && !payment.businessSubmission.ownerEmail.trim() && payment.partnerUserId === payment.businessSubmission.userId ? payment : null;
}

export async function findInitialElementTokenPayment(token: string, required?: { paymentId?: string; submissionId?: string; paid?: boolean }, dependencies: { db?: typeof prisma } = {}) {
  const id = parseNoEmailPaymentToken(token);
  if (!id || (required?.paymentId && id !== required.paymentId)) return null;
  const payment = await (dependencies.db ?? prisma).payment.findUnique({
    where: { id },
    include: { businessSubmission: true },
  });
  if (!payment || payment.method !== "STRIPE_CHECKOUT" || payment.stripeCheckoutSessionId ||
    (payment.partnerUserId && payment.partnerUserId !== payment.businessSubmission.userId) ||
    (!payment.businessSubmission.ownerEmail.trim() && !payment.partnerUserId) ||
    payment.userId !== payment.businessSubmission.userId ||
    !payment.stripePaymentIntentId || payment.purpose !== "INITIAL_MEMBERSHIP" ||
    (!payment.businessSubmission.ownerEmail.trim() && !hasValidNoEmailOwnerPhone(payment.businessSubmission.ownerPhone)) ||
    (required?.submissionId && payment.businessSubmissionId !== required.submissionId) ||
    (required?.paid && payment.status !== "PAID")) return null;
  return payment;
}

export function matchesNoEmailPaymentIntent(paymentIntent: Stripe.PaymentIntent, payment: {
  amountCents: number;
  businessSubmissionId: string;
  id: string;
  partnerUserId: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  userId: string;
}) {
  return matchesManualElementPaymentIntent(paymentIntent, payment, NO_EMAIL_PAYMENT_FLOW);
}

export function matchesManualElementPaymentIntent(paymentIntent: Stripe.PaymentIntent, payment: Parameters<typeof matchesNoEmailPaymentIntent>[1], flow: string) {
  return !payment.stripeCheckoutSessionId &&
    payment.stripePaymentIntentId === paymentIntent.id &&
    paymentIntent.metadata?.paymentFlow === flow &&
    paymentIntent.metadata?.paymentId === payment.id &&
    paymentIntent.metadata?.businessSubmissionId === payment.businessSubmissionId &&
    paymentIntent.metadata?.userId === payment.userId &&
    paymentIntent.metadata?.partnerId === (payment.partnerUserId || "") &&
    paymentIntent.amount === payment.amountCents &&
    paymentIntent.currency === DEFAULT_CURRENCY &&
    paymentIntent.amount_received <= paymentIntent.amount;
}

export async function getVerifiedNoEmailPaymentIntent(paymentIntent: Stripe.PaymentIntent, dependencies: { db?: typeof prisma } = {}) {
  const payment = await getVerifiedManualElementPaymentIntent(paymentIntent, dependencies);
  return payment && !payment.businessSubmission.ownerEmail.trim() && payment.partnerUserId === payment.businessSubmission.userId ? payment : null;
}

export async function getVerifiedManualElementPaymentIntent(paymentIntent: Stripe.PaymentIntent, dependencies: { db?: typeof prisma } = {}) {
  const flow = paymentIntent.metadata?.paymentFlow;
  if (flow !== NO_EMAIL_PAYMENT_FLOW && flow !== EMAIL_MANUAL_PAYMENT_FLOW) return null;
  const paymentId = paymentIntent.metadata.paymentId;
  if (!paymentId?.startsWith("initial-element:")) return null;
  const payment = await (dependencies.db ?? prisma).payment.findUnique({
    where: { id: paymentId },
    include: { businessSubmission: true },
  });
  if (!payment || !matchesManualElementPaymentIntent(paymentIntent, payment, flow) ||
    (payment.partnerUserId && payment.partnerUserId !== payment.businessSubmission.userId) ||
    (!payment.businessSubmission.ownerEmail.trim() && !payment.partnerUserId) ||
    payment.userId !== payment.businessSubmission.userId ||
    payment.method !== "STRIPE_CHECKOUT" || payment.purpose !== "INITIAL_MEMBERSHIP" ||
    payment.stripeSubscriptionId || payment.stripeInvoiceId ||
    (flow === NO_EMAIL_PAYMENT_FLOW) !== !payment.businessSubmission.ownerEmail.trim() ||
    (!payment.businessSubmission.ownerEmail.trim() && !hasValidNoEmailOwnerPhone(payment.businessSubmission.ownerPhone)) ||
    payment.businessSubmission.paymentMethod !== "ONLINE" ||
    ((payment.businessSubmission.paymentStatus === "PAID" || payment.businessSubmission.status === "PUBLISHED") && payment.status !== "PAID") ||
    payment.businessSubmission.automaticRenewalAtAcceptance ||
    !payment.businessSubmission.agreementSignature ||
    !payment.businessSubmission.signedAt ||
    !payment.businessSubmission.businessTermsAcceptedAt) return null;
  return payment;
}

export async function ensureNoEmailPaymentIntent(submissionId: string, dependencies: { db?: typeof prisma; stripe?: Stripe } = {}) {
  return ensureManualElementPaymentIntent(submissionId, dependencies);
}

export async function ensureManualElementPaymentIntent(submissionId: string, dependencies: { db?: typeof prisma; stripe?: Stripe } = {}) {
  assertFinancialPaymentAllowed();
  const db = dependencies.db ?? prisma;
  const submission = await db.businessSubmission.findUnique({
    where: { id: submissionId },
    include: { user: { select: { role: true } } },
  });
  if (!submission || submission.automaticRenewalAtAcceptance ||
    !isInitialElementEligible({ ...submission, submittingUserRole: submission.user.role })) return null;
  const stripe = dependencies.stripe ?? getStripe();
  const paidInitialPayment = await db.payment.findFirst({
    where: { businessSubmissionId: submission.id, purpose: "INITIAL_MEMBERSHIP", status: "PAID" },
    select: { id: true },
  });
  if (paidInitialPayment) return null;
  const outstandingBankTransfer = await db.payment.findFirst({
    where: { businessSubmissionId: submission.id, method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER" },
    select: { id: true },
  });
  if (outstandingBankTransfer) return null;
  // Older no-email submissions may already have a hosted Checkout link. Close
  // every open session before exposing a second payable path for that purchase.
  const priorCheckoutPayments = await db.payment.findMany({
    where: {
      businessSubmissionId: submission.id,
      status: "PENDING_PAYMENT",
      stripeCheckoutSessionId: { not: null },
    },
    select: { stripeCheckoutSessionId: true },
  });
  for (const prior of priorCheckoutPayments) {
    const session = await stripe.checkout.sessions.retrieve(prior.stripeCheckoutSessionId!);
    if (session.payment_status === "paid" || session.status === "complete") return null;
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  }
  const id = `initial-element:${submission.id}`;
  const partnerUserId = submission.user.role === "GETTER" ? submission.userId : null;
  const payment = await db.payment.upsert({
    where: { id },
    create: {
      id, amountCents: submission.amountOwedCents, businessSubmissionId: submission.id,
      currency: DEFAULT_CURRENCY, method: "STRIPE_CHECKOUT", partnerUserId,
      status: "PENDING_PAYMENT", userId: submission.userId,
    },
    update: {},
  });
  if (payment.status === "PAID") return null;
  if (payment.stripeSubscriptionId || payment.stripeInvoiceId || payment.stripeCustomerId) {
    throw new Error("manual_payment_conflicting_subscription");
  }
  if (payment.amountCents !== submission.amountOwedCents || payment.currency !== DEFAULT_CURRENCY ||
    payment.partnerUserId !== partnerUserId || payment.userId !== submission.userId) throw new Error("no_email_payment_record_mismatch");
  let existingIntent: Stripe.PaymentIntent | null = null;
  if (payment.stripePaymentIntentId) {
    existingIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (existingIntent.status !== "canceled") {
      if (!matchesManualElementPaymentIntent(existingIntent, payment,
        submission.ownerEmail.trim() ? EMAIL_MANUAL_PAYMENT_FLOW : NO_EMAIL_PAYMENT_FLOW)) throw new Error("manual_payment_intent_mismatch");
      return payment;
    }
  }
  const intent = await stripe.paymentIntents.create({
    amount: payment.amountCents,
    currency: DEFAULT_CURRENCY,
    description: `Salento Local listing: ${submission.businessName}`,
    ...(submission.ownerEmail.trim() ? { receipt_email: submission.ownerEmail.trim() } : {}),
    metadata: {
      businessSubmissionId: submission.id,
      partnerId: partnerUserId || "",
      paymentFlow: submission.ownerEmail.trim() ? EMAIL_MANUAL_PAYMENT_FLOW : NO_EMAIL_PAYMENT_FLOW,
      paymentId: payment.id,
      userId: submission.userId,
    },
    payment_method_types: ["card"],
  }, { idempotencyKey: `initial-element:${payment.id}:${existingIntent?.id || "first"}` });
  const updated = await db.payment.updateMany({
    where: { id: payment.id, stripePaymentIntentId: existingIntent?.id || null, status: "PENDING_PAYMENT" },
    data: { stripePaymentIntentId: intent.id },
  });
  if (updated.count !== 1) {
    const concurrent = await db.payment.findUnique({ where: { id: payment.id } });
    if (concurrent?.stripePaymentIntentId === intent.id) return concurrent;
    throw new Error("no_email_payment_concurrent_change");
  }
  return { ...payment, stripePaymentIntentId: intent.id };
}
