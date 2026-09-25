import type { Payment, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";

import { DEFAULT_CURRENCY } from "@/lib/payment";
import { isInitialElementEligible } from "@/lib/no-email-payment";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

export const EMBEDDED_SUBSCRIPTION_FLOW = "INITIAL_SUBSCRIPTION_ELEMENT";
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
type Operation = "product" | "customer" | "subscription";
type SetupDb = Pick<PrismaClient, "businessSubmission" | "payment">;

/**
 * Stripe and SQLite cannot commit together. An operation is recorded before
 * the Stripe call. Retries inside Stripe's idempotency window replay that call;
 * an unresolved older operation fails closed for manual reconciliation.
 */
async function beginOperation(db: SetupDb, payment: Payment, operation: Operation, now: Date) {
  if (payment.stripeSetupOperation) {
    if (payment.stripeSetupOperation !== operation || !payment.stripeSetupStartedAt ||
      now.getTime() - payment.stripeSetupStartedAt.getTime() >= RETRY_WINDOW_MS) {
      throw new Error("embedded_subscription_reconciliation_required");
    }
    return payment;
  }
  const claimed = await db.payment.updateMany({
    where: { id: payment.id, stripeSetupOperation: null, status: "PENDING_PAYMENT" },
    data: { stripeSetupOperation: operation, stripeSetupStartedAt: now },
  });
  if (claimed.count !== 1) throw new Error("embedded_subscription_concurrent_change");
  return { ...payment, stripeSetupOperation: operation, stripeSetupStartedAt: now };
}

async function finishOperation(db: SetupDb, payment: Payment, operation: Operation, data: {
  stripeProductId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
}) {
  const saved = await db.payment.updateMany({
    where: {
      id: payment.id, stripeSetupOperation: operation,
      stripeSetupStartedAt: payment.stripeSetupStartedAt,
      status: "PENDING_PAYMENT",
    },
    data: { ...data, stripeSetupOperation: null, stripeSetupStartedAt: null },
  });
  if (saved.count !== 1) throw new Error("embedded_subscription_concurrent_change");
  return db.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

function invoiceFromSubscription(subscription: Stripe.Subscription) {
  return typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
}

function intentIdFromInvoice(invoice: Stripe.Invoice) {
  const intent = invoice.payments?.data.find((item) => item.payment.type === "payment_intent")?.payment.payment_intent;
  return typeof intent === "string" ? intent : intent?.id ?? null;
}

function matchesAnnualPrice(subscription: Stripe.Subscription, payment: Pick<Payment, "amountCents" | "currency" | "stripeProductId">) {
  const item = subscription.items.data[0];
  const productId = typeof item?.price.product === "string" ? item.price.product : item?.price.product.id;
  return subscription.items.data.length === 1 && item?.quantity === 1 &&
    item.price.currency === payment.currency && item.price.unit_amount === payment.amountCents &&
    item.price.recurring?.interval === "year" && (item.price.recurring.interval_count || 1) === 1 &&
    productId === payment.stripeProductId;
}

/** Called only by a trusted operator after locating the exact Stripe ID. */
export async function reconcileEmbeddedSubscriptionOperation(params: {
  operation: Operation; paymentId: string; stripeObjectId: string;
}, dependencies: { db?: SetupDb; stripe?: Stripe } = {}) {
  const db = dependencies.db ?? prisma;
  const stripe = dependencies.stripe ?? getStripe();
  const payment = await db.payment.findUnique({
    where: { id: params.paymentId }, include: { businessSubmission: true },
  });
  if (!payment || payment.status !== "PENDING_PAYMENT" ||
    payment.stripeSetupOperation !== params.operation ||
    !payment.stripeSetupStartedAt || !payment.id.startsWith("initial-element:") ||
    !payment.businessSubmission.ownerEmail.trim()) throw new Error("embedded_subscription_reconciliation_state_mismatch");

  if (params.operation === "product") {
    const product = await stripe.products.retrieve(params.stripeObjectId);
    if (product.deleted || product.id !== params.stripeObjectId || payment.stripeProductId || product.metadata.paymentId !== payment.id ||
      product.metadata.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW) throw new Error("embedded_subscription_reconciliation_object_mismatch");
    return finishOperation(db, payment, "product", { stripeProductId: product.id });
  }
  if (params.operation === "customer") {
    const customer = await stripe.customers.retrieve(params.stripeObjectId);
    if (customer.deleted || customer.id !== params.stripeObjectId || payment.stripeCustomerId || customer.metadata.paymentId !== payment.id ||
      customer.metadata.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW ||
      customer.email?.trim() !== payment.businessSubmission.ownerEmail.trim()) {
      throw new Error("embedded_subscription_reconciliation_object_mismatch");
    }
    return finishOperation(db, payment, "customer", { stripeCustomerId: customer.id });
  }
  const subscription = await stripe.subscriptions.retrieve(params.stripeObjectId, {
    expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
  });
  const invoice = invoiceFromSubscription(subscription);
  const intentId = invoice ? intentIdFromInvoice(invoice) : null;
  if (subscription.id !== params.stripeObjectId || payment.stripeSubscriptionId || !payment.stripeProductId || !payment.stripeCustomerId ||
    subscription.metadata.paymentId !== payment.id ||
    subscription.metadata.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW ||
    subscription.customer !== payment.stripeCustomerId ||
    !invoice || !intentId || invoice.amount_due !== payment.amountCents ||
    invoice.currency !== payment.currency ||
    !matchesAnnualPrice(subscription, payment)) {
    throw new Error("embedded_subscription_reconciliation_object_mismatch");
  }
  return finishOperation(db, payment, "subscription", {
    stripeSubscriptionId: subscription.id, stripeInvoiceId: invoice.id, stripePaymentIntentId: intentId,
  });
}

export async function getVerifiedInitialSubscriptionInvoice(invoice: Stripe.Invoice, dependencies: { db?: SetupDb; stripe?: Stripe } = {}) {
  if (invoice.billing_reason !== "subscription_create" || invoice.currency !== DEFAULT_CURRENCY) return null;
  const payment = await (dependencies.db ?? prisma).payment.findUnique({
    where: { stripeInvoiceId: invoice.id }, include: { businessSubmission: true },
  });
  if (!payment || !payment.stripeSubscriptionId || !payment.stripeCustomerId ||
    payment.stripeCheckoutSessionId || payment.purpose !== "INITIAL_MEMBERSHIP" ||
    payment.method !== "STRIPE_CHECKOUT" || !payment.businessSubmission.ownerEmail.trim() ||
    !payment.businessSubmission.automaticRenewalAtAcceptance ||
    invoice.amount_due !== payment.amountCents || invoice.amount_paid !== payment.amountCents || invoice.status !== "paid" ||
    invoice.parent?.subscription_details?.subscription !== payment.stripeSubscriptionId ||
    invoice.customer !== payment.stripeCustomerId ||
    invoice.parent.subscription_details.metadata?.paymentId !== payment.id ||
    invoice.parent.subscription_details.metadata?.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW) return null;
  const paidIntent = invoice.payments?.data.find((item) => item.status === "paid" &&
    item.payment.type === "payment_intent")?.payment.payment_intent;
  const paidIntentId = typeof paidIntent === "string" ? paidIntent : paidIntent?.id;
  if (!paidIntentId || paidIntentId !== payment.stripePaymentIntentId) return null;
  const stripe = dependencies.stripe ?? getStripe();
  const [subscription, intent] = await Promise.all([
    stripe.subscriptions.retrieve(payment.stripeSubscriptionId),
    stripe.paymentIntents.retrieve(payment.stripePaymentIntentId!),
  ]);
  if (intent.status !== "succeeded" || intent.amount !== payment.amountCents ||
    intent.amount_received !== payment.amountCents || intent.currency !== payment.currency ||
    intent.customer !== payment.stripeCustomerId) return null;
  if (subscription.customer !== payment.stripeCustomerId ||
    subscription.status === "incomplete" || subscription.status === "incomplete_expired" ||
    subscription.metadata.paymentId !== payment.id ||
    subscription.metadata.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW ||
    !matchesAnnualPrice(subscription, payment)) return null;
  return { payment, subscription };
}

export async function ensureEmbeddedSubscription(submissionId: string, dependencies: {
  db?: SetupDb; stripe?: Stripe; now?: Date;
} = {}) {
  const db = dependencies.db ?? prisma;
  const stripe = dependencies.stripe ?? getStripe();
  const now = dependencies.now ?? new Date();
  const submission = await db.businessSubmission.findUnique({
    where: { id: submissionId }, include: { user: { select: { role: true } } },
  });
  if (!submission || !submission.ownerEmail.trim() || !submission.automaticRenewalAtAcceptance ||
    !isInitialElementEligible({ ...submission, submittingUserRole: submission.user.role })) return null;

  const paid = await db.payment.findFirst({
    where: { businessSubmissionId: submissionId, purpose: "INITIAL_MEMBERSHIP", status: "PAID" },
    select: { id: true },
  });
  if (paid) return null;
  const priorCheckout = await db.payment.findMany({
    where: { businessSubmissionId: submissionId, status: "PENDING_PAYMENT", stripeCheckoutSessionId: { not: null } },
    select: { stripeCheckoutSessionId: true },
  });
  for (const prior of priorCheckout) {
    const session = await stripe.checkout.sessions.retrieve(prior.stripeCheckoutSessionId!);
    if (session.payment_status === "paid" || session.status === "complete") return null;
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  }

  const id = `initial-element:${submissionId}`;
  let payment = await db.payment.upsert({
    where: { id },
    create: {
      id, businessSubmissionId: submissionId, userId: submission.userId,
      partnerUserId: submission.user.role === "GETTER" ? submission.userId : null,
      amountCents: submission.amountOwedCents, currency: DEFAULT_CURRENCY,
      method: "STRIPE_CHECKOUT", status: "PENDING_PAYMENT",
    },
    update: {},
  });
  if (payment.status !== "PENDING_PAYMENT" || payment.amountCents !== submission.amountOwedCents ||
    payment.currency !== DEFAULT_CURRENCY || payment.stripeCheckoutSessionId ||
    payment.userId !== submission.userId) return null;
  if (payment.stripePaymentIntentId && !payment.stripeSubscriptionId) {
    throw new Error("embedded_subscription_conflicting_manual_payment");
  }

  if (!payment.stripeProductId) {
    payment = await beginOperation(db, payment, "product", now);
    const product = await stripe.products.create({
      name: `Salento Local annual membership: ${submission.businessName}`,
      metadata: { businessSubmissionId: submissionId, paymentId: id, paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW },
    }, { idempotencyKey: `initial-element:product:${id}` });
    payment = await finishOperation(db, payment, "product", { stripeProductId: product.id });
  }
  if (!payment.stripeCustomerId) {
    payment = await beginOperation(db, payment, "customer", now);
    const customer = await stripe.customers.create({
      email: submission.ownerEmail.trim(), name: submission.ownerName || submission.businessName,
      phone: submission.ownerPhone || undefined,
      metadata: { businessSubmissionId: submissionId, paymentId: id, paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW },
    }, { idempotencyKey: `initial-element:customer:${id}` });
    payment = await finishOperation(db, payment, "customer", { stripeCustomerId: customer.id });
  }
  const [product, customer] = await Promise.all([
    stripe.products.retrieve(payment.stripeProductId!),
    stripe.customers.retrieve(payment.stripeCustomerId!),
  ]);
  if (product.deleted || product.metadata.paymentId !== id || customer.deleted ||
    customer.metadata.paymentId !== id || customer.email?.trim() !== submission.ownerEmail.trim()) {
    throw new Error("embedded_subscription_customer_or_product_mismatch");
  }
  if (!payment.stripeSubscriptionId) {
    payment = await beginOperation(db, payment, "subscription", now);
    const subscription = await stripe.subscriptions.create({
      customer: payment.stripeCustomerId!,
      items: [{ price_data: { currency: DEFAULT_CURRENCY, product: payment.stripeProductId!,
        recurring: { interval: "year" }, unit_amount: payment.amountCents } }],
      metadata: {
        businessSubmissionId: submissionId, paymentId: id,
        paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW, userId: submission.userId,
        partnerId: payment.partnerUserId || "",
      },
      payment_behavior: "default_incomplete",
      payment_settings: { payment_method_types: ["card"], save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
    }, { idempotencyKey: `initial-element:subscription:${id}:${payment.stripeSetupGeneration}` });
    const invoice = invoiceFromSubscription(subscription);
    const intentId = invoice ? intentIdFromInvoice(invoice) : null;
    if (!invoice?.id || !intentId || invoice.amount_due !== payment.amountCents ||
      invoice.currency !== DEFAULT_CURRENCY) throw new Error("embedded_subscription_invoice_mismatch");
    payment = await finishOperation(db, payment, "subscription", {
      stripeSubscriptionId: subscription.id, stripeInvoiceId: invoice.id, stripePaymentIntentId: intentId,
    });
  }
  const subscription = await stripe.subscriptions.retrieve(payment.stripeSubscriptionId!, {
    expand: ["latest_invoice.confirmation_secret", "latest_invoice.payments"],
  });
  const invoice = invoiceFromSubscription(subscription);
  if (subscription.status === "incomplete_expired") {
    if (!invoice || invoice.id !== payment.stripeInvoiceId || invoice.status === "paid") {
      throw new Error("embedded_subscription_expired_state_mismatch");
    }
    const reset = await db.payment.updateMany({
      where: {
        id: payment.id, status: "PENDING_PAYMENT", stripeSetupOperation: null,
        stripeSubscriptionId: subscription.id, stripeInvoiceId: invoice.id,
      },
      data: {
        stripeSubscriptionId: null, stripeInvoiceId: null, stripePaymentIntentId: null,
        stripeSetupGeneration: { increment: 1 },
      },
    });
    if (reset.count !== 1) throw new Error("embedded_subscription_concurrent_change");
    return ensureEmbeddedSubscription(submissionId, dependencies);
  }
  if (subscription.customer !== payment.stripeCustomerId || !invoice || invoice.id !== payment.stripeInvoiceId ||
    invoice.amount_due !== payment.amountCents || invoice.currency !== DEFAULT_CURRENCY ||
    subscription.metadata.paymentId !== id || subscription.metadata.paymentFlow !== EMBEDDED_SUBSCRIPTION_FLOW ||
    !matchesAnnualPrice(subscription, payment) ||
    !invoice.confirmation_secret?.client_secret) throw new Error("embedded_subscription_state_mismatch");
  return payment;
}
