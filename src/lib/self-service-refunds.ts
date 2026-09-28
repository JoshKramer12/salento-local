import type Stripe from "stripe";
import { revalidatePath } from "next/cache";

import { addUtcDays } from "@/lib/business-membership";
import { canManageBusiness } from "@/lib/business-owner-access";
import { reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { sendInitialRefundNotifications } from "@/lib/refund-notifications";
import { getStripe, isStripeSandboxMode } from "@/lib/stripe";
import { markStripePaymentRefunded } from "@/lib/stripe-payment-sync";
import { requestBankRefundSupport } from "@/lib/bank-refund-support";

export const INITIAL_REFUND_DAYS = 14;
export type InitialRefundState = "AVAILABLE" | "PROCESSING" | "ACTION_REQUIRED" | "SUPPORT_REQUIRED" | "SUPPORT_CLOSED" | "REFUNDED" | "FAILED" | "UNAVAILABLE";

type Candidate = {
  amountCents: number;
  businessId: string | null;
  paidAt: Date | null;
  purpose: "INITIAL_MEMBERSHIP" | "ANNUAL_RENEWAL" | "REACTIVATION";
  refundRequestedAt: Date | null;
  refundStatus: string | null;
  selfServiceRefundedAt: Date | null;
  status: string;
  stripePaymentIntentId: string | null;
};

/** The instant paidAt + 14 days is excluded. All callers use this rule. */
export function initialRefundState(payment: Candidate, now = new Date()): InitialRefundState {
  if (payment.refundRequestedAt && payment.refundStatus === "support_required") return "SUPPORT_REQUIRED";
  if (payment.refundRequestedAt && payment.refundStatus === "support_closed") return "SUPPORT_CLOSED";
  if (payment.refundRequestedAt && payment.refundStatus === "requires_action") return "ACTION_REQUIRED";
  if (payment.status === "REFUNDED" || payment.selfServiceRefundedAt) return "REFUNDED";
  if (payment.refundRequestedAt) return ["failed", "canceled"].includes(payment.refundStatus ?? "") ? "FAILED" : "PROCESSING";
  if (payment.purpose !== "INITIAL_MEMBERSHIP" || payment.status !== "PAID" || !payment.paidAt || !payment.businessId || !payment.stripePaymentIntentId) return "UNAVAILABLE";
  return now >= payment.paidAt && now < addUtcDays(payment.paidAt, INITIAL_REFUND_DAYS) ? "AVAILABLE" : "UNAVAILABLE";
}

/** A qualifying original purchase must still fund the current term. */
export async function findInitialRefundForBusiness(businessId: string, now = new Date()) {
  const [membership, payments] = await Promise.all([
    prisma.businessMembership.findUnique({ where: { businessId } }),
    prisma.payment.findMany({
      where: { businessId },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const initial = payments.filter((payment) => payment.purpose === "INITIAL_MEMBERSHIP" && payment.paidAt);
  const payment = initial[0] ?? null;
  if (!membership || !payment) return { deadline: null, payment: null, state: "UNAVAILABLE" as const };
  const laterPaidTerm = payments.some((entry) => entry.id !== payment.id && entry.status === "PAID" && entry.paidAt && payment.paidAt && entry.paidAt > payment.paidAt);
  const validTerm = !membership.entitlementRevokedAt && !laterPaidTerm && payment.paidAt &&
    membership.currentPeriodStart.getTime() <= payment.paidAt.getTime() &&
    membership.currentPeriodEnd > payment.paidAt;
  const state = validTerm || payment.status === "REFUNDED" || payment.refundRequestedAt
    ? initialRefundState(payment, now)
    : "UNAVAILABLE" as const;
  return { deadline: addUtcDays(payment.paidAt!, INITIAL_REFUND_DAYS), payment, state };
}

function isSelfServiceRefund(refund: Stripe.Refund) {
  return refund.metadata?.salentoRefundType === "initial_membership_14_day" && Boolean(refund.metadata?.salentoPaymentId);
}

/** Stripe's refund object, not the browser or webhook delivery, establishes success. */
export async function reconcileInitialRefund(refund: Stripe.Refund, sourceEventId = refund.id, dependencies: {
  stripe?: Stripe;
  revalidatePaths?: boolean;
  notify?: typeof sendInitialRefundNotifications;
} = {}) {
  const tagged = isSelfServiceRefund(refund);
  const refundIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  const bankMatches = !tagged && refundIntentId ? await prisma.payment.findMany({ where: { stripePaymentIntentId: refundIntentId } }) : [];
  if (bankMatches.length > 1) throw new Error("refund_payment_attribution_conflict");
  const bankRequest = bankMatches[0] ?? null;
  if (!tagged && (!bankRequest || bankRequest.method !== "BANK_TRANSFER" || !bankRequest.refundRequestedByUserId || !bankRequest.refundRequestedAt || !bankRequest.paidAt || bankRequest.refundRequestedAt < bankRequest.paidAt || bankRequest.refundRequestedAt >= addUtcDays(bankRequest.paidAt, 14) || bankRequest.refundRequestAmountCents !== bankRequest.amountCents || bankRequest.refundStatus === "support_closed")) return false;
  // Webhooks can arrive out of order. Always read the current Stripe object.
  refund = await (dependencies.stripe ?? getStripe()).refunds.retrieve(refund.id);
  if (tagged && !isSelfServiceRefund(refund)) throw new Error("refund_metadata_conflict");
  const payment = await prisma.payment.findUnique({ where: { id: tagged ? refund.metadata?.salentoPaymentId ?? "" : bankRequest!.id } });
  const paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!payment || !payment.stripePaymentIntentId || payment.stripePaymentIntentId !== paymentIntentId ||
    (tagged && payment.businessId !== refund.metadata?.salentoBusinessId) || refund.amount !== payment.amountCents ||
    refund.currency !== payment.currency.toLowerCase()) throw new Error("refund_payment_attribution_conflict");
  if (payment.stripeRefundId && payment.stripeRefundId !== refund.id) {
    if (payment.method !== "BANK_TRANSFER" || !payment.refundRequestedByUserId) throw new Error("refund_provider_reference_conflict");
    const previous = await (dependencies.stripe ?? getStripe()).refunds.retrieve(payment.stripeRefundId);
    if (!["failed", "canceled"].includes(previous.status ?? "")) {
      // An older failed event cannot overwrite a newer processing/successful return.
      if (["failed", "canceled"].includes(refund.status ?? "")) return true;
      throw new Error("refund_provider_reference_conflict");
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { bankRefundResolutionNote: `${payment.bankRefundResolutionNote ?? ""}\nSuperseded ${previous.id} (${previous.status}) with ${refund.id}.`.trim() } });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      refundRequestedAt: payment.refundRequestedAt ?? new Date(refund.created * 1000),
      refundStatus: refund.status,
      stripeRefundId: refund.id,
    },
  });
  if (refund.status !== "succeeded") return true;

  // The existing refund finalizer owns payment/submission/membership changes.
  // Both this action and charge.refunded/refund.updated converge through it.
  await markStripePaymentRefunded({ paymentId: payment.id, stripePaymentIntentId: paymentIntentId, revokeMembershipEntitlement: true, revalidatePaths: dependencies.revalidatePaths });
  const settledAt = payment.selfServiceRefundedAt ?? new Date();
  await prisma.payment.update({
    where: { id: payment.id },
    data: { refundedAmountCents: refund.amount, refundedAt: payment.refundedAt ?? settledAt, selfServiceRefundedAt: settledAt, refundStatus: "succeeded", stripeRefundId: refund.id },
  });
  await reversePartnerCommissionForPayment({
    eventType: "charge.refunded", reason: "initial_membership_14_day_refund", sourceEventId,
    paymentId: payment.id,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: typeof refund.charge === "string" ? refund.charge : refund.charge?.id,
  }, { revalidatePaths: dependencies.revalidatePaths === false ? () => {} : undefined });
  await (dependencies.notify ?? sendInitialRefundNotifications)(payment.id);
  if (dependencies.revalidatePaths !== false) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/payment-history");
  }
  return true;
}

