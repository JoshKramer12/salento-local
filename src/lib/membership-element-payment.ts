import type { Payment, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { beginEmbeddedPaymentOperation, ensureEmbeddedPaymentSubscription, finishEmbeddedPaymentOperation, matchesAnnualPrice, MEMBERSHIP_SUBSCRIPTION_FLOW } from "@/lib/embedded-subscription";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { finalizeMembershipRenewalPayment, getMembershipPaymentPurpose } from "@/lib/membership-renewal";
import { attemptMembershipPaymentOutcomeDelivery } from "@/lib/membership-payment-outcomes";
import { matchesManualElementPaymentIntent } from "@/lib/no-email-payment";
import { ensurePartnerRefundRepurchaseCommissionForPayment, ensurePartnerRenewalCommissionForPayment } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { inspectMembershipRenewalRecovery } from "@/lib/membership-renewal-recovery";

export const MEMBERSHIP_ELEMENT_FLOW = "MEMBERSHIP_PAYMENT_ELEMENT";
type Dependencies = { db?: PrismaClient; stripe?: Stripe; now?: Date };

export async function ensureMembershipElementPayment(params: {
  businessId: string; userId: string; automaticRenewal?: boolean;
}, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const stripe = dependencies.stripe ?? getStripe();
  const now = dependencies.now ?? new Date();
  const membership = await db.businessMembership.findUnique({
    where: { businessId: params.businessId },
    include: { business: { select: { name: true, submissions: {
      orderBy: { createdAt: "asc" }, take: 1,
      select: { id: true, ownerEmail: true, ownerName: true, ownerPhone: true },
    } } } },
  });
  const submission = membership?.business.submissions[0];
  if (!membership || !submission || (params.automaticRenewal && !submission.ownerEmail.trim())) return null;
  if ((await inspectMembershipRenewalRecovery(params.businessId, { db, stripe })).state !== "none") return null;
  // Do not start another subscription alongside an existing live recurring term.
  if (params.automaticRenewal && membership.stripeSubscriptionId) {
    const prior = await stripe.subscriptions.retrieve(membership.stripeSubscriptionId);
    if (!["canceled", "incomplete_expired"].includes(prior.status)) return null;
  }
  if (await db.payment.findFirst({ where: {
    businessId: params.businessId, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: { not: null },
    OR: [
      { status: "PAID", method: "BANK_TRANSFER", refundRequestedByUserId: { not: null }, refundStatus: { not: "support_closed" } },
      { status: "PAID", refundStatus: { notIn: ["failed", "canceled", "support_closed"] } },
      { status: "REFUNDED", refundStatus: { not: "succeeded" } },
    ],
  }, select: { id: true } })) return null;
  if (await db.payment.findFirst({ where: {
    businessId: params.businessId, method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER",
    purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] },
  }, select: { id: true } })) return null;

  // Historical sessions stay readable; an open unpaid session is expired before
  // a new in-site intent can be created, preventing two payable alternatives.
  const historical = await db.payment.findMany({ where: {
    businessId: params.businessId, status: "PENDING_PAYMENT", stripeCheckoutSessionId: { not: null },
    purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] },
  }, select: { stripeCheckoutSessionId: true } });
  for (const prior of historical) {
    const session = await stripe.checkout.sessions.retrieve(prior.stripeCheckoutSessionId!);
    if (session.payment_status === "paid" || session.status === "complete") return null;
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  }

  // Both card choices share one payment per membership cycle. Switching an
  // already prepared one-time intent into a subscription fails closed.
  const id = `membership-element:${membership.id}:${membership.currentPeriodEnd.getTime()}:${membership.entitlementRevokedAt?.getTime() ?? 0}`;
  let payment = await db.payment.upsert({ where: { id }, update: {}, create: {
    id, businessId: params.businessId, businessSubmissionId: submission.id, userId: params.userId,
    amountCents: LISTING_OFFER.renewalPriceCents, currency: "eur", method: "STRIPE_CHECKOUT",
    purpose: getMembershipPaymentPurpose({ ...membership, now }), status: "PENDING_PAYMENT",
  } });
  if (payment.businessId !== params.businessId || payment.businessSubmissionId !== submission.id ||
    payment.method !== "STRIPE_CHECKOUT" || payment.stripeCheckoutSessionId ||
    payment.amountCents !== LISTING_OFFER.renewalPriceCents || payment.currency !== "eur" ||
    payment.status !== "PENDING_PAYMENT") return null;
  const metadata = {
    businessId: params.businessId, businessSubmissionId: submission.id, paymentId: id,
    userId: payment.userId, partnerId: payment.partnerUserId || "",
    paymentFlow: params.automaticRenewal ? MEMBERSHIP_SUBSCRIPTION_FLOW : MEMBERSHIP_ELEMENT_FLOW,
  };
  if (params.automaticRenewal) {
    if (payment.stripePaymentIntentId && !payment.stripeSubscriptionId) return null;
    return ensureEmbeddedPaymentSubscription(payment, {
      businessName: membership.business.name, ownerEmail: submission.ownerEmail.trim(),
      ownerName: submission.ownerName, ownerPhone: submission.ownerPhone,
      flow: MEMBERSHIP_SUBSCRIPTION_FLOW, metadata,
    }, { db, stripe, now });
  }
  if (payment.stripeSubscriptionId || payment.stripeCustomerId || payment.stripeProductId || payment.stripeInvoiceId) return null;
  if (payment.stripePaymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (!matchesMembershipIntent(intent, payment)) throw new Error("membership_element_intent_mismatch");
    if (intent.status !== "canceled") return payment;
    const reset = await db.payment.updateMany({ where: {
      id, status: "PENDING_PAYMENT", stripePaymentIntentId: intent.id, stripeSetupOperation: null,
    }, data: { stripePaymentIntentId: null, stripeSetupGeneration: { increment: 1 } } });
    if (reset.count !== 1) throw new Error("membership_element_concurrent_change");
    payment = await db.payment.findUniqueOrThrow({ where: { id } });
  }
  payment = await beginEmbeddedPaymentOperation(db, payment, "intent", now);
  const intent = await stripe.paymentIntents.create({
    amount: payment.amountCents, currency: payment.currency, payment_method_types: ["card"],
    description: `Salento Local membership renewal: ${membership.business.name}`,
    ...(submission.ownerEmail.trim() ? { receipt_email: submission.ownerEmail.trim() } : {}),
    metadata,
  }, { idempotencyKey: `${id}:intent:${payment.stripeSetupGeneration}` });
  return finishEmbeddedPaymentOperation(db, payment, "intent", { stripePaymentIntentId: intent.id });
}

