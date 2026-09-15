import { MembershipReminderType } from "@prisma/client";

import { sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

function utcDay(value: Date) { return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()); }
function daysUntil(target: Date, now: Date) { return Math.round((utcDay(target) - utcDay(now)) / 86_400_000); }

export function getMembershipReminderType(params: { automaticRenewal: boolean; currentPeriodEnd: Date; graceEndsAt: Date; now: Date }): MembershipReminderType | null {
  const termDays = daysUntil(params.currentPeriodEnd, params.now);
  const graceDays = daysUntil(params.graceEndsAt, params.now);
  if (params.automaticRenewal) return termDays === 30 ? "AUTO_30_DAYS" : termDays === 7 ? "AUTO_7_DAYS" : null;
  if (termDays === 30) return "MANUAL_30_DAYS";
  if (termDays === 14) return "MANUAL_14_DAYS";
  if (termDays === 7) return "MANUAL_7_DAYS";
  if (termDays === 0) return "GRACE_START";
  if (graceDays === 7) return "GRACE_7_DAYS_LEFT";
  if (graceDays === 1) return "EXPIRES_TOMORROW";
  if (graceDays <= 0) return "EXPIRED";
  return null;
}

function copyForReminder(type: MembershipReminderType, name: string, date: Date, manageUrl: string) {
  const dateText = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(date);
  const details: Record<MembershipReminderType, { subject: string; text: string }> = {
    AUTO_30_DAYS: { subject: "Your Salento Local membership renews in 30 days", text: `${name} renews automatically for €100 on ${dateText}. Automatic renewal is on; no action is needed to keep your Business Page active.` },
    AUTO_7_DAYS: { subject: "Your Salento Local membership renews in 7 days", text: `${name} renews automatically for €100 on ${dateText}. No action is needed.` },
    MANUAL_30_DAYS: { subject: "Your Salento Local membership expires in 30 days", text: `${name} expires on ${dateText}. Renew for €100 to keep your Business Page active.` },
    MANUAL_14_DAYS: { subject: "Your Business Page expires soon", text: `${name} expires on ${dateText}. Renew for €100 to avoid interruption.` },
    MANUAL_7_DAYS: { subject: "7 days left to renew your Salento Local Business Page", text: `${name} expires on ${dateText}. Renew for €100.` },
    GRACE_START: { subject: "Your membership has ended — 14 days to keep your Business Page visible", text: `${name} remains visible during its 14-day grace period. Renew for €100 before ${dateText}.` },
    GRACE_7_DAYS_LEFT: { subject: "7 days until your Business Page is removed", text: `${name} will no longer be visible after ${dateText}. Reactivate for €100.` },
    EXPIRES_TOMORROW: { subject: "Your Business Page will be removed tomorrow", text: `${name} will no longer be visible after ${dateText}. Reactivate for €100.` },
    EXPIRED: { subject: "Your Business Page is no longer visible", text: `${name} is no longer visible on Salento Local. Reactivate for €100.` },
  };
  const item = details[type];
  return { subject: item.subject, text: `${item.text}\n\nManage membership: ${manageUrl}` };
}

export async function runDailyMembershipReminderJob(now = new Date()) {
  const memberships = await prisma.businessMembership.findMany({
    include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { ownerEmail: true }, take: 1 } } } },
  });
  let sent = 0;
  for (const membership of memberships) {
    const type = getMembershipReminderType({ automaticRenewal: membership.automaticRenewal, currentPeriodEnd: membership.currentPeriodEnd, graceEndsAt: membership.graceEndsAt, now });
    const email = membership.business.submissions[0]?.ownerEmail?.trim();
    if (!type || !email) continue;
    try {
      await prisma.membershipReminder.create({ data: { cycleEndsAt: membership.currentPeriodEnd, membershipId: membership.id, type } });
    } catch { continue; }
    const message = copyForReminder(type, membership.business.name, type === "GRACE_START" || type === "GRACE_7_DAYS_LEFT" || type === "EXPIRES_TOMORROW" || type === "EXPIRED" ? membership.graceEndsAt : membership.currentPeriodEnd, `${getAppUrl().replace(/\/+$/, "")}/dashboard`);
    try {
      await sendTransactionalEmail({ html: `<p>${message.text.replace(/\n/g, "<br />")}</p>`, idempotencyKey: `membership-reminder:${membership.id}:${membership.currentPeriodEnd.toISOString()}:${type}`, subject: message.subject, text: message.text, to: email });
      sent += 1;
    } catch {
      await prisma.membershipReminder.deleteMany({ where: { cycleEndsAt: membership.currentPeriodEnd, membershipId: membership.id, type } });
    }
  }
  return { sent };
}

export async function sendMembershipPaymentOutcomeEmail(params: { membershipId: string; failed?: boolean }) {
  const membership = await prisma.businessMembership.findUnique({ where: { id: params.membershipId }, include: { business: { select: { name: true, submissions: { orderBy: { createdAt: "asc" }, select: { ownerEmail: true }, take: 1 } } } } });
  const email = membership?.business.submissions[0]?.ownerEmail?.trim();
  if (!membership || !email) return false;
  const manageUrl = `${getAppUrl().replace(/\/+$/, "")}/dashboard`;
  const end = new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(params.failed ? membership.graceEndsAt : membership.currentPeriodEnd);
  const subject = params.failed ? "We couldn’t renew your Salento Local membership" : "Your Salento Local membership has been renewed";
  const text = params.failed ? `${membership.business.name} remains visible during its 14-day grace period, ending ${end}. Update payment details or renew manually: ${manageUrl}` : `${membership.business.name} has been renewed for €100 and is active until ${end}. Receipt and membership: ${manageUrl}`;
  await sendTransactionalEmail({ html: `<p>${text}</p>`, idempotencyKey: `membership-outcome:${membership.id}:${params.failed ? membership.graceEndsAt.toISOString() : membership.currentPeriodEnd.toISOString()}`, subject, text, to: email });
  return true;
}
