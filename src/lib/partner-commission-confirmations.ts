import type { PrismaClient } from "@prisma/client";

import { sendTransactionalEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
const SEND_TIMEOUT_MS = 15 * 1000;
const MISSING_RECIPIENT_RETRY_MS = 24 * 60 * 60 * 1000;
// Resend's idempotency key expires after 24 hours. An uncertain send must
// stop before then rather than risk a second message with the same key.
const UNCERTAIN_SEND_WINDOW_MS = 23 * 60 * 60 * 1000;

type Dependencies = {
  db?: PrismaClient;
  now?: Date;
  sendEmail?: typeof sendTransactionalEmail;
  sendTimeoutMs?: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildPartnerCommissionConfirmationEmail(params: {
  amountCents: number;
  businessName: string;
  earningsUrl: string;
  locale: Locale;
  testMode: boolean;
}) {
  const amount = new Intl.NumberFormat(params.locale === "it" ? "it-IT" : "en-IE", {
    style: "currency", currency: "EUR",
  }).format(params.amountCents / 100);
  const name = params.businessName;
  const intro = params.locale === "it"
    ? `L'attività ${name} che hai segnalato è stata pubblicata e il suo pagamento iniziale è stato confermato.`
    : `The business you referred, ${name}, is published and its initial payment has been confirmed.`;
  const commission = params.locale === "it"
    ? `La tua commissione di ${amount} è stata registrata. Rimane soggetta al periodo di 14 giorni per eventuali rimborsi e alle condizioni di pagamento.`
    : `Your ${amount} commission has been recorded. It remains subject to the 14-day refund period and payout eligibility requirements.`;
  const simulation = params.testMode
    ? params.locale === "it"
      ? "Questo pagamento è stato simulato in modalità test Stripe. La commissione è solo un dato di prova e non può essere prelevata o pagata come denaro reale."
      : "This payment was simulated in Stripe test mode. This commission is test activity and cannot be withdrawn or paid out as real money."
    : "";
  const linkText = params.locale === "it" ? "Visualizza le tue commissioni" : "View your commissions";
  const subject = params.locale === "it"
    ? `Commissione Salento Local registrata: ${amount}`
    : `Salento Local commission recorded: ${amount}`;
  return {
    subject,
    text: [intro, commission, simulation, `${linkText}: ${params.earningsUrl}`].filter(Boolean).join("\n\n"),
    html: [
      `<p>${escapeHtml(intro)}</p>`,
      `<p>${escapeHtml(commission)}</p>`,
      simulation ? `<p>${escapeHtml(simulation)}</p>` : "",
      `<p><a href="${escapeHtml(params.earningsUrl)}">${escapeHtml(linkText)}</a></p>`,
    ].join(""),
  };
}

function deliveryEligibility(commission: {
  amountCents: number;
  businessId: string | null;
  businessSubmissionId: string | null;
  currency: string;
  partnerUser: { role: string };
  paymentId: string | null;
  payment: { businessId: string | null; businessSubmissionId: string; currency: string; paidAt: Date | null;
    purpose: string; refundRequestedAt: Date | null; refundStatus: string | null;
    status: string; stripeLivemode: boolean | null } | null;
  businessSubmission: { createdBusinessId: string | null; paymentStatus: string; status: string } | null;
  status: string;
  type: string;
}) {
  if (commission.status === "REVERSED" || commission.status === "DEBT" || commission.payment?.status === "REFUNDED") return "cancel" as const;
  if (!commission.payment || !commission.businessSubmission || !commission.businessId || !commission.paymentId ||
    !commission.businessSubmissionId || commission.partnerUser.role !== "GETTER" ||
    commission.type !== "COMMISSION" || commission.amountCents <= 0 ||
    commission.currency.toLowerCase() !== "eur" || commission.payment.currency.toLowerCase() !== "eur" ||
    commission.payment.businessSubmissionId !== commission.businessSubmissionId ||
    commission.payment.businessId !== commission.businessId ||
    commission.businessSubmission.createdBusinessId !== commission.businessId ||
    commission.businessSubmission.status !== "PUBLISHED" || commission.businessSubmission.paymentStatus !== "PAID" ||
    commission.payment.purpose !== "INITIAL_MEMBERSHIP" || commission.payment.status !== "PAID" ||
    !commission.payment.paidAt || commission.payment.stripeLivemode === null ||
    (commission.payment.refundRequestedAt && commission.payment.refundStatus !== "support_closed")) return "defer" as const;
  return "ready" as const;
}

const commissionInclude = {
  business: { select: { name: true } },
  businessSubmission: { select: { businessName: true, createdBusinessId: true, paymentStatus: true, status: true } },
  partnerUser: { select: { email: true, role: true, localPartnerProfile: { select: { preferredLanguage: true } } } },
  payment: { select: { businessId: true, businessSubmissionId: true, currency: true, paidAt: true, purpose: true,
    refundRequestedAt: true, refundStatus: true, status: true, stripeLivemode: true } },
} as const;

/** Create one durable notification only after the initial payment and listing are final. */
export async function ensurePartnerCommissionConfirmationDeliveryForSubmission(
  submissionId: string,
  dependencies: Dependencies = {},
) {
  const db = dependencies.db ?? prisma;
  const commission = await db.partnerCommission.findUnique({
    where: { sourceKey: `commission:submission:${submissionId}` }, include: commissionInclude,
  });
  if (!commission || deliveryEligibility(commission) !== "ready") return null;
  const delivery = await db.partnerCommissionConfirmationDelivery.upsert({
    where: { commissionId: commission.id },
    create: {
      commissionId: commission.id,
      businessName: commission.business?.name || commission.businessSubmission?.businessName || "Salento Local",
    },
    update: {},
    select: { id: true },
  });
  return delivery.id;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "partner_commission_email_failed").slice(0, 500);
}

function retryDelay(attemptCount: number) {
  return Math.min(CLAIM_LEASE_MS * 2 ** Math.min(attemptCount - 1, 5), 8 * 60 * 60 * 1000);
}

async function sendWithTimeout(
  sendEmail: typeof sendTransactionalEmail,
  message: Parameters<typeof sendTransactionalEmail>[0],
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("partner_commission_email_timeout")); }, timeoutMs);
  });
  try {
    return await Promise.race([sendEmail({ ...message, signal: controller.signal }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function attemptDelivery(id: string, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const claim = await db.partnerCommissionConfirmationDelivery.updateMany({
    where: { id, acceptedAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
    data: { attemptedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) },
  });
  if (!claim.count) return "skipped" as const;
  const delivery = await db.partnerCommissionConfirmationDelivery.findUniqueOrThrow({
    where: { id }, include: { commission: { include: commissionInclude } },
  });
  const eligibility = deliveryEligibility(delivery.commission);
  if (eligibility === "cancel") {
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: { canceledAt: now, nextAttemptAt: null } });
    return "canceled" as const;
  }
  if (eligibility === "defer") {
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: {
      failureMessage: "partner_commission_no_longer_ready",
      nextAttemptAt: new Date(now.getTime() + MISSING_RECIPIENT_RETRY_MS),
    } });
    return "pending" as const;
  }
  const recipient = delivery.recipientEmail || delivery.commission.partnerUser.email?.trim();
  if (!recipient) {
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: {
      failureMessage: "partner_commission_recipient_missing",
      nextAttemptAt: new Date(now.getTime() + MISSING_RECIPIENT_RETRY_MS),
    } });
    return "pending" as const;
  }
  const locale: Locale = delivery.locale === "en" || delivery.locale === "it"
    ? delivery.locale : delivery.commission.partnerUser.localPartnerProfile?.preferredLanguage === "en" ? "en" : "it";
  if (!delivery.recipientEmail || !delivery.locale) {
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: { recipientEmail: recipient, locale } });
  }
  const firstAttemptedAt = delivery.firstAttemptedAt ?? now;
  if (now.getTime() - firstAttemptedAt.getTime() >= UNCERTAIN_SEND_WINDOW_MS) {
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: {
      failureMessage: "partner_commission_delivery_requires_review", nextAttemptAt: null,
    } });
    return "review" as const;
  }
  const message = buildPartnerCommissionConfirmationEmail({
    amountCents: delivery.commission.amountCents,
    businessName: delivery.businessName,
    earningsUrl: `${getAppUrl()}/dashboard/earnings`,
    locale,
    testMode: delivery.commission.payment!.stripeLivemode === false,
  });
  try {
    if (!delivery.firstAttemptedAt) {
      await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: { firstAttemptedAt: now } });
    }
    const result = await sendWithTimeout(dependencies.sendEmail ?? sendTransactionalEmail, {
      ...message,
      headers: { "X-Transactional-Message": "partner-commission-confirmation" },
      idempotencyKey: `partner-commission-confirmation:${delivery.id}`,
      to: recipient,
    }, dependencies.sendTimeoutMs ?? SEND_TIMEOUT_MS);
    await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: {
      acceptedAt: new Date(), failureMessage: null, nextAttemptAt: null,
      provider: result.provider, providerMessageId: result.messageId,
    } });
    return "accepted" as const;
  } catch (error) {
    const message = safeError(error);
    const nextAttemptAt = new Date(Math.min(
      now.getTime() + retryDelay(delivery.attemptCount),
      firstAttemptedAt.getTime() + UNCERTAIN_SEND_WINDOW_MS,
    ));
    try {
      await db.partnerCommissionConfirmationDelivery.update({ where: { id }, data: {
        failureMessage: message, nextAttemptAt,
      } });
    } catch (recordError) {
      console.error("[partner-commission-confirmation] failure recording unavailable", { id, error: safeError(recordError) });
    }
    console.error("[partner-commission-confirmation] delivery pending", { id, error: message });
    return "pending" as const;
  }
}