/** Operator recovery for a lost intent response beyond Stripe's retry window. */
export async function reconcileMembershipElementIntent(params: {
  paymentId: string; intentId: string;
}, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const payment = await db.payment.findUnique({ where: { id: params.paymentId } });
  if (!payment?.id.startsWith("membership-element:") || payment.status !== "PENDING_PAYMENT" ||
    payment.stripeSetupOperation !== "intent" || !payment.stripeSetupStartedAt ||
    payment.stripePaymentIntentId) throw new Error("membership_element_reconciliation_state_mismatch");
  const intent = await (dependencies.stripe ?? getStripe()).paymentIntents.retrieve(params.intentId);
  if (!matchesMembershipIntent(intent, { ...payment, stripePaymentIntentId: params.intentId })) {
    throw new Error("membership_element_reconciliation_intent_mismatch");
  }
  return finishEmbeddedPaymentOperation(db, payment, "intent", { stripePaymentIntentId: intent.id });
}

function matchesMembershipIntent(intent: Stripe.PaymentIntent, payment: Payment) {
  return matchesManualElementPaymentIntent(intent, payment, MEMBERSHIP_ELEMENT_FLOW) &&
    intent.metadata.businessId === payment.businessId && payment.method === "STRIPE_CHECKOUT" &&
    !payment.stripeSubscriptionId && !payment.stripeInvoiceId;
}

/** A provider read validates the exact Payment/invoice/subscription association.
 * The browser's query string or navigation is never a paid signal. */
