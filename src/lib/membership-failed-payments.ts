import type { Prisma, PrismaClient } from "@prisma/client";

import { sendTransactionalEmail } from "@/lib/email";
import { buildMembershipPaymentOutcomeEmail, resolveMembershipReminderRecipient } from "@/lib/membership-reminders";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const SEND_TIMEOUT_MS = 15 * 1000;
const MISSING_RECIPIENT_RETRY_MS = 24 * 60 * 60 * 1000;

type InvoiceState = { id: string; status: string | null; created: number; billingReason: string | null; subscriptionId: string | null };
type SubscriptionState = { id: string; status: string; latestInvoiceId: string | null };
type Db = PrismaClient | Prisma.TransactionClient;
type Dependencies = {
  db?: PrismaClient;
  now?: Date;
  readInvoice?: (id: string) => Promise<InvoiceState>;
  readSubscription?: (id: string) => Promise<SubscriptionState>;
  sendEmail?: typeof sendTransactionalEmail;
  sendTimeoutMs?: number;
};

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "membership_failed_payment_delivery_error").slice(0, 500);
}

async function readInvoice(id: string): Promise<InvoiceState> {
  const invoice = await getStripe().invoices.retrieve(id);
  const raw = invoice.parent?.subscription_details?.subscription;
  return { id: invoice.id, status: invoice.status, created: invoice.created,
    billingReason: invoice.billing_reason,
    subscriptionId: typeof raw === "string" ? raw : raw?.id ?? null };
}

async function readSubscription(id: string): Promise<SubscriptionState> {
  const subscription = await getStripe().subscriptions.retrieve(id);
  const latest = subscription.latest_invoice;
  return { id: subscription.id, status: subscription.status,
    latestInvoiceId: typeof latest === "string" ? latest : latest?.id ?? null };
}

// Stripe is read-only here. An old open invoice is no longer actionable once a
// later invoice becomes latest or the subscription has recovered.
async function currentFailure(invoiceId: string, subscriptionId: string, dependencies: Dependencies) {
  const [invoice, subscription] = await Promise.all([
    (dependencies.readInvoice ?? readInvoice)(invoiceId),
    (dependencies.readSubscription ?? readSubscription)(subscriptionId),
  ]);
  return invoice.id === invoiceId && invoice.subscriptionId === subscriptionId &&
    invoice.billingReason !== "subscription_create" && invoice.status === "open" &&
    subscription.id === subscriptionId &&
    (subscription.status === "past_due" || subscription.status === "unpaid") &&
    subscription.latestInvoiceId === invoiceId
    ? { ...invoice, subscriptionStatus: subscription.status } : null;
}

// A finalized local payment for this exact invoice, or a later paid term for
// this business, conclusively supersedes an older failure notification.
async function localRecovery(db: Db, businessId: string, invoice: InvoiceState) {
  const exact = await db.payment.findUnique({ where: { stripeInvoiceId: invoice.id },
    select: { status: true } });
  if (exact?.status === "PAID") return "invoice_paid";
  const newer = await db.payment.findFirst({ where: {
    businessId, status: "PAID",
    paidAt: { gte: new Date(invoice.created * 1000) },
  }, select: { id: true } });
  return newer ? "membership_payment_succeeded" : null;
}

async function cancelPending(db: Db, invoiceId: string, reason: string) {
  await db.membershipFailedPaymentDelivery.updateMany({
    where: { stripeInvoiceId: invoiceId, acceptedAt: null, canceledAt: null },
    data: { canceledAt: new Date(), cancelReason: reason },
  });
}

/** Record state and the invoice-specific obligation in one local transaction. */
export async function recordMembershipInvoiceFailure(
  invoiceId: string, subscriptionId: string, dependencies: Dependencies = {},
) {
  const db = dependencies.db ?? prisma;
  const invoice = await currentFailure(invoiceId, subscriptionId, dependencies);
  if (!invoice) {
    await cancelPending(db, invoiceId, "stripe_invoice_or_subscription_recovered");
    return "stale" as const;
  }
  return db.$transaction(async (tx) => {
    const memberships = await tx.businessMembership.findMany({
      where: { stripeSubscriptionId: subscriptionId },
      include: { business: { select: { name: true } } },
      take: 2,
    });
    if (memberships.length > 1) throw new Error("failed_invoice_subscription_ambiguous");
    const membership = memberships[0];
    if (!membership) return "missing" as const;
    const recovered = await localRecovery(tx, membership.businessId, invoice);
    if (recovered) {
      await cancelPending(tx, invoiceId, recovered);
      return "stale" as const;
    }
    // The subscription and invoice were checked above; paid local state is
    // checked again within the same transaction as this update.
    await tx.businessMembership.update({
      where: { id: membership.id }, data: { stripeSubscriptionStatus: invoice.subscriptionStatus },
    });
    const delivery = await tx.membershipFailedPaymentDelivery.upsert({
      where: { stripeInvoiceId: invoiceId },
      create: { membershipId: membership.id, stripeInvoiceId: invoiceId,
        stripeSubscriptionId: subscriptionId, businessName: membership.business.name,
        graceEndsAt: membership.graceEndsAt },
      update: {},
    });
    if (delivery.membershipId !== membership.id || delivery.stripeSubscriptionId !== subscriptionId) {
      throw new Error("failed_invoice_membership_conflict");
    }
    return "recorded" as const;
  });
}

