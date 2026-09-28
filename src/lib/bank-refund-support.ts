import type Stripe from "stripe";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { addUtcDays } from "@/lib/business-membership";
import { canManageBusiness } from "@/lib/business-owner-access";
import { getStripe, isStripeSandboxMode } from "@/lib/stripe";
import { findInitialRefundForBusiness, reconcileInitialRefund } from "@/lib/self-service-refunds";
import { sendBankRefundRequestNotifications } from "@/lib/bank-refund-notifications";

function refreshRefundViews(businessId: string) {
  for (const path of ["/dashboard", "/dashboard/businesses", "/dashboard/earnings", "/dashboard/payment-history", `/dashboard/refund/${businessId}`, `/dashboard/admin/memberships/${businessId}`]) revalidatePath(path);
}

export async function requestBankRefundSupport(params: { businessId: string; userId: string; instructionsEmail?: string; locale?: "en" | "it" }, dependencies: {
  stripe?: Stripe; now?: Date; sandbox?: boolean; reconcile?: typeof reconcileInitialRefund; revalidatePaths?: boolean; notify?: typeof sendBankRefundRequestNotifications;
} = {}) {
  if (!(dependencies.sandbox ?? isStripeSandboxMode())) throw new Error("refund_requires_test_mode");
  if (!await canManageBusiness(params)) throw new Error("refund_not_authorized");
  const owner = await prisma.user.findUnique({ where: { id: params.userId } });
  if (owner?.role !== "BUSINESS_OWNER") throw new Error("refund_not_authorized");
  const now = dependencies.now ?? new Date();
  const candidate = await findInitialRefundForBusiness(params.businessId, now);
  const payment = candidate.payment;
  if (!payment || payment.businessId !== params.businessId || payment.method !== "BANK_TRANSFER" || payment.purpose !== "INITIAL_MEMBERSHIP" || payment.status !== "PAID" || !payment.paidAt || !payment.stripePaymentIntentId) throw new Error("refund_not_eligible");
  // A recorded timely request remains valid after the deadline. It never
  // creates a Stripe Refund, including retries and the Owner status action.
  if (payment.refundRequestedAt) {
    if (!payment.refundRequestedByUserId || payment.refundStatus === "support_closed") throw new Error("refund_requires_operator_review");
    if (payment.stripeRefundId) {
      const stripe = dependencies.stripe ?? getStripe();
      const refund = await stripe.refunds.retrieve(payment.stripeRefundId);
      await (dependencies.reconcile ?? reconcileInitialRefund)(refund, refund.id, { stripe, revalidatePaths: dependencies.revalidatePaths });
    }
    await (dependencies.notify ?? sendBankRefundRequestNotifications)(payment.id);
    const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { refundStatus: true } });
    return { status: current.refundStatus, paymentId: payment.id };
  }
  if (candidate.state !== "AVAILABLE") throw new Error("refund_not_eligible");
  const email = owner.email || params.instructionsEmail?.trim().toLowerCase() || "";
  if (!z.string().email().safeParse(email).success) throw new Error("refund_contact_email_required");
  const stripe = dependencies.stripe ?? getStripe();
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  if (intent.status !== "succeeded" || intent.amount_received !== payment.amountCents || intent.currency !== payment.currency.toLowerCase() || !intent.latest_charge) throw new Error("refund_stripe_payment_mismatch");
  const charge = await stripe.charges.retrieve(typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge.id);
  if (!charge.paid || charge.amount !== payment.amountCents || charge.amount_refunded !== 0 || charge.payment_method_details?.type !== "customer_balance") throw new Error("refund_bank_payment_mismatch");

  await prisma.$transaction(async (tx) => {
    // Re-read every local financial predicate under the same lock as the claim
    // and commission hold. Payout reservation rechecks refundRequestedAt too.
    const current = await tx.payment.findUnique({ where: { id: payment.id } });
    const membership = await tx.businessMembership.findUnique({ where: { businessId: params.businessId } });
    if (!current || current.businessId !== params.businessId || current.businessSubmissionId !== payment.businessSubmissionId || current.method !== "BANK_TRANSFER" || current.purpose !== "INITIAL_MEMBERSHIP" || current.status !== "PAID" || current.amountCents !== payment.amountCents || current.stripePaymentIntentId !== payment.stripePaymentIntentId) throw new Error("refund_payment_attribution_conflict");
    if (current.refundRequestedAt) {
      if (!current.refundRequestedByUserId || current.refundStatus === "support_closed") throw new Error("refund_requires_operator_review");
      return;
    }
    const claimedAt = dependencies.now ?? new Date();
    const laterPaid = await tx.payment.findFirst({ where: { businessId: params.businessId, id: { not: payment.id }, status: "PAID", paidAt: { gt: current.paidAt! } }, select: { id: true } });
    const submission = await tx.businessSubmission.findUnique({ where: { id: current.businessSubmissionId }, select: { createdBusinessId: true } });
    if (!current.paidAt || claimedAt < current.paidAt || claimedAt >= addUtcDays(current.paidAt, 14) || !membership || membership.entitlementRevokedAt || laterPaid || membership.currentPeriodStart > current.paidAt || membership.currentPeriodEnd <= current.paidAt || submission?.createdBusinessId !== params.businessId) throw new Error("refund_not_eligible");
    const commissions = await tx.partnerCommission.findMany({ where: { type: "COMMISSION", OR: [{ paymentId: current.id }, { sourceKey: `commission:submission:${current.businessSubmissionId}` }] } });
    for (const commission of commissions) {
      if (commission.paymentId !== current.id || commission.businessId !== params.businessId || commission.businessSubmissionId !== current.businessSubmissionId || commission.partnerUserId !== membership.originatingPartnerUserId || commission.amountCents !== 5000 || !["PENDING", "AVAILABLE"].includes(commission.status) || commission.payoutId) throw new Error("refund_commission_requires_operator_review");
    }
    await tx.payment.update({ where: { id: current.id }, data: {
      refundRequestedAt: claimedAt, refundStatus: "support_required", refundRequestedByUserId: owner.id,
      stripeCustomerId: current.stripeCustomerId || (typeof intent.customer === "string" ? intent.customer : intent.customer?.id),
      refundRequestAmountCents: current.amountCents, refundRequestLocale: params.locale ?? "it", refundInstructionsEmail: email,
    } });
    await tx.partnerCommission.updateMany({ where: { id: { in: commissions.map((entry) => entry.id) }, status: { in: ["PENDING", "AVAILABLE"] }, payoutId: null }, data: { status: "PENDING" } });
  });
  await (dependencies.notify ?? sendBankRefundRequestNotifications)(payment.id);
  if (dependencies.revalidatePaths !== false) refreshRefundViews(params.businessId);
  return { status: "support_required", paymentId: payment.id };
}