export async function requestInitialRefund(params: { businessId: string; userId: string; instructionsEmail?: string; locale?: "en" | "it" }, dependencies: {
  db?: typeof prisma;
  authorize?: typeof canManageBusiness;
  findCandidate?: typeof findInitialRefundForBusiness;
  stripe?: Stripe;
  reconcile?: typeof reconcileInitialRefund;
  sandbox?: boolean;
  bankSupport?: typeof requestBankRefundSupport;
} = {}) {
  if (!(dependencies.sandbox ?? isStripeSandboxMode())) throw new Error("refund_requires_test_mode");
  if (!await (dependencies.authorize ?? canManageBusiness)(params)) throw new Error("refund_not_authorized");
  const db = dependencies.db ?? prisma;
  const owner = await db.user.findUnique({ where: { id: params.userId }, select: { email: true, role: true } });
  if (owner?.role !== "BUSINESS_OWNER") throw new Error("refund_not_authorized");
  const { membership, payment, state } = await (async () => {
    const candidate = await (dependencies.findCandidate ?? findInitialRefundForBusiness)(params.businessId);
    return { membership: await db.businessMembership.findUnique({ where: { businessId: params.businessId } }), payment: candidate.payment, state: candidate.state };
  })();
  if (payment?.method === "BANK_TRANSFER") return (dependencies.bankSupport ?? requestBankRefundSupport)(params, { stripe: dependencies.stripe, sandbox: dependencies.sandbox, reconcile: dependencies.reconcile });
  if (!membership || !payment || (!["AVAILABLE", "PROCESSING", "ACTION_REQUIRED", "FAILED"].includes(state))) throw new Error("refund_not_eligible");
  const unsafeCommission = await db.partnerCommission.findFirst({ where: { paymentId: payment.id, type: "COMMISSION", status: { in: ["RESERVED", "PAID"] } }, select: { id: true } });
  if (unsafeCommission) throw new Error("refund_commission_requires_operator_review");
  if (membership.originatingPartnerUserId) {
    const initialCommission = await db.partnerCommission.findFirst({
      where: { businessSubmissionId: payment.businessSubmissionId, type: "COMMISSION", amountCents: 5000, status: { in: ["PENDING", "AVAILABLE", "RESERVED", "PAID"] }, OR: [{ paymentId: payment.id }, { sourceKey: `commission:submission:${payment.businessSubmissionId}` }] },
      select: { paymentId: true, status: true },
    });
    if (initialCommission && (initialCommission.paymentId !== payment.id || initialCommission.status === "RESERVED" || initialCommission.status === "PAID")) throw new Error("refund_commission_attribution_requires_operator_review");
  }
  const stripe = dependencies.stripe ?? getStripe();
  if (!payment.stripePaymentIntentId) throw new Error("refund_missing_payment_intent");
  if (payment.stripeRefundId) {
    const existingRefund = await stripe.refunds.retrieve(payment.stripeRefundId);
    await (dependencies.reconcile ?? reconcileInitialRefund)(existingRefund);
    return { status: existingRefund.status, paymentId: payment.id };
  }

  const instructionsEmail = null;
  if (state === "FAILED" || state === "ACTION_REQUIRED") throw new Error("refund_missing_existing_refund");

  async function cancelMatchingSubscription() {
    if (!membership!.stripeSubscriptionId) return;
    if (payment!.stripeSubscriptionId !== membership!.stripeSubscriptionId) {
      // Older subscription Checkout payments predate the durable subscription
      // column. Their exact saved Checkout Session supplies that association.
      if (!payment!.stripeCheckoutSessionId) throw new Error("refund_subscription_mismatch");
      const session = await stripe.checkout.sessions.retrieve(payment!.stripeCheckoutSessionId);
      const sessionSubscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (sessionSubscriptionId !== membership!.stripeSubscriptionId || session.id !== payment!.stripeCheckoutSessionId) throw new Error("refund_subscription_mismatch");
    }
    const subscription = await stripe.subscriptions.retrieve(membership!.stripeSubscriptionId);
    if (subscription.status !== "canceled") await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
    await db.businessMembership.update({ where: { id: membership!.id }, data: { automaticRenewal: false, recurringPaymentReady: false, stripeCancelAtPeriodEnd: false, stripeSubscriptionStatus: "canceled" } });
  }
  const createRefund = async () => {
    try { return await stripe.refunds.create({
    payment_intent: payment.stripePaymentIntentId!,
    amount: payment.amountCents,
    reason: "requested_by_customer",
    ...(instructionsEmail ? { instructions_email: instructionsEmail } : {}),
    metadata: { salentoRefundType: "initial_membership_14_day", salentoPaymentId: payment.id, salentoBusinessId: params.businessId },
  }, { idempotencyKey: `salento-initial-refund-${payment.id}` }); }
    catch (error) {
      const type = error && typeof error === "object" && "type" in error ? error.type : null;
      // A definitive rejection created no refund. Network/timeout ambiguity
      // remains processing and must use the same key when checking status.
      if (type === "StripeInvalidRequestError" || type === "StripeCardError") {
        await db.payment.updateMany({ where: { id: payment.id, status: "PAID", stripeRefundId: null }, data: { refundStatus: "failed" } });
      }
      throw error;
    }
  };

  if (state === "PROCESSING") {
    await cancelMatchingSubscription();
    const refund = await createRefund();
    await (dependencies.reconcile ?? reconcileInitialRefund)(refund);
    return { status: refund.status, paymentId: payment.id };
  }

  // Verify the exact charged amount and guard against an earlier partial or
  // externally initiated refund before creating the only allowed full refund.
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  if (intent.status !== "succeeded" || intent.amount_received !== payment.amountCents || intent.currency !== payment.currency.toLowerCase() || !intent.latest_charge) throw new Error("refund_stripe_payment_mismatch");
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge.id;
  const charge = await stripe.charges.retrieve(chargeId);
  if (!charge.paid || charge.amount_refunded !== 0 || charge.amount !== payment.amountCents) throw new Error("refund_charge_not_fully_available");
  if (charge.payment_method_details?.type !== "card") throw new Error("refund_unsupported_payment_method");

  // Cancel the *matching* initial subscription first. A subsequent refund
  // failure leaves the paid term public; only its future renewal is disabled.
  await cancelMatchingSubscription();
  const requestedAt = new Date();
  const claim = await db.payment.updateMany({
    where: { id: payment.id, status: "PAID", refundRequestedAt: null, paidAt: { gt: addUtcDays(requestedAt, -INITIAL_REFUND_DAYS), lte: requestedAt } },
    data: { refundRequestedAt: requestedAt, refundStatus: "requested", refundInstructionsEmail: instructionsEmail },
  });
  if (!claim.count) {
    const concurrent = await db.payment.findUnique({ where: { id: payment.id } });
    if (!concurrent?.refundRequestedAt) throw new Error("refund_not_eligible");
    if (concurrent.stripeRefundId) {
      const existingRefund = await stripe.refunds.retrieve(concurrent.stripeRefundId);
      await (dependencies.reconcile ?? reconcileInitialRefund)(existingRefund);
      return { status: existingRefund.status, paymentId: payment.id };
    }
    if (concurrent.refundInstructionsEmail !== instructionsEmail) throw new Error("refund_check_status_required");
  }
  // A stable key makes double clicks, process restarts, and concurrent tabs
  // resolve to the same Stripe Refund. No client amount is accepted.
  const refund = await createRefund();
  await (dependencies.reconcile ?? reconcileInitialRefund)(refund);
  return { status: refund.status, paymentId: payment.id };
}
