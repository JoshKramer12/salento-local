import { sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getSupportContactEmail } from "@/lib/support-contact";
import { deriveInvitationToken, invitationIsOpen, isPayLaterEnabled, PAY_LATER_REMINDER_DAYS } from "@/lib/pay-later-invitations";
import { isPublicFinancialHold } from "@/lib/stripe";

const DAY_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 15 * 60 * 1000;

export function reminderSequenceDue(acceptedAt: Date, now: Date) {
  const elapsed = now.getTime() - acceptedAt.getTime();
  let due = 0;
  PAY_LATER_REMINDER_DAYS.forEach((days, index) => { if (elapsed >= days * DAY_MS) due = index + 1; });
  return due;
}

export function buildPayLaterReminderEmail(params: {
  businessName: string; locale: "en" | "it"; token: string;
}) {
  const it = params.locale === "it";
  const url = `${getAppUrl()}/pay-later#invite=${encodeURIComponent(params.token)}`;
  const subject = it ? "La tua scheda su Salento Local ti aspetta" : "Your Salento Local listing is waiting";
  const body = it
    ? `Ciao! La scheda di ${params.businessName} è pronta. Puoi controllare le informazioni e completare l’adesione annuale di €100 quando preferisci.`
    : `Hello! The listing for ${params.businessName} is ready. Review the details and complete the €100 annual membership whenever you are ready.`;
  const action = it ? "Controlla e completa l’adesione" : "Review and complete membership";
  const support = getSupportContactEmail();
  const footer = it
    ? `Per rifiutare o interrompere questi promemoria, apri il link e scegli l’opzione dopo aver verificato la tua email. Per assistenza, ${support ? `scrivi a ${support}` : "rispondi a questa email"}.`
    : `To decline or stop reminders, open the link and choose that option after verifying your email. For help, ${support ? `write to ${support}` : "reply to this email"}.`;
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return {
    subject,
    text: `Salento Local\n\n${body}\n\n${action}: ${url}\n\n${footer}`,
    html: `<div style="padding:28px 12px;background:#f7f2ea;color:#243b34;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:620px;background:#fffdf9;border:1px solid #e5ddd1;border-radius:18px"><tr><td style="padding:32px"><p style="color:#2a6257;font-weight:700;letter-spacing:2px">SALENTO LOCAL</p><h1 style="font-family:Georgia,serif">${escape(subject)}</h1><p style="line-height:1.6">${escape(body)}</p><p style="margin:30px 0"><a href="${escape(url)}" style="background:#2a6257;color:#fff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700">${escape(action)}</a></p><p style="font-size:13px;color:#65756d">${escape(footer)}</p></td></tr></table></td></tr></table></div>`,
  };
}