/** Best effort after payment, publication, and ledger writes have committed. */
export async function attemptPartnerCommissionConfirmationForSubmission(submissionId: string, dependencies: Dependencies = {}) {
  try {
    const db = dependencies.db ?? prisma;
    const delivery = await db.partnerCommissionConfirmationDelivery.findFirst({
      where: { commission: { businessSubmissionId: submissionId, sourceKey: `commission:submission:${submissionId}` } },
      select: { id: true },
    });
    return delivery ? await attemptDelivery(delivery.id, dependencies) : "missing" as const;
  } catch (error) {
    console.error("[partner-commission-confirmation] immediate attempt unavailable", { submissionId, error: safeError(error) });
    return "pending" as const;
  }
}

/** Run from the existing authenticated payment-outcome retry job. */
export async function retryPendingPartnerCommissionConfirmations(dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = dependencies.now ?? new Date();
  const due = await db.partnerCommissionConfirmationDelivery.findMany({
    where: { acceptedAt: null, canceledAt: null, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" }, select: { id: true }, take: 50,
  });
  let accepted = 0;
  for (const item of due) {
    try {
      if (await attemptDelivery(item.id, dependencies) === "accepted") accepted++;
    } catch (error) {
      console.error("[partner-commission-confirmation] retry unavailable", { id: item.id, error: safeError(error) });
    }
  }
  return { accepted, due: due.length };
}
