import { isBusinessMembershipPublic } from "@/lib/business-membership";
import { refundAmount } from "@/lib/refund-display";
import { completedRefundEmail } from "@/lib/refund-email-copy";
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
      partnerCommissions: true,
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
    const initial = payment.partnerCommissions.filter((entry) => entry.type === "COMMISSION" && entry.partnerUserId === partner?.id);
    const cancelled = initial.length > 0 && initial.every((entry) => entry.status === "REVERSED" || entry.status === "DEBT" || payment.partnerCommissions.some((reversal) => reversal.sourceKey === `commission:reversal:${entry.id}` && ["REVERSED", "DEBT"].includes(reversal.status)));
    const message = completedRefundEmail({ kind: job.kind, locale: job.locale, businessName,
      amount: refundAmount(job.locale, payment.refundedAmountCents ?? payment.amountCents, payment.currency),
      commissionAmount: initial.length ? refundAmount(job.locale, initial.reduce((sum, entry) => sum + entry.amountCents, 0), payment.currency) : undefined,
      commissionCancelled: cancelled, listingActive: isBusinessMembershipPublic(payment.business.membership ?? {}),
    });
    const subject = message.subject;
    const text = message.text + (job.kind === "owner" ? ` ${job.locale === "it" ? "Pagamento originale" : "Original payment"}: ${reference}${paidDate ? `, ${paidDate}` : ""}.` : "");
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
