import type Stripe from "stripe";

import { LISTING_OFFER } from "@/lib/listing-offer";
import { prisma } from "@/lib/prisma";

async function verifyMembershipAndSubmission(businessId: string, submissionId: string) {
  const membership = await prisma.businessMembership.findUnique({
    where: { businessId },
    select: { business: { select: { submissions: {
      orderBy: { createdAt: "asc" }, take: 1, select: { id: true },
    } } } },
  });
  if (!membership || membership.business.submissions[0]?.id !== submissionId) {
    throw new Error("renewal_membership_association_missing");
  }
}

/** A Stripe success must refer to the pending local purchase created by us. */
export async function verifyCheckoutRenewalAssociation(session: Stripe.Checkout.Session) {
  const businessId = session.metadata?.businessId?.trim();
  const submissionId = session.metadata?.businessSubmissionId?.trim();
  const userId = session.metadata?.userId?.trim();
  if (session.payment_status !== "paid" || session.amount_total !== LISTING_OFFER.renewalPriceCents ||
    session.currency !== "eur" || !businessId || !submissionId || !userId) {
    throw new Error("renewal_checkout_payment_unverified");
  }
  const payment = await prisma.payment.findUnique({ where: { stripeCheckoutSessionId: session.id } });
  if (!payment || payment.businessId !== businessId || payment.businessSubmissionId !== submissionId ||
    payment.userId !== userId || payment.method !== "STRIPE_CHECKOUT" ||
    payment.amountCents !== LISTING_OFFER.renewalPriceCents || payment.currency !== "eur" ||
    (payment.status === "PENDING_PAYMENT" && !["ANNUAL_RENEWAL", "REACTIVATION"].includes(payment.purpose)) ||
    !["PENDING_PAYMENT", "PAID", "REFUNDED"].includes(payment.status)) {
    throw new Error("renewal_checkout_payment_association_missing");
  }
  await verifyMembershipAndSubmission(businessId, submissionId);
  return payment;
}

/** A bank settlement is bound to one exact locally prepared PaymentIntent. */
export async function verifyBankRenewalAssociation(intent: Stripe.PaymentIntent) {
  const businessId = intent.metadata?.businessId?.trim();
  const submissionId = intent.metadata?.businessSubmissionId?.trim();
  const userId = intent.metadata?.userId?.trim();
  if (!businessId || !submissionId || !userId) throw new Error("renewal_bank_transfer_metadata_missing");
  const payments = await prisma.payment.findMany({
    where: { stripePaymentIntentId: intent.id }, take: 2,
  });
  const payment = payments[0];
  if (payments.length !== 1 || !payment || payment.businessId !== businessId ||
    payment.businessSubmissionId !== submissionId || payment.userId !== userId ||
    payment.method !== "BANK_TRANSFER" || payment.amountCents !== LISTING_OFFER.renewalPriceCents ||
    payment.currency !== "eur" ||
    (payment.status === "AWAITING_BANK_TRANSFER" && !["ANNUAL_RENEWAL", "REACTIVATION"].includes(payment.purpose)) ||
    !["AWAITING_BANK_TRANSFER", "PAID", "REFUNDED"].includes(payment.status)) {
    throw new Error("renewal_bank_transfer_payment_association_missing");
  }
  await verifyMembershipAndSubmission(businessId, submissionId);
  return payment;
}
