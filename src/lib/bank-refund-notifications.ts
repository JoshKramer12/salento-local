import { prisma } from "@/lib/prisma";
import { sendTransactionalEmail } from "@/lib/email";
import { getSupportContactEmail } from "@/lib/support-contact";
import { getAppUrl } from "@/lib/payment";
import { addUtcDays } from "@/lib/business-membership";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Independent claims preserve request/final email separation. An ambiguous
 * send remains claimed for operator review; financial state never rolls back. */
export async function sendBankRefundRequestNotifications(paymentId: string, dependencies: { send?: typeof sendTransactionalEmail; supportEmail?: string | null } = {}) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: {
    business: { include: { membership: { include: { originatingPartnerUser: { include: { localPartnerProfile: true } } } } } },
    businessSubmission: true,
    partnerCommissions: { where: { type: "COMMISSION" } },
  } });
  if (!payment?.business || payment.method !== "BANK_TRANSFER" || !payment.refundRequestedAt || !payment.refundRequestedByUserId || !payment.paidAt) return;
  const owner = await prisma.user.findUnique({ where: { id: payment.refundRequestedByUserId }, select: { name: true, email: true } });
  const partner = payment.business.membership?.originatingPartnerUser;
  const ownerEmail = payment.refundInstructionsEmail;
  const supportEmail = dependencies.supportEmail === undefined ? getSupportContactEmail() : dependencies.supportEmail;
  const reference = `bank-refund:${payment.id}`;
  const amount = (locale: "it" | "en") => new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", { style: "currency", currency: payment.currency.toUpperCase() }).format(payment.amountCents / 100);
  const date = (value: Date, locale: "it" | "en") => new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(value);
  const locale = payment.refundRequestLocale === "en" ? "en" : "it";
  const ownerItalian = locale === "it";
  const partnerItalian = partner?.localPartnerProfile?.preferredLanguage !== "en";
  const supportText = [
    `Bank-transfer refund request — ${payment.business.name}`,
    `Request reference: ${reference}`, `Business: ${payment.business.name}`, `Business ID: ${payment.businessId}`,
    `Submission ID: ${payment.businessSubmissionId}`, `Owner: ${owner?.name || payment.businessSubmission.ownerName}`,
    `Owner ID: ${payment.refundRequestedByUserId}`, `Owner contact email: ${ownerEmail || "missing"}`,
    `Payment ID: ${payment.id}`, `Payment date: ${payment.paidAt.toISOString()}`,
    `Amount: ${amount("en")} (${payment.amountCents} cents; ${payment.currency})`, "Payment rail: bank transfer",
    `Requested at: ${payment.refundRequestedAt.toISOString()}`, `Eligibility deadline (excluded): ${addUtcDays(payment.paidAt, 14).toISOString()}`,
    `Partner ID: ${payment.business.membership?.originatingPartnerUserId || "none"}`,
    ...payment.partnerCommissions.map((commission) => `Commission: ${commission.id}; ${commission.amountCents} cents; ${commission.status}; Partner ${commission.partnerUserId}`),
    `Stripe PaymentIntent: ${payment.stripePaymentIntentId || "none"}`, `Stripe customer: ${payment.stripeCustomerId || "none"}`,
    `Admin: ${getAppUrl().replace(/\/+$/, "")}/dashboard/admin/memberships/${encodeURIComponent(payment.businessId!)}`,
    "Timely request recorded. Money has NOT been returned. Keep the payment/listing active and commission held until verified full refund success.",
    "Complete the return through Stripe where possible, then verify its exact Refund ID on the Admin membership page. Do not enter bank details or secrets in email."
  ].join("\n");
  const jobs = [
    { kind: "support" as const, recipient: supportEmail, subject: `Bank-transfer refund request — ${payment.business.name}`, text: supportText },
    { kind: "owner" as const, recipient: ownerEmail, subject: ownerItalian ? "Abbiamo ricevuto la tua richiesta di rimborso" : "We received your refund request", text: ownerItalian
      ? `La tua richiesta di rimborso completo di ${amount(locale)} per ${payment.business.name} è stata ricevuta il ${date(payment.refundRequestedAt, locale)}, entro il periodo di 14 giorni. Riferimento: ${reference}. Poiché hai pagato con bonifico, Salento Local ti aiuterà a completare la restituzione. L'idoneità al rimborso resta valida in base alla data della richiesta, anche se l'elaborazione termina dopo 14 giorni. La scheda resta attiva fino al completamento del rimborso. Ti contatteremo a ${ownerEmail} se servono ulteriori informazioni. Il rimborso non è ancora stato completato.`
      : `Your full ${amount(locale)} refund request for ${payment.business.name} was received on ${date(payment.refundRequestedAt, locale)}, within the 14-day period. Reference: ${reference}. Because you paid by bank transfer, Salento Local will help complete the return with you. Your refund eligibility is preserved by your request date, even if processing finishes after 14 days. Your listing remains active until the refund is completed. We'll contact you at ${ownerEmail} if more information is needed. The refund has not been completed yet.` },
    { kind: "partner" as const, recipient: partner?.email, subject: partnerItalian ? `Commissione in sospeso — ${payment.business.name}` : `Commission on hold — ${payment.business.name}`, text: partnerItalian
      ? `Il titolare di ${payment.business.name} ha richiesto un rimborso entro il periodo di 14 giorni. Il pagamento è stato effettuato con bonifico e richiede l'assistenza di Salento Local. La commissione iniziale di €50 è temporaneamente in sospeso mentre la richiesta viene risolta, anche dopo il giorno 14. Se il rimborso viene completato, la commissione sarà annullata. Se la richiesta viene chiusa senza restituzione del pagamento e la membership resta valida, la commissione potrà tornare al normale percorso di idoneità. L'attività resta nella tua dashboard.`
      : `The Owner of ${payment.business.name} requested a refund within the 14-day period. The membership was paid by bank transfer and needs Salento Local support. Your initial €50 commission is temporarily on hold while the request is resolved, including after Day 14. If the refund completes, the commission will be canceled. If the request is closed without returning the payment and the membership remains valid, the commission can return to the normal eligibility flow. The business remains in your dashboard.` },
  ];
  for (const job of jobs) {
    const claimedField = `${job.kind}RefundRequestEmailClaimedAt` as const;
    const sentField = `${job.kind}RefundRequestEmailSentAt` as const;
    const errorField = `${job.kind}RefundRequestEmailError` as const;
    if (!job.recipient) {
      if (job.kind !== "partner" || partner) await prisma.payment.update({ where: { id: paymentId }, data: { [errorField]: `${job.kind}_email_missing` } });
      continue;
    }
    const claim = await prisma.payment.updateMany({ where: { id: paymentId, [claimedField]: null, [sentField]: null }, data: { [claimedField]: new Date() } });
    if (!claim.count) continue;
    try {
      await (dependencies.send ?? sendTransactionalEmail)({ to: job.recipient, subject: job.subject, text: job.text,
        html: `<div style="padding:24px;background:#f4ede3;color:#243b34;font-family:Arial,sans-serif"><div style="max-width:600px;margin:auto;background:#fffdf9;border-radius:18px;padding:28px"><h1 style="font-family:Georgia,serif">Salento Local</h1><h2>${escapeHtml(job.subject)}</h2><p style="line-height:1.7;white-space:pre-line">${escapeHtml(job.text)}</p></div></div>`,
        idempotencyKey: `bank-refund-request-${paymentId}-${job.kind}`, headers: { "X-Transactional-Message": `bank-refund-request-${job.kind}` },
      });
      await prisma.payment.update({ where: { id: paymentId }, data: { [sentField]: new Date(), [errorField]: null } });
    } catch (error) {
      await prisma.payment.update({ where: { id: paymentId }, data: { [errorField]: (error instanceof Error ? error.message : "refund_request_email_failed").slice(0, 500) } });
    }
  }
}
