import { sendTransactionalEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Claim before sending. Resend also receives a stable idempotency key. SMTP
 * ambiguity stays claimed for operator review instead of risking duplicates. */
export async function sendInitialRefundNotifications(paymentId: string, dependencies: { send?: typeof sendTransactionalEmail } = {}) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      business: {
        include: {
          membership: { include: { originatingPartnerUser: { include: { localPartnerProfile: true } } } },
          ownerUser: { select: { email: true } },
          ownerAccesses: { where: { activatedAt: { not: null }, userId: { not: null }, email: { not: null } }, orderBy: { activatedAt: "desc" }, take: 1 },
        },
      },
      businessSubmission: { select: { ownerEmail: true } },
    },
  });
  if (!payment || payment.status !== "REFUNDED" || !payment.selfServiceRefundedAt || !payment.business) return;
  const ownerEmail = payment.business.ownerAccesses[0]?.email || payment.business.ownerUser?.email || payment.businessSubmission.ownerEmail;
  const partner = payment.business.membership?.originatingPartnerUser;
  if (!ownerEmail) await prisma.payment.update({ where: { id: paymentId }, data: { ownerRefundEmailError: "owner_email_missing" } });
  if (payment.business.membership?.originatingPartnerUserId && !partner?.email) await prisma.payment.update({ where: { id: paymentId }, data: { partnerRefundEmailError: "partner_email_missing" } });
  const ownerLocale = await prisma.legalAcceptance.findFirst({
    where: { userId: payment.business.ownerAccesses[0]?.userId ?? payment.business.ownerUserId ?? payment.userId },
    orderBy: { acceptedAt: "desc" }, select: { locale: true },
  });
  const currency = new Intl.NumberFormat(ownerLocale?.locale === "en" ? "en-US" : "it-IT", { style: "currency", currency: payment.currency.toUpperCase() }).format((payment.refundedAmountCents ?? payment.amountCents) / 100);
  const businessName = payment.business.name;
  const paidDate = payment.paidAt ? new Intl.DateTimeFormat(ownerLocale?.locale === "en" ? "en-US" : "it-IT", { dateStyle: "medium" }).format(payment.paidAt) : null;
  const reference = payment.stripePaymentIntentId || payment.id;
  const jobs: Array<{ kind: "owner" | "partner"; recipient: string; locale: "en" | "it" }> = [];
  if (ownerEmail) jobs.push({ kind: "owner", recipient: ownerEmail, locale: ownerLocale?.locale === "en" ? "en" : "it" });
  if (partner?.email) jobs.push({ kind: "partner", recipient: partner.email, locale: partner.localPartnerProfile?.preferredLanguage === "en" ? "en" : "it" });

  for (const job of jobs) {
    const claimedField = job.kind === "owner" ? "ownerRefundEmailClaimedAt" : "partnerRefundEmailClaimedAt";
    const sentField = job.kind === "owner" ? "ownerRefundEmailSentAt" : "partnerRefundEmailSentAt";
    const errorField = job.kind === "owner" ? "ownerRefundEmailError" : "partnerRefundEmailError";
    const claim = await prisma.payment.updateMany({ where: { id: paymentId, [claimedField]: null, [sentField]: null }, data: { [claimedField]: new Date() } });
    if (!claim.count) continue;
    const italian = job.locale === "it";
    const subject = job.kind === "owner"
      ? italian ? "Il tuo rimborso Salento Local è stato elaborato" : "Your Salento Local refund has been processed"
      : italian ? `Rimborso richiesto per ${businessName}` : `Refund requested for ${businessName}`;
    const text = job.kind === "owner"
      ? italian
        ? `Il rimborso di ${currency} per ${businessName} è stato elaborato. Pagamento originale: ${reference}${paidDate ? `, ${paidDate}` : ""}. La scheda non è più pubblica. Le informazioni e l'accesso al tuo account restano disponibili; potrai acquistare una nuova membership per riattivarla. Il rimborso viene restituito con il metodo appropriato al pagamento originale. La banca o il fornitore di pagamento potrebbero richiedere ulteriore tempo per mostrarlo.`
        : `Your ${currency} refund for ${businessName} has been processed. Original payment: ${reference}${paidDate ? `, ${paidDate}` : ""}. The listing is no longer public. Your business information and account access remain available; you can buy a new membership to reactivate it. The refund is returned using the appropriate method for the original payment. Your bank or payment provider may take additional time to show it.`
      : italian
        ? `Il titolare ha richiesto un rimborso entro 14 giorni per ${businessName}. La membership è stata disattivata e la commissione iniziale di €50 è stata annullata. L'attività resta nella dashboard Partner. Se il titolare acquista una nuova membership dopo questo rimborso, può maturare una nuova commissione iniziale di €50.`
        : `The owner requested a refund within 14 days for ${businessName}. The membership has been deactivated and the initial €50 commission canceled. The business remains in your Partner dashboard. If the owner buys a new membership after this refund, a new €50 initial commission may be earned.`;
    try {
      await (dependencies.send ?? sendTransactionalEmail)({
        to: job.recipient,
        subject,
        text,
        html: `<div style="margin:0;padding:32px 16px;background:#f4ede3;color:#243b34;font-family:Arial,Helvetica,sans-serif"><div style="max-width:600px;margin:auto;background:#fffdf9;border:1px solid #e5d9cc;border-radius:18px;padding:32px"><h1 style="font-family:Georgia,serif;font-size:25px">Salento Local</h1><h2 style="font-size:20px">${escapeHtml(subject)}</h2><p style="font-size:16px;line-height:1.7">${escapeHtml(text)}</p></div></div>`,
        idempotencyKey: `initial-refund-${paymentId}-${job.kind}`,
        headers: { "X-Transactional-Message": `initial-refund-${job.kind}` },
      });
      await prisma.payment.update({ where: { id: paymentId }, data: { [sentField]: new Date(), [errorField]: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "refund_email_failed";
      await prisma.payment.update({ where: { id: paymentId }, data: { [errorField]: message.slice(0, 500) } });
      console.error("[refund:notification]", { paymentId, kind: job.kind, error: message });
    }
  }
}
