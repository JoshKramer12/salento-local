import type { PrismaClient } from "@prisma/client";

import { sendTransactionalEmail } from "@/lib/email";
import { buildMembershipPaymentOutcomeEmail, resolveMembershipReminderRecipient } from "@/lib/membership-reminders";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const OUTCOME_SEND_TIMEOUT_MS = 15 * 1000;
const MISSING_RECIPIENT_RETRY_MS = 24 * 60 * 60 * 1000;

type Dependencies = {
  db?: PrismaClient;
  now?: Date;
  sendEmail?: typeof sendTransactionalEmail;
  sendTimeoutMs?: number;
};

async function sendOutcomeWithTimeout(
  sendEmail: typeof sendTransactionalEmail,
  message: Parameters<typeof sendTransactionalEmail>[0],
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Abort Resend's fetch and bound our own wait even if a sender ignores abort.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("membership_outcome_send_timeout"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([sendEmail({ ...message, signal: controller.signal }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function retryDelay(attemptCount: number, missingRecipient: boolean) {
  if (missingRecipient) return MISSING_RECIPIENT_RETRY_MS;
  return Math.min(CLAIM_LEASE_MS * 2 ** Math.min(attemptCount - 1, 5), 8 * 60 * 60 * 1000);
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "membership_outcome_email_failed").slice(0, 500);
}

async function attemptDelivery(id: string, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const claimed = await db.membershipPaymentOutcomeDelivery.updateMany({
    where: { id, acceptedAt: null, nextAttemptAt: { lte: now } },
    data: {
      attemptedAt: now,
      attemptCount: { increment: 1 },
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
    },
  });
  if (!claimed.count) return "skipped" as const;

  const delivery = await db.membershipPaymentOutcomeDelivery.findUniqueOrThrow({
    where: { id },
    include: {
      payment: { select: { status: true, refundRequestedAt: true } },
      membership: { include: { business: { select: {
        name: true,
        ownerAccesses: { orderBy: { updatedAt: "desc" }, select: {
          activatedAt: true, email: true, updatedAt: true, userId: true,
          user: { select: { legalAcceptances: { orderBy: { acceptedAt: "desc" }, select: { locale: true }, take: 1 } } },
        } },
        submissions: { orderBy: { createdAt: "desc" }, select: { ownerEmail: true, ownerHasNoEmail: true } },
      } } } },
    },
  });

  try {
    if (delivery.payment.status !== "PAID" || delivery.payment.refundRequestedAt) {
      throw new Error("membership_outcome_payment_no_longer_eligible");
    }
    const recipient = delivery.recipientEmail && delivery.locale
      ? { email: delivery.recipientEmail, locale: delivery.locale === "en" ? "en" as const : "it" as const }
      : resolveMembershipReminderRecipient(delivery.membership.business);
    if (!recipient) throw new Error("membership_outcome_recipient_missing");

    // Freeze the first valid recipient and locale before any provider call so
    // retries cannot redirect an accepted payment outcome to a new owner.
    if (!delivery.recipientEmail || !delivery.locale) {
      await db.membershipPaymentOutcomeDelivery.update({
        where: { id }, data: { recipientEmail: recipient.email, locale: recipient.locale },
      });
    }
    const message = buildMembershipPaymentOutcomeEmail({
      businessName: delivery.businessName,
      date: delivery.periodEnd,
      failed: false,
      locale: recipient.locale,
      manageUrl: `${getAppUrl().replace(/\/+$/, "")}/dashboard`,
    });
    const result = await sendOutcomeWithTimeout(dependencies.sendEmail ?? sendTransactionalEmail, {
      html: message.html,
      idempotencyKey: `membership-payment-outcome:${delivery.id}`,
      subject: message.subject,
      text: message.text,
      to: recipient.email,
    }, dependencies.sendTimeoutMs ?? OUTCOME_SEND_TIMEOUT_MS);
    await db.membershipPaymentOutcomeDelivery.update({
      where: { id },
      data: { acceptedAt: new Date(), failureMessage: null, provider: result.provider, providerMessageId: result.messageId },
    });
    return "accepted" as const;
  } catch (error) {
    const message = safeError(error);
    try {
      await db.membershipPaymentOutcomeDelivery.update({
        where: { id },
        data: {
          failureMessage: message,
          nextAttemptAt: new Date(now.getTime() + retryDelay(delivery.attemptCount, message === "membership_outcome_recipient_missing")),
        },
      });
    } catch (recordError) {
      console.error("[membership-outcome] could not record delivery failure", { id, error: safeError(recordError) });
    }
    console.error("[membership-outcome] delivery pending", { id, error: message });
    return "pending" as const;
  }
}

/** Best effort after the authoritative payment transaction has committed. */
export async function attemptMembershipPaymentOutcomeDelivery(paymentId: string, dependencies: Dependencies = {}) {
  try {
    const db = dependencies.db ?? prisma;
    const delivery = await db.membershipPaymentOutcomeDelivery.findUnique({ where: { paymentId }, select: { id: true } });
    return delivery ? await attemptDelivery(delivery.id, dependencies) : "missing" as const;
  } catch (error) {
    console.error("[membership-outcome] immediate attempt unavailable", { paymentId, error: safeError(error) });
    return "pending" as const;
  }
}

/** Reuses the existing authenticated membership job; only new rows are scanned. */
export async function retryPendingMembershipPaymentOutcomes(dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const due = await db.membershipPaymentOutcomeDelivery.findMany({
    where: { acceptedAt: null, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    select: { id: true },
    take: 50,
  });
  let accepted = 0;
  for (const delivery of due) {
    try {
      if (await attemptDelivery(delivery.id, dependencies) === "accepted") accepted++;
    } catch (error) {
      console.error("[membership-outcome] retry unavailable", { id: delivery.id, error: safeError(error) });
    }
  }
  return { accepted, due: due.length };
}
