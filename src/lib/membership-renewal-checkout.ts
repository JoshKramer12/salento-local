import type { PaymentPurpose } from "@prisma/client";
import type Stripe from "stripe";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { buildStripeCheckoutMetadata, getAppUrl, getStripeEuBankTransferCountry } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { assertFinancialPaymentAllowed, assertLivePaymentCreationScope, assertReusableStripeObjectMode, assertStripeObjectMode, configuredStripeMode, getStripe } from "@/lib/stripe";
import { inspectMembershipRenewalRecovery } from "@/lib/membership-renewal-recovery";
import { extractStripeBankTransferInstructions, type StripeBankTransferInstructions } from "@/lib/stripe-checkout";

type Dependencies = { db?: typeof prisma; stripe?: Stripe };

/** A stored customer must have paid LIVE provenance before it can fund a LIVE
 * renewal. A subscription without a customer needs its own LIVE provenance. */
async function assertMembershipProviderMode(
  db: typeof prisma,
  membership: { businessId: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null },
) {
  if (configuredStripeMode() !== "live" || (!membership.stripeCustomerId && !membership.stripeSubscriptionId)) return;
  const livePayment = await db.payment.findFirst({ where: {
    businessId: membership.businessId,
    status: "PAID",
    stripeLivemode: true,
    ...(membership.stripeCustomerId
      ? { stripeCustomerId: membership.stripeCustomerId }
      : { stripeSubscriptionId: membership.stripeSubscriptionId }),
  }, select: { id: true } });
  if (!livePayment) throw new Error("stripe_payment_mode_mismatch");
}

/** A deliberately separate Checkout path: it never touches submission status,
 * publication, QR polling, receipts, or Partner commission finalization. */
export async function ensureMembershipRenewalCheckout(params: {
  appUrl?: string | null;
  automaticRenewal?: boolean;
  businessId: string;
  userId: string;
}, dependencies: Dependencies = {}) {
  assertFinancialPaymentAllowed();
  assertLivePaymentCreationScope(null, "renewal");
  const db = dependencies.db ?? prisma;
  const membership = await db.businessMembership.findUnique({
    where: { businessId: params.businessId },
    include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { id: true }, take: 1 } } } },
  });
  const submission = membership?.business.submissions[0];
  if (!membership || !submission) return null;
  await assertMembershipProviderMode(db, membership);
  if (await db.payment.findFirst({ where: { businessId: params.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null }, OR: [{ status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } }, { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } }, { status: "REFUNDED", refundStatus: { not: "succeeded" } }] }, select: { id: true } })) return null;
  const stripe = dependencies.stripe ?? getStripe();
  const appUrl = params.appUrl?.replace(/\/+$/, "") || getAppUrl();
  const pending = await db.payment.findFirst({
    where: { businessId: params.businessId, purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "PENDING_PAYMENT" },
    orderBy: { createdAt: "desc" }, select: { id: true, stripeCheckoutSessionId: true, stripeLivemode: true },
  });
  if (pending) assertReusableStripeObjectMode(pending.stripeLivemode);
  if (pending?.stripeCheckoutSessionId) {
    let session: Stripe.Checkout.Session | null = null;
    try {
      session = await stripe.checkout.sessions.retrieve(pending.stripeCheckoutSessionId);
    } catch { /* create a fresh session below */ }
    if (session) {
      assertStripeObjectMode(session.livemode);
      if (session.status === "open" && session.url) return { url: session.url };
    }
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
  assertStripeObjectMode(session.livemode);
  const purpose: PaymentPurpose = new Date() < membership.graceEndsAt ? "ANNUAL_RENEWAL" : "REACTIVATION";
  if (pending) {
    await db.payment.update({ where: { id: pending.id }, data: { stripeCheckoutSessionId: session.id, stripeLivemode: session.livemode } });
  } else {
    await db.payment.create({ data: { amountCents: LISTING_OFFER.renewalPriceCents, businessId: params.businessId, businessSubmissionId: submission.id, method: "STRIPE_CHECKOUT", purpose, status: "PENDING_PAYMENT", stripeCheckoutSessionId: session.id, stripeLivemode: session.livemode, userId: params.userId } });
  }
  return { url: session.url };
}

/** Manual only: this cannot create a recurring bank debit and does not touch
 * the initial listing publication flow. Stripe's succeeded event is required
 * before the membership is extended or reactivated. */
export async function ensureMembershipRenewalBankTransferIntent(params: {
  businessId: string;
  userId: string;
}, dependencies: Dependencies = {}): Promise<{ instructions: StripeBankTransferInstructions | null; paymentIntentId: string; status: string } | null> {
  assertFinancialPaymentAllowed();
  assertLivePaymentCreationScope(null, "renewal");
  const db = dependencies.db ?? prisma;
  const membership = await db.businessMembership.findUnique({
    where: { businessId: params.businessId },
    include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { id: true, ownerEmail: true, ownerName: true, ownerPhone: true }, take: 1 } } } },
  });
  const submission = membership?.business.submissions[0];
  if (!membership || !submission) return null;
  await assertMembershipProviderMode(db, membership);
  const stripe = dependencies.stripe ?? getStripe();
  if ((await inspectMembershipRenewalRecovery(params.businessId, { db, stripe })).state !== "none") return null;
  if (await db.payment.findFirst({ where: { businessId: params.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null }, OR: [{ status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } }, { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } }, { status: "REFUNDED", refundStatus: { not: "succeeded" } }] }, select: { id: true } })) return null;
  const pending = await db.payment.findFirst({
    where: { businessId: params.businessId, method: "BANK_TRANSFER", purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "AWAITING_BANK_TRANSFER" },
    orderBy: { createdAt: "desc" }, select: { id: true, stripePaymentIntentId: true, stripeLivemode: true },
  });
  if (pending) assertReusableStripeObjectMode(pending.stripeLivemode);
  if (pending?.stripePaymentIntentId) {
    let intent: Stripe.PaymentIntent | null = null;
    try {
      intent = await stripe.paymentIntents.retrieve(pending.stripePaymentIntentId);
    } catch { /* replace an irretrievable intent below */ }
    if (intent) {
      assertStripeObjectMode(intent.livemode);
      return { instructions: extractStripeBankTransferInstructions(intent), paymentIntentId: intent.id, status: intent.status };
    }
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
  assertStripeObjectMode(intent.livemode);
  const instructions = extractStripeBankTransferInstructions(intent);
  const purpose: PaymentPurpose = new Date() < membership.graceEndsAt ? "ANNUAL_RENEWAL" : "REACTIVATION";
  const paymentData = { amountCents: LISTING_OFFER.renewalPriceCents, bankTransferReference: instructions?.reference ?? null, currency: intent.currency || "eur", purpose, stripePaymentIntentId: intent.id, stripeLivemode: intent.livemode };
  if (pending) await db.payment.update({ where: { id: pending.id }, data: paymentData });
  else await db.payment.create({ data: { ...paymentData, businessId: params.businessId, businessSubmissionId: submission.id, method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER", userId: params.userId } });
  return { instructions, paymentIntentId: intent.id, status: intent.status };
}