async function requireBankRefundOperator(userId: string, paymentId: string, businessId: string) {
  if (!isStripeSandboxMode()) throw new Error("refund_requires_test_mode");
  const operator = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (operator?.role !== "ADMIN") throw new Error("refund_not_authorized");
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.businessId !== businessId || payment.method !== "BANK_TRANSFER" || payment.purpose !== "INITIAL_MEMBERSHIP" || !payment.refundRequestedAt || !payment.paidAt || !payment.refundRequestedByUserId || payment.refundRequestedAt < payment.paidAt || payment.refundRequestedAt >= addUtcDays(payment.paidAt, 14) || payment.refundRequestAmountCents !== payment.amountCents || !payment.stripePaymentIntentId || payment.refundStatus === "support_closed") throw new Error("refund_not_eligible");
  return payment;
}

/** Verify an existing provider Refund. This action never initiates a return,
 * accepts an amount, or treats operator assertion as financial completion. */
export async function reconcileBankRefundFromStripe(params: { userId: string; paymentId: string; businessId: string; refundId: string }, dependencies: { stripe?: Stripe; revalidatePaths?: boolean; notify?: NonNullable<Parameters<typeof reconcileInitialRefund>[2]>["notify"] } = {}) {
  const payment = await requireBankRefundOperator(params.userId, params.paymentId, params.businessId);
  if (!/^re_[a-zA-Z0-9_]+$/.test(params.refundId)) throw new Error("refund_invalid_provider_reference");
  const stripe = dependencies.stripe ?? getStripe();
  const refund = await stripe.refunds.retrieve(params.refundId);
  const intentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (intentId !== payment.stripePaymentIntentId || refund.amount !== payment.amountCents || refund.currency !== payment.currency.toLowerCase()) throw new Error("refund_payment_attribution_conflict");
  if (!await reconcileInitialRefund(refund, `bank-support:${refund.id}`, { ...dependencies, stripe })) throw new Error("refund_payment_attribution_conflict");
  const reconciled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { refundStatus: true, stripeRefundId: true, bankRefundResolutionNote: true } });
  if (reconciled.stripeRefundId !== refund.id) throw new Error("refund_obsolete_provider_reference");
  const status = reconciled.refundStatus;
  await prisma.payment.update({ where: { id: payment.id }, data: { bankRefundResolvedByUserId: params.userId, bankRefundResolutionNote: `${reconciled.bankRefundResolutionNote ?? ""}\nVerified Stripe ${refund.id}: ${status}`.trim(), ...(status === "succeeded" ? { bankRefundResolvedAt: new Date() } : {}) } });
  if (dependencies.revalidatePaths !== false) refreshRefundViews(params.businessId);
  return { status };
}

/** Closing a withdrawn request releases its hold, without marking a refund.
 * Require operator evidence and verify there is no pending or returned money. */
export async function closeBankRefundSupportRequest(params: { userId: string; paymentId: string; businessId: string; note: string }, dependencies: { stripe?: Stripe; revalidatePaths?: boolean } = {}) {
  const payment = await requireBankRefundOperator(params.userId, params.paymentId, params.businessId);
  if (payment.status !== "PAID" || params.note.trim().length < 20 || params.note.length > 2000) throw new Error("refund_resolution_evidence_required");
  const stripe = dependencies.stripe ?? getStripe();
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId!);
  if (intent.status !== "succeeded" || intent.amount_received !== payment.amountCents || !intent.latest_charge) throw new Error("refund_stripe_payment_mismatch");
  const charge = await stripe.charges.retrieve(typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge.id);
  const refunds = await stripe.refunds.list({ payment_intent: payment.stripePaymentIntentId!, limit: 100 });
  if (refunds.has_more || charge.amount_refunded !== 0 || refunds.data.some((refund) => !["failed", "canceled"].includes(refund.status ?? ""))) throw new Error("refund_still_unresolved");
  const updated = await prisma.payment.updateMany({ where: { id: payment.id, status: "PAID", refundStatus: payment.refundStatus, stripeRefundId: payment.stripeRefundId, bankRefundResolvedAt: null }, data: { refundStatus: "support_closed", bankRefundResolvedAt: new Date(), bankRefundResolvedByUserId: params.userId, bankRefundResolutionNote: params.note.trim() } });
  if (!updated.count) throw new Error("refund_resolution_conflict");
  if (dependencies.revalidatePaths !== false) refreshRefundViews(params.businessId);
}