function retryDelay(count: number, missingRecipient: boolean) {
  if (missingRecipient) return MISSING_RECIPIENT_RETRY_MS;
  return Math.min(CLAIM_LEASE_MS * 2 ** Math.min(count - 1, 5), 8 * 60 * 60 * 1000);
}

async function sendWithTimeout(sendEmail: typeof sendTransactionalEmail,
  message: Parameters<typeof sendTransactionalEmail>[0], timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("membership_failed_payment_send_timeout")); }, timeoutMs);
  });
  try { return await Promise.race([sendEmail({ ...message, signal: controller.signal }), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function attemptDelivery(id: string, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const claim = await db.membershipFailedPaymentDelivery.updateMany({
    where: { id, acceptedAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
    data: { attemptedAt: now, attemptCount: { increment: 1 },
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  if (!claim.count) return "skipped" as const;
  const delivery = await db.membershipFailedPaymentDelivery.findUniqueOrThrow({
    where: { id }, include: { membership: { include: { business: { select: {
      id: true, name: true, ownerAccesses: { orderBy: { updatedAt: "desc" }, select: {
        activatedAt: true, email: true, updatedAt: true, userId: true,
        user: { select: { legalAcceptances: { orderBy: { acceptedAt: "desc" },
          select: { locale: true }, take: 1 } } },
      } }, submissions: { orderBy: { createdAt: "desc" },
        select: { ownerEmail: true, ownerHasNoEmail: true } },
    } } } } },
  });
  try {
    const invoice = await currentFailure(delivery.stripeInvoiceId, delivery.stripeSubscriptionId, dependencies);
    const recovered = invoice
      ? await localRecovery(db, delivery.membership.businessId, invoice) : "stripe_invoice_or_subscription_recovered";
    if (recovered || delivery.membership.stripeSubscriptionId !== delivery.stripeSubscriptionId) {
      await cancelPending(db, delivery.stripeInvoiceId, recovered || "subscription_replaced");
      return "canceled" as const;
    }
    const recipient = delivery.recipientEmail && delivery.locale
      ? { email: delivery.recipientEmail, locale: delivery.locale === "en" ? "en" as const : "it" as const }
      : resolveMembershipReminderRecipient(delivery.membership.business);
    if (!recipient) throw new Error("membership_failed_payment_recipient_missing");
    if (!delivery.recipientEmail || !delivery.locale) {
      await db.membershipFailedPaymentDelivery.update({ where: { id },
        data: { recipientEmail: recipient.email, locale: recipient.locale } });
    }
    // A paid webhook may have canceled this obligation while Stripe was read.
    const stillPending = await db.membershipFailedPaymentDelivery.findUniqueOrThrow({
      where: { id }, select: { canceledAt: true },
    });
    if (stillPending.canceledAt) return "canceled" as const;
    const message = buildMembershipPaymentOutcomeEmail({
      businessName: delivery.businessName, date: delivery.graceEndsAt, failed: true,
      locale: recipient.locale, manageUrl: `${getAppUrl().replace(/\/+$/, "")}/dashboard`,
    });
    const result = await sendWithTimeout(dependencies.sendEmail ?? sendTransactionalEmail, {
      html: message.html, idempotencyKey: `membership-failed-invoice:${delivery.stripeInvoiceId}`,
      subject: message.subject, text: message.text, to: recipient.email,
    }, dependencies.sendTimeoutMs ?? SEND_TIMEOUT_MS);
    await db.membershipFailedPaymentDelivery.update({
      where: { id }, data: { acceptedAt: new Date(),
        failureMessage: null, provider: result.provider, providerMessageId: result.messageId },
    });
    return "accepted" as const;
  } catch (error) {
    const message = safeError(error);
    try {
      await db.membershipFailedPaymentDelivery.updateMany({
        where: { id, acceptedAt: null, canceledAt: null },
        data: { failureMessage: message,
          nextAttemptAt: new Date(now.getTime() + retryDelay(delivery.attemptCount,
            message === "membership_failed_payment_recipient_missing")) },
      });
    } catch (recordError) {
      console.error("[membership-failed-payment] could not record delivery failure",
        { id, error: safeError(recordError) });
    }
    console.error("[membership-failed-payment] delivery pending", { id, error: message });
    return "pending" as const;
  }
}

/** Best effort after the state and obligation have committed. */
export async function attemptMembershipFailedPaymentDelivery(invoiceId: string, dependencies: Dependencies = {}) {
  try {
    const db = dependencies.db ?? prisma;
    const delivery = await db.membershipFailedPaymentDelivery.findUnique({
      where: { stripeInvoiceId: invoiceId }, select: { id: true },
    });
    return delivery ? await attemptDelivery(delivery.id, dependencies) : "missing" as const;
  } catch (error) {
    console.error("[membership-failed-payment] immediate attempt unavailable",
      { invoiceId, error: safeError(error) });
    return "pending" as const;
  }
}

export async function retryPendingMembershipFailedPayments(dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const due = await db.membershipFailedPaymentDelivery.findMany({
    where: { acceptedAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" }, select: { id: true }, take: 50,
  });
  let accepted = 0;
  for (const delivery of due) {
    try { if (await attemptDelivery(delivery.id, dependencies) === "accepted") accepted++; }
    catch (error) {
      console.error("[membership-failed-payment] retry unavailable",
        { id: delivery.id, error: safeError(error) });
    }
  }
  return { accepted, due: due.length };
}