export async function runPayLaterReminderJob(now = new Date(), sendEmail = sendTransactionalEmail) {
  if (!isPayLaterEnabled()) return { due: 0, sent: 0, retriedInvitations: 0 };
  const failedInvitations = await prisma.businessSubmissionInvitation.findMany({
    where: { emailNextAttemptAt: { lte: now }, completedAt: null,
      declinedAt: null, revokedAt: null }, select: { id: true }, take: 25,
  });
  // The invitation retry uses the same token and provider idempotency key.
  const { attemptInvitationEmail } = await import("@/lib/pay-later-invitations");
  for (const row of failedInvitations) await attemptInvitationEmail(row.id, now);

  // Do not urge public owners to pay while production financial completion is paused.
  if (isPublicFinancialHold()) return { due: 0, sent: 0, retriedInvitations: failedInvitations.length };

  const candidates = await prisma.businessSubmissionInvitation.findMany({
    where: { emailAcceptedAt: { not: null }, remindersStoppedAt: null,
      completedAt: null, declinedAt: null, revokedAt: null, reminderCursor: { lt: 6 } },
    include: { businessSubmission: true }, orderBy: { emailAcceptedAt: "asc" }, take: 200,
  });
  let due = 0; let sent = 0;
  for (const invitation of candidates) {
    const submission = invitation.businessSubmission;
    if (!invitationIsOpen(invitation, submission, now) || submission.paymentMethod ||
      submission.paymentStatus !== "NOT_REQUIRED" || !invitation.emailAcceptedAt ||
      invitation.emailAcceptedGeneration !== invitation.tokenGeneration ||
      submission.ownerEmail.trim().toLowerCase() !== invitation.recipientEmail) continue;
    const latestDue = reminderSequenceDue(invitation.emailAcceptedAt, now);
    if (latestDue <= invitation.reminderCursor) continue;
    // After a long outage, skip older milestones and send at most one current reminder.
    const existingRetry = await prisma.businessSubmissionInvitationReminder.findFirst({
      where: { invitationId: invitation.id, acceptedAt: null, attemptedAt: { not: null },
        sequence: { gt: invitation.reminderCursor } }, orderBy: { sequence: "asc" },
    });
    const sequence = existingRetry?.sequence ?? latestDue;
    if (!existingRetry && sequence > invitation.reminderCursor + 1) {
      await prisma.businessSubmissionInvitation.updateMany({
        where: { id: invitation.id, reminderCursor: invitation.reminderCursor },
        data: { reminderCursor: sequence - 1 },
      });
    }
    const reminder = await prisma.businessSubmissionInvitationReminder.upsert({
      where: { invitationId_sequence: { invitationId: invitation.id, sequence } },
      create: { invitationId: invitation.id, sequence, nextAttemptAt: now }, update: {},
    });
    // Provider idempotency expires after 24 hours; stop uncertain retries first.
    if (reminder.firstAttemptedAt &&
      now.getTime() - reminder.firstAttemptedAt.getTime() >= 23 * 60 * 60 * 1000) {
      await prisma.businessSubmissionInvitationReminder.updateMany({
        where: { id: reminder.id, acceptedAt: null, nextAttemptAt: { lte: now },
          firstAttemptedAt: reminder.firstAttemptedAt },
        data: { nextAttemptAt: null, failureMessage: "delivery_uncertain_requires_review" },
      });
      continue;
    }
    const claim = await prisma.businessSubmissionInvitationReminder.updateMany({
      where: { id: reminder.id, acceptedAt: null, nextAttemptAt: { lte: now },
        firstAttemptedAt: reminder.firstAttemptedAt },
      data: { attemptedAt: now, firstAttemptedAt: reminder.firstAttemptedAt ?? now,
        attemptCount: { increment: 1 },
        nextAttemptAt: new Date(now.getTime() + LEASE_MS), failureMessage: null },
    });
    if (!claim.count) continue;
    const latest = await prisma.businessSubmissionInvitation.findUnique({
      where: { id: invitation.id }, include: { businessSubmission: true },
    });
    if (!latest || !invitationIsOpen(latest, latest.businessSubmission, now) ||
      latest.remindersStoppedAt || latest.emailAcceptedGeneration !== latest.tokenGeneration ||
      latest.businessSubmission.paymentMethod || latest.businessSubmission.paymentStatus === "PAID" ||
      latest.businessSubmission.status === "PUBLISHED") continue;
    due++;
    const message = buildPayLaterReminderEmail({ businessName: submission.businessName,
      locale: invitation.locale === "en" ? "en" : "it", token: deriveInvitationToken(latest) });
    try {
      const delivered = await sendEmail({ ...message, to: invitation.recipientEmail,
        idempotencyKey: `pay-later-reminder:${invitation.id}:${sequence}` });
      await prisma.$transaction([
        prisma.businessSubmissionInvitationReminder.update({ where: { id: reminder.id },
          data: { acceptedAt: new Date(), nextAttemptAt: null, provider: delivered.provider,
            providerMessageId: delivered.messageId, failureMessage: null } }),
        prisma.businessSubmissionInvitation.update({ where: { id: invitation.id },
          data: { reminderCursor: sequence } }),
      ]);
      sent++;
    } catch {
      await prisma.businessSubmissionInvitationReminder.update({ where: { id: reminder.id },
        data: { failureMessage: "email_provider_failed",
          nextAttemptAt: new Date(now.getTime() + 60 * 60 * 1000) } });
    }
  }
  return { due, sent, retriedInvitations: failedInvitations.length };
}
