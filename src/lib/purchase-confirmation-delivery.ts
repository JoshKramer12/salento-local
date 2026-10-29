import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { sendPurchaseConfirmationForSubmission } from "@/lib/receipts";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const UNCERTAIN_SEND_WINDOW_MS = 23 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;

type Dependencies = {
  db?: PrismaClient;
  now?: Date;
  sendConfirmation?: typeof sendPurchaseConfirmationForSubmission;
};

/** A new paid initial purchase gets one durable notification obligation. */
export async function ensurePurchaseConfirmationDeliveryForSubmission(
  submissionId: string,
  dependencies: Dependencies = {},
) {
  const db = dependencies.db ?? prisma;
  const submission = await db.businessSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, ownerEmail: true, createdBusinessId: true, paymentStatus: true,
      purchaseConfirmationSentAt: true, status: true },
  });
  if (!submission || !submission.ownerEmail.trim() || submission.purchaseConfirmationSentAt ||
    submission.status !== "PUBLISHED" || submission.paymentStatus !== "PAID" || !submission.createdBusinessId) return null;
  const paidInitial = await db.payment.findMany({
    where: { businessSubmissionId: submissionId, businessId: submission.createdBusinessId,
      purpose: "INITIAL_MEMBERSHIP", status: "PAID", refundRequestedAt: null },
    select: { id: true }, take: 2,
  });
  if (paidInitial.length > 1) throw new Error("purchase_confirmation_ambiguous_initial_payment");
  if (!paidInitial.length) {
    const refunded = await db.payment.findFirst({
      where: { businessSubmissionId: submissionId, businessId: submission.createdBusinessId,
        purpose: "INITIAL_MEMBERSHIP", OR: [{ status: "REFUNDED" }, { refundRequestedAt: { not: null } }] },
      select: { id: true },
    });
    if (refunded) return null;
    throw new Error("purchase_confirmation_paid_payment_missing");
  }
  const delivery = await db.purchaseConfirmationDelivery.upsert({
    where: { businessSubmissionId: submissionId },
    create: { businessSubmissionId: submissionId }, update: {}, select: { id: true },
  });
  return delivery.id;
}

async function attemptDelivery(id: string, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const claimed = await db.purchaseConfirmationDelivery.updateMany({
    where: { id, acceptedAt: null, nextAttemptAt: { lte: now }, attemptCount: { lt: MAX_ATTEMPTS } },
    data: { attemptedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  if (!claimed.count) return "skipped" as const;
  const delivery = await db.purchaseConfirmationDelivery.findUniqueOrThrow({
    where: { id }, include: { businessSubmission: { select: { purchaseConfirmationSentAt: true } } },
  });
  if (delivery.businessSubmission.purchaseConfirmationSentAt) {
    await db.purchaseConfirmationDelivery.update({ where: { id }, data: {
      acceptedAt: delivery.businessSubmission.purchaseConfirmationSentAt, failureMessage: null, nextAttemptAt: null,
    } });
    return "accepted" as const;
  }
  // A refund or a withdrawn listing must not receive a stale purchase email.
  if (!await ensurePurchaseConfirmationDeliveryForSubmission(delivery.businessSubmissionId, { db })) {
    await db.purchaseConfirmationDelivery.update({ where: { id }, data: {
      failureMessage: "purchase_confirmation_no_longer_eligible", nextAttemptAt: null,
    } });
    return "review" as const;
  }
  const firstAttemptedAt = delivery.firstAttemptedAt ?? now;
  if (now.getTime() - firstAttemptedAt.getTime() >= UNCERTAIN_SEND_WINDOW_MS) {
    await db.purchaseConfirmationDelivery.update({ where: { id }, data: {
      failureMessage: "purchase_confirmation_requires_review", nextAttemptAt: null,
    } });
    return "review" as const;
  }
  try {
    if (!delivery.firstAttemptedAt) {
      await db.purchaseConfirmationDelivery.update({ where: { id }, data: { firstAttemptedAt: now } });
    }
    const sent = await (dependencies.sendConfirmation ?? sendPurchaseConfirmationForSubmission)({
      locale: "it", submissionId: delivery.businessSubmissionId,
    });
    if (!sent) throw new Error("purchase_confirmation_not_sent");
    const confirmed = await db.businessSubmission.findUnique({
      where: { id: delivery.businessSubmissionId }, select: { purchaseConfirmationSentAt: true },
    });
    if (!confirmed?.purchaseConfirmationSentAt) throw new Error("purchase_confirmation_acceptance_missing");
    await db.purchaseConfirmationDelivery.update({ where: { id }, data: {
      acceptedAt: confirmed.purchaseConfirmationSentAt, failureMessage: null, nextAttemptAt: null,
    } });
    return "accepted" as const;
  } catch (error) {
    // Provider errors may contain recipient details. Persist only a stable code.
    const failureMessage = error instanceof Error && /^[a-z][a-z0-9_]{2,100}$/.test(error.message)
      ? error.message : "purchase_confirmation_delivery_failed";
    const retryAt = delivery.attemptCount >= MAX_ATTEMPTS ? null : new Date(Math.min(
      now.getTime() + Math.min(CLAIM_LEASE_MS * 2 ** (delivery.attemptCount - 1), 8 * 60 * 60 * 1000),
      firstAttemptedAt.getTime() + UNCERTAIN_SEND_WINDOW_MS,
    ));
    await db.purchaseConfirmationDelivery.update({ where: { id }, data: { failureMessage, nextAttemptAt: retryAt } });
    return "pending" as const;
  }
}

export async function attemptPurchaseConfirmationDeliveryForSubmission(
  submissionId: string,
  dependencies: Dependencies = {},
) {
  const db = dependencies.db ?? prisma;
  const delivery = await db.purchaseConfirmationDelivery.findUnique({
    where: { businessSubmissionId: submissionId }, select: { id: true },
  });
  return delivery ? attemptDelivery(delivery.id, dependencies) : "missing" as const;
}

/** The existing authenticated outcome job runs this bounded retry scan. */
export async function retryPendingPurchaseConfirmations(dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const due = await db.purchaseConfirmationDelivery.findMany({
    where: { acceptedAt: null, nextAttemptAt: { lte: now }, attemptCount: { lt: MAX_ATTEMPTS } },
    orderBy: { nextAttemptAt: "asc" }, select: { id: true }, take: 50,
  });
  let accepted = 0;
  for (const item of due) {
    try {
      if (await attemptDelivery(item.id, dependencies) === "accepted") accepted++;
    } catch {
      // The row stays due for the next scheduled call if storage is unavailable.
      console.error("[purchase-confirmation] retry unavailable", { deliveryId: item.id });
    }
  }
  return { accepted, due: due.length };
}
