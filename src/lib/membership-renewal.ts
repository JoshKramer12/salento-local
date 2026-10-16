import type { PaymentPurpose, PaymentRecordMethod, Prisma, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { getBusinessMembershipPeriod, getBusinessMembershipStatus } from "@/lib/business-membership";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { assertFinancialPaymentAllowed } from "@/lib/stripe";

type RenewalDb = PrismaClient | Prisma.TransactionClient;

/** Require one full card payment for the exact recurring invoice before buying a term. */
export function getVerifiedRenewalInvoiceIntentId(params: {
  currentInvoice: Stripe.Invoice;
  eventInvoice: Stripe.Invoice;
  subscriptionId: string;
}) {
  const { currentInvoice, eventInvoice, subscriptionId } = params;
  const paidPayments = currentInvoice.payments?.data.filter((payment) => payment.status === "paid") ?? [];
  const paidPayment = paidPayments[0];
  const rawIntent = paidPayment?.payment.type === "payment_intent"
    ? paidPayment.payment.payment_intent : null;
  const intentId = typeof rawIntent === "string" ? rawIntent : rawIntent?.id;
  if (currentInvoice.id !== eventInvoice.id || currentInvoice.status !== "paid" ||
    currentInvoice.billing_reason !== "subscription_cycle" ||
    currentInvoice.amount_paid !== eventInvoice.amount_paid ||
    currentInvoice.amount_paid !== LISTING_OFFER.renewalPriceCents ||
    currentInvoice.currency !== "eur" || currentInvoice.currency !== eventInvoice.currency ||
    currentInvoice.parent?.subscription_details?.subscription !== subscriptionId ||
    currentInvoice.payments?.has_more || paidPayments.length !== 1 ||
    paidPayment.amount_paid !== currentInvoice.amount_paid || !intentId ||
    typeof currentInvoice.customer !== "string") {
    throw new Error("renewal_invoice_payment_identity_unavailable");
  }
  return { intentId, customerId: currentInvoice.customer };
}

export function getMembershipPaymentPurpose(params: {
  currentPeriodEnd: Date;
  entitlementRevokedAt?: Date | null;
  graceEndsAt: Date;
  now: Date;
}): PaymentPurpose {
  return getBusinessMembershipStatus(params) === "EXPIRED"
    ? "REACTIVATION"
    : "ANNUAL_RENEWAL";
}

/**
 * The Stripe invoice/session/intent is the idempotency source, rather than a
 * browser return URL. A duplicate webhook therefore cannot add a second term.
 */
export async function finalizeMembershipRenewalPayment(params: {
  amountPaidCents: number;
  automaticRenewal?: boolean;
  businessId?: string | null;
  db: RenewalDb;
  eventId?: string | null;
  invoiceId?: string | null;
  method: PaymentRecordMethod;
  paidAt: Date;
  paymentIntentId?: string | null;
  sessionId?: string | null;
  subscriptionId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
}) {
  assertFinancialPaymentAllowed();
  const membership = await params.db.businessMembership.findFirst({
    where: params.businessId
      ? { businessId: params.businessId }
      : params.subscriptionId ? { stripeSubscriptionId: params.subscriptionId } : { id: "__missing_membership__" },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          submissions: {
            orderBy: { createdAt: "asc" },
            select: { id: true, userId: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!membership || !membership.business.submissions[0]) return null;

  const existing = await params.db.payment.findFirst({
    where: {
      OR: [
        ...(params.eventId ? [{ stripeLastEventId: params.eventId }] : []),
        ...(params.invoiceId ? [{ stripeInvoiceId: params.invoiceId }] : []),
        ...(params.sessionId ? [{ stripeCheckoutSessionId: params.sessionId }] : []),
        ...(params.paymentIntentId ? [{ stripePaymentIntentId: params.paymentIntentId }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) {
    const existingPayment = await params.db.payment.findUnique({
      where: { id: existing.id }, select: { status: true, purpose: true, refundRequestedAt: true },
    });
    if (existingPayment?.status === "PAID" && !existingPayment.refundRequestedAt) {
      await params.db.membershipFailedPaymentDelivery.updateMany({
        where: { membershipId: membership.id, acceptedAt: null, canceledAt: null },
        data: { canceledAt: new Date(), cancelReason: "membership_payment_succeeded" },
      });
      return { duplicate: true, membership, paymentId: existing.id, purpose: existingPayment.purpose };
    }
    if (existingPayment?.status === "REFUNDED" || existingPayment?.refundRequestedAt) {
      return { duplicate: true, membership, paymentId: existing.id, purpose: existingPayment.purpose };
    }
  }

  // A Checkout URL opened before the owner requested a refund can still be
  // paid. Defer that term until Stripe resolves the first refund, otherwise
  // the commission would be classified as €15 or €50 on uncertain history.
  const unresolvedInitialRefund = await params.db.payment.findFirst({
    where: { businessId: membership.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null }, OR: [{ status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } }, { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } }, { status: "REFUNDED", refundStatus: { not: "succeeded" } }] },
    select: { id: true },
  });
  if (unresolvedInitialRefund) throw new Error("renewal_during_initial_refund_processing");

  let finalizedPaymentId: string | null = null;
  // Use the authoritative confirmation time, not when a manual bank-transfer
  // instruction was generated. A transfer settling after grace is a true
  // reactivation even if its pending record began while the page was active.
  const period = getBusinessMembershipPeriod({
    currentPeriodEnd: membership.currentPeriodEnd,
    entitlementRevokedAt: membership.entitlementRevokedAt,
    graceEndsAt: membership.graceEndsAt,
    paidAt: params.paidAt,
  });
  const ordinaryPurpose = getMembershipPaymentPurpose({
    currentPeriodEnd: membership.currentPeriodEnd,
    entitlementRevokedAt: membership.entitlementRevokedAt,
    graceEndsAt: membership.graceEndsAt,
    now: params.paidAt,
  });
  const priorInitialPayments = await params.db.payment.findMany({
    where: { businessId: membership.businessId, purpose: "INITIAL_MEMBERSHIP" },
    select: { id: true, status: true, selfServiceRefundedAt: true },
  });
  const refundedRepurchase = ordinaryPurpose === "REACTIVATION" && Boolean(membership.entitlementRevokedAt) &&
    priorInitialPayments.length > 0 &&
    priorInitialPayments.every((payment) => payment.status === "REFUNDED" && payment.selfServiceRefundedAt);
  const purpose: PaymentPurpose = refundedRepurchase ? "INITIAL_MEMBERSHIP" : ordinaryPurpose;

  if (existing) {
    await params.db.payment.update({
      where: { id: existing.id },
      data: {
        amountCents: params.amountPaidCents,
        paidAt: params.paidAt,
        purpose,
        status: "PAID",
        stripeInvoiceId: params.invoiceId ?? undefined,
        stripeLastEventId: params.eventId ?? undefined,
        stripePaymentIntentId: params.paymentIntentId ?? undefined,
        stripeSubscriptionId: refundedRepurchase ? params.subscriptionId ?? undefined : undefined,
      },
    });
    finalizedPaymentId = existing.id;
  }

  if (!existing) {
    const createdPayment = await params.db.payment.create({
      data: {
      amountCents: params.amountPaidCents,
      businessId: membership.businessId,
      businessSubmissionId: membership.business.submissions[0].id,
      currency: "eur",
      method: params.method,
      paidAt: params.paidAt,
      purpose,
      status: "PAID",
      stripeCheckoutSessionId: params.sessionId ?? null,
      stripeInvoiceId: params.invoiceId ?? null,
      stripeLastEventId: params.eventId ?? null,
      stripePaymentIntentId: params.paymentIntentId ?? null,
      stripeSubscriptionId: refundedRepurchase ? params.subscriptionId ?? null : null,
      userId: membership.business.submissions[0].userId,
      },
    });
    finalizedPaymentId = createdPayment.id;
  }
  await params.db.businessMembership.update({
    where: { id: membership.id },
    data: {
      annualPriceCents: LISTING_OFFER.renewalPriceCents,
      currentPeriodEnd: period.currentPeriodEnd,
      currentPeriodStart: period.currentPeriodStart,
      entitlementRevokedAt: null,
      graceEndsAt: period.graceEndsAt,
      stripeSubscriptionId: params.subscriptionId ?? undefined,
      stripeCustomerId: params.stripeCustomerId ?? undefined,
      stripeSubscriptionStatus: params.subscriptionId ? params.stripeSubscriptionStatus ?? "active" : undefined,
      // Cycle invoices preserve the established recurring authority when no new
      // renewal preference was supplied.
      automaticRenewal: params.subscriptionId && params.automaticRenewal !== undefined ? params.automaticRenewal : undefined,
      recurringPaymentReady: params.subscriptionId && params.automaticRenewal !== undefined ? params.automaticRenewal : undefined,
      stripeCancelAtPeriodEnd: params.subscriptionId
        ? params.stripeCancelAtPeriodEnd ?? (params.automaticRenewal !== undefined ? false : undefined) : undefined,
    },
  });

  // A successful paid term makes any pending failure notice for this
  // membership obsolete, including one from an older invoice.
  await params.db.membershipFailedPaymentDelivery.updateMany({
    where: { membershipId: membership.id, acceptedAt: null, canceledAt: null },
    data: { canceledAt: new Date(), cancelReason: "membership_payment_succeeded" },
  });

  if (refundedRepurchase) {
    await params.db.businessSubmission.update({
      where: { id: membership.business.submissions[0].id },
      data: { paymentStatus: "PAID" },
    });
  }

  // Keep the notification obligation in the same transaction as the paid term.
  // Duplicate and historical payments return above and cannot create old mail.
  await params.db.membershipPaymentOutcomeDelivery.create({
    data: {
      paymentId: finalizedPaymentId!,
      membershipId: membership.id,
      periodEnd: period.currentPeriodEnd,
      businessName: membership.business.name,
    },
  });

  return { duplicate: false, membership, paymentId: finalizedPaymentId, purpose };
}

export function getPaymentPurposeLabel(purpose: PaymentPurpose, locale: "en" | "it") {
  const labels = locale === "it"
    ? { ANNUAL_RENEWAL: "Rinnovo annuale", INITIAL_MEMBERSHIP: "Membership iniziale", REACTIVATION: "Riattivazione" }
    : { ANNUAL_RENEWAL: "Annual renewal", INITIAL_MEMBERSHIP: "Initial membership", REACTIVATION: "Reactivation" };
  return labels[purpose];
}
