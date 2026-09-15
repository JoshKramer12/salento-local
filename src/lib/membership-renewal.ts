import type { PaymentPurpose, PaymentRecordMethod, Prisma, PrismaClient } from "@prisma/client";

import { getBusinessMembershipPeriod, getBusinessMembershipStatus } from "@/lib/business-membership";
import { LISTING_OFFER } from "@/lib/listing-offer";

type RenewalDb = PrismaClient | Prisma.TransactionClient;

export function getMembershipPaymentPurpose(params: {
  currentPeriodEnd: Date;
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
}) {
  const membership = await params.db.businessMembership.findFirst({
    where: params.subscriptionId
      ? { stripeSubscriptionId: params.subscriptionId }
      : params.businessId ? { businessId: params.businessId } : { id: "__missing_membership__" },
    include: {
      business: {
        select: {
          id: true,
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

  let finalizedPaymentId: string | null = null;
  // Use the authoritative confirmation time, not when a manual bank-transfer
  // instruction was generated. A transfer settling after grace is a true
  // reactivation even if its pending record began while the page was active.
  const period = getBusinessMembershipPeriod({
    currentPeriodEnd: membership.currentPeriodEnd,
    graceEndsAt: membership.graceEndsAt,
    paidAt: params.paidAt,
  });
  const purpose = getMembershipPaymentPurpose({
    currentPeriodEnd: membership.currentPeriodEnd,
    graceEndsAt: membership.graceEndsAt,
    now: params.paidAt,
  });

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
      where: { id: existing.id }, select: { status: true },
    });
    if (existingPayment?.status === "PAID") return { duplicate: true, membership };
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
      stripeSubscriptionStatus: params.subscriptionId ? "active" : undefined,
      automaticRenewal: params.subscriptionId ? Boolean(params.automaticRenewal) : undefined,
      recurringPaymentReady: params.subscriptionId ? Boolean(params.automaticRenewal) : undefined,
      stripeCancelAtPeriodEnd: params.subscriptionId ? false : undefined,
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
