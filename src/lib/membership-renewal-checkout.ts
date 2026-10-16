import type { PaymentPurpose } from "@prisma/client";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { buildStripeCheckoutMetadata, getAppUrl, getStripeEuBankTransferCountry } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { inspectMembershipRenewalRecovery } from "@/lib/membership-renewal-recovery";
import { extractStripeBankTransferInstructions, type StripeBankTransferInstructions } from "@/lib/stripe-checkout";

/** A deliberately separate Checkout path: it never touches submission status,
 * publication, QR polling, receipts, or Partner commission finalization. */
export async function ensureMembershipRenewalCheckout(params: {
  appUrl?: string | null;
  automaticRenewal?: boolean;
  businessId: string;
  userId: string;
}) {
  const membership = await prisma.businessMembership.findUnique({
    where: { businessId: params.businessId },
    include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { id: true }, take: 1 } } } },
  });
  const submission = membership?.business.submissions[0];
  if (!membership || !submission) return null;
  if (await prisma.payment.findFirst({ where: { businessId: params.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null }, OR: [{ status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } }, { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } }, { status: "REFUNDED", refundStatus: { not: "succeeded" } }] }, select: { id: true } })) return null;
  const stripe = getStripe();
  const appUrl = params.appUrl?.replace(/\/+$/, "") || getAppUrl();
  const pending = await prisma.payment.findFirst({
    where: { businessId: params.businessId, purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "PENDING_PAYMENT" },
    orderBy: { createdAt: "desc" }, select: { id: true, stripeCheckoutSessionId: true },
  });
  if (pending?.stripeCheckoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(pending.stripeCheckoutSessionId);
      if (session.status === "open" && session.url) return { url: session.url };
    } catch { /* create a fresh session below */ }
  }
  const automaticRenewal = Boolean(params.automaticRenewal);
  const metadata = buildStripeCheckoutMetadata({ businessId: params.businessId, businessSubmissionId: submission.id, paymentFlow: "MEMBERSHIP_RENEWAL", automaticRenewal, userId: params.userId });
  const session = await stripe.checkout.sessions.create({
    cancel_url: `${appUrl}/dashboard?membership=cancelled`,
    line_items: [{ price_data: { currency: "eur", product_data: { name: `Salento Local annual membership: ${membership.business.name}` }, ...(automaticRenewal ? { recurring: { interval: "year" as const } } : {}), unit_amount: LISTING_OFFER.renewalPriceCents }, quantity: 1 }],
    metadata,
    mode: automaticRenewal ? "subscription" : "payment",
    ...(automaticRenewal ? { subscription_data: { metadata } } : {}),
    success_url: `${appUrl}/dashboard?membership=renewed&session={CHECKOUT_SESSION_ID}`,
  });
  const purpose: PaymentPurpose = new Date() < membership.graceEndsAt ? "ANNUAL_RENEWAL" : "REACTIVATION";
  if (pending) {
    await prisma.payment.update({ where: { id: pending.id }, data: { stripeCheckoutSessionId: session.id } });
  } else {
    await prisma.payment.create({ data: { amountCents: LISTING_OFFER.renewalPriceCents, businessId: params.businessId, businessSubmissionId: submission.id, method: "STRIPE_CHECKOUT", purpose, status: "PENDING_PAYMENT", stripeCheckoutSessionId: session.id, userId: params.userId } });
  }
  return { url: session.url };
}

/** Manual only: this cannot create a recurring bank debit and does not touch
 * the initial listing publication flow. Stripe's succeeded event is required
 * before the membership is extended or reactivated. */
export async function ensureMembershipRenewalBankTransferIntent(params: {
  businessId: string;
  userId: string;
}): Promise<{ instructions: StripeBankTransferInstructions | null; paymentIntentId: string; status: string } | null> {
  const membership = await prisma.businessMembership.findUnique({
    where: { businessId: params.businessId },
    include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { id: true, ownerEmail: true, ownerName: true, ownerPhone: true }, take: 1 } } } },
  });
  const submission = membership?.business.submissions[0];
  if (!membership || !submission) return null;
  if ((await inspectMembershipRenewalRecovery(params.businessId)).state !== "none") return null;
  if (await prisma.payment.findFirst({ where: { businessId: params.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null }, OR: [{ status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } }, { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } }, { status: "REFUNDED", refundStatus: { not: "succeeded" } }] }, select: { id: true } })) return null;
  const stripe = getStripe();
  const pending = await prisma.payment.findFirst({
    where: { businessId: params.businessId, method: "BANK_TRANSFER", purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "AWAITING_BANK_TRANSFER" },
    orderBy: { createdAt: "desc" }, select: { id: true, stripePaymentIntentId: true },
  });
  if (pending?.stripePaymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(pending.stripePaymentIntentId);
      return { instructions: extractStripeBankTransferInstructions(intent), paymentIntentId: intent.id, status: intent.status };
    } catch { /* replace an irretrievable intent below */ }
  }
  const customerId = membership.stripeCustomerId ?? (await stripe.customers.create({
    email: submission.ownerEmail || undefined,
    metadata: { businessId: params.businessId, businessSubmissionId: submission.id, userId: params.userId },
    name: submission.ownerName || membership.business.name,
    phone: submission.ownerPhone || undefined,
  })).id;
  const intent = await stripe.paymentIntents.create({
    amount: LISTING_OFFER.renewalPriceCents,
    confirm: true,
    currency: "eur",
    customer: customerId,
    description: `Salento Local membership renewal: ${membership.business.name}`,
    metadata: buildStripeCheckoutMetadata({ businessId: params.businessId, businessSubmissionId: submission.id, paymentFlow: "MEMBERSHIP_RENEWAL_BANK_TRANSFER", userId: params.userId }),
    payment_method_data: { type: "customer_balance" },
    payment_method_options: { customer_balance: { bank_transfer: { eu_bank_transfer: { country: getStripeEuBankTransferCountry() }, requested_address_types: ["iban"], type: "eu_bank_transfer" }, funding_type: "bank_transfer" } },
    payment_method_types: ["customer_balance"],
  });
  const instructions = extractStripeBankTransferInstructions(intent);
  const purpose: PaymentPurpose = new Date() < membership.graceEndsAt ? "ANNUAL_RENEWAL" : "REACTIVATION";
  const paymentData = { amountCents: LISTING_OFFER.renewalPriceCents, bankTransferReference: instructions?.reference ?? null, currency: intent.currency || "eur", purpose, stripePaymentIntentId: intent.id };
  if (pending) await prisma.payment.update({ where: { id: pending.id }, data: paymentData });
  else await prisma.payment.create({ data: { ...paymentData, businessId: params.businessId, businessSubmissionId: submission.id, method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER", userId: params.userId } });
  return { instructions, paymentIntentId: intent.id, status: intent.status };
}