export async function getMembershipElementSnapshot(payment: Payment, dependencies: Dependencies = {}) {
  if (!payment.id.startsWith("membership-element:") || !payment.businessId ||
    payment.stripeCheckoutSessionId || payment.method !== "STRIPE_CHECKOUT" ||
    !payment.stripePaymentIntentId || payment.stripeSetupOperation ||
    payment.amountCents !== LISTING_OFFER.renewalPriceCents || payment.currency !== "eur") {
    throw new Error("membership_element_payment_mismatch");
  }
  const stripe = dependencies.stripe ?? getStripe();
  const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
  if (!payment.stripeSubscriptionId) {
    if (!matchesMembershipIntent(intent, payment)) throw new Error("membership_element_intent_mismatch");
    return { intent, subscription: null, invoice: null, paid: intent.status === "succeeded" && intent.amount_received === payment.amountCents };
  }
  const subscription = await stripe.subscriptions.retrieve(payment.stripeSubscriptionId, {
    expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
  });
  const invoice = typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
  const invoiceIntent = invoice?.payments?.data.find((entry) => entry.payment.type === "payment_intent")?.payment.payment_intent;
  const invoiceIntentId = typeof invoiceIntent === "string" ? invoiceIntent : invoiceIntent?.id;
  if (!invoice || invoice.id !== payment.stripeInvoiceId || invoiceIntentId !== intent.id ||
    invoice.billing_reason !== "subscription_create" || invoice.amount_due !== payment.amountCents ||
    invoice.currency !== payment.currency || invoice.customer !== payment.stripeCustomerId ||
    subscription.customer !== payment.stripeCustomerId || intent.customer !== payment.stripeCustomerId ||
    intent.amount !== payment.amountCents || intent.currency !== payment.currency ||
    !matchesAnnualPrice(subscription, payment) ||
    subscription.metadata.paymentId !== payment.id || subscription.metadata.businessId !== payment.businessId ||
    subscription.metadata.businessSubmissionId !== payment.businessSubmissionId ||
    subscription.metadata.userId !== payment.userId || subscription.metadata.paymentFlow !== MEMBERSHIP_SUBSCRIPTION_FLOW) {
    throw new Error("membership_element_subscription_mismatch");
  }
  const paid = invoice.status === "paid" && invoice.amount_paid === payment.amountCents &&
    intent.status === "succeeded" && intent.amount_received === payment.amountCents &&
    !["incomplete", "incomplete_expired"].includes(subscription.status);
  return { intent, subscription, invoice, paid };
}

/** Polling and webhooks use the existing renewal finalizer and commission rules. */
export async function syncMembershipElementPayment(paymentId: string, dependencies: Dependencies & {
  eventId?: string; eventType?: string;
  renewalCommission?: typeof ensurePartnerRenewalCommissionForPayment;
  repurchaseCommission?: typeof ensurePartnerRefundRepurchaseCommissionForPayment;
  attemptOutcome?: typeof attemptMembershipPaymentOutcomeDelivery;
} = {}) {
  const db = dependencies.db ?? prisma;
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.id.startsWith("membership-element:")) throw new Error("membership_element_payment_missing");
  if (payment.status === "REFUNDED" || payment.refundRequestedAt) return null;
  let result;
  if (payment.status === "PAID") {
    // Recover ledger work without re-extending the paid term.
    const membership = await db.businessMembership.findUniqueOrThrow({ where: { businessId: payment.businessId! } });
    result = { duplicate: true, membership, paymentId: payment.id, purpose: payment.purpose };
  } else {
    const snapshot = await getMembershipElementSnapshot(payment, dependencies);
    if (!snapshot.paid) return null;
    result = await db.$transaction((tx) => finalizeMembershipRenewalPayment({
      db: tx, businessId: payment.businessId, amountPaidCents: payment.amountCents,
      method: "STRIPE_CHECKOUT", paymentIntentId: snapshot.intent.id,
      invoiceId: snapshot.invoice?.id, subscriptionId: snapshot.subscription?.id,
      stripeCustomerId: payment.stripeCustomerId,
      automaticRenewal: Boolean(snapshot.subscription && !snapshot.subscription.cancel_at_period_end &&
        ["active", "trialing"].includes(snapshot.subscription.status)),
      stripeSubscriptionStatus: snapshot.subscription?.status,
      stripeCancelAtPeriodEnd: snapshot.subscription?.cancel_at_period_end,
      paidAt: snapshot.invoice?.status_transitions.paid_at
        ? new Date(snapshot.invoice.status_transitions.paid_at * 1000) : dependencies.now ?? new Date(),
      eventId: dependencies.eventId,
    }));
  }
  if (result?.paymentId) {
    const args = { paymentId: result.paymentId, sourceEventId: dependencies.eventId, sourceEventType: dependencies.eventType || "payment_element.sync" };
    await (dependencies.renewalCommission ?? ensurePartnerRenewalCommissionForPayment)(args);
    await (dependencies.repurchaseCommission ?? ensurePartnerRefundRepurchaseCommissionForPayment)(args);
    await (dependencies.attemptOutcome ?? attemptMembershipPaymentOutcomeDelivery)(result.paymentId);
  }
  return result;
}
