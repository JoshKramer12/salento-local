import { MembershipReminderType, PrismaClient } from "@prisma/client";
import { z } from "zod";

import type { Locale } from "@/lib/i18n";
import { sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/validation";

const emailSchema = z.string().email();
const REMINDER_ATTEMPT_STALE_AFTER_MS = 15 * 60 * 1000;

export type ReminderMembership = {
  annualPriceCents: number;
  automaticRenewal: boolean;
  business: {
    name: string;
    ownerAccesses: Array<{
      activatedAt: Date | null;
      email: string | null;
      updatedAt: Date;
      userId: string | null;
      user: { legalAcceptances: Array<{ locale: string }> } | null;
    }>;
    submissions: Array<{ ownerEmail: string; ownerHasNoEmail: boolean }>;
  };
  businessId: string;
  currentPeriodEnd: Date;
  entitlementRevokedAt: Date | null;
  graceEndsAt: Date;
  id: string;
  recurringPaymentReady: boolean;
  stripeCancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
};

type ReminderClaim = { id: string };

/** An internal store seam for isolated reminder database fixtures. */
export type MembershipReminderStore = {
  claimReminder(params: { cycleEndsAt: Date; membershipId: string; now: Date; type: MembershipReminderType }): Promise<ReminderClaim | null>;
  listMemberships(): Promise<ReminderMembership[]>;
  markAccepted(params: { acceptedAt: Date; id: string; messageId: string | null; provider: "resend" | "smtp" }): Promise<void>;
  markFailed(params: { error: string; id: string }): Promise<void>;
};

export type MembershipReminderJobDependencies = {
  now?: Date;
  sendEmail?: typeof sendTransactionalEmail;
  store?: MembershipReminderStore;
};

function utcDay(value: Date) { return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()); }
function daysUntil(target: Date, now: Date) { return Math.round((utcDay(target) - utcDay(now)) / 86_400_000); }

/** The persisted membership state is the canonical, no-network auto-renewal signal. */
export function isHealthyAutomaticRenewal(membership: Pick<ReminderMembership, "automaticRenewal" | "entitlementRevokedAt" | "recurringPaymentReady" | "stripeCancelAtPeriodEnd" | "stripeCustomerId" | "stripeSubscriptionId" | "stripeSubscriptionStatus">) {
  return Boolean(
    membership.automaticRenewal
      && membership.recurringPaymentReady
      && membership.stripeCustomerId
      && membership.stripeSubscriptionId
      && membership.stripeSubscriptionStatus === "active"
      && !membership.stripeCancelAtPeriodEnd
      && !membership.entitlementRevokedAt,
  );
}

export function getMembershipReminderType(params: {
  automaticRenewal: boolean;
  currentPeriodEnd: Date;
  entitlementRevokedAt?: Date | null;
  graceEndsAt: Date;
  healthyAutomaticRenewal?: boolean;
  now: Date;
}): MembershipReminderType | null {
  if (params.entitlementRevokedAt) return null;
  const termDays = daysUntil(params.currentPeriodEnd, params.now);
  const graceDays = daysUntil(params.graceEndsAt, params.now);
  const automatic = params.healthyAutomaticRenewal ?? params.automaticRenewal;
  if (automatic) return termDays === 30 ? "AUTO_30_DAYS" : termDays === 7 ? "AUTO_7_DAYS" : null;
  if (termDays === 30) return "MANUAL_30_DAYS";
  if (termDays === 14) return "MANUAL_14_DAYS";
  if (termDays === 7) return "MANUAL_7_DAYS";
  if (termDays === 0) return "GRACE_START";
  if (graceDays === 7) return "GRACE_7_DAYS_LEFT";
  if (graceDays === 1) return "EXPIRES_TOMORROW";
  if (graceDays <= 0) return "EXPIRED";
  return null;
}

function localeOf(value: string | undefined): Locale { return value === "en" ? "en" : "it"; }
function validEmail(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const email = normalizeEmail(value);
  return emailSchema.safeParse(email).success ? email : null;
}

/** Resolves contacts only from this exact business, never from a Partner. */
export function resolveMembershipReminderRecipient(business: ReminderMembership["business"]) {
  const accesses = [...business.ownerAccesses].sort((a, b) =>
    Number(Boolean(b.userId && b.activatedAt)) - Number(Boolean(a.userId && a.activatedAt)) || b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  for (const access of accesses) {
    const email = validEmail(access.email);
    if (email) return { email, locale: localeOf(access.user?.legalAcceptances[0]?.locale) };
  }
  for (const submission of business.submissions) {
    const email = submission.ownerHasNoEmail ? null : validEmail(submission.ownerEmail);
    if (email) return { email, locale: "it" as const };
  }
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
function formatDate(locale: Locale, date: Date) { return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "long" }).format(date); }

type MembershipEmailCopy = { body: string; cta: string; eyebrow: string; heading: string; subject: string; supporting: string };

function reminderCopy(type: MembershipReminderType, locale: Locale, name: string, date: Date): MembershipEmailCopy {
  const business = `“${name}”`;
  const on = formatDate(locale, date);
  const it = locale === "it";
  const copy: Record<MembershipReminderType, MembershipEmailCopy> = it ? {
    AUTO_30_DAYS: { subject: "Il tuo abbonamento Salento Local si rinnoverà tra 30 giorni", eyebrow: "RINNOVO AUTOMATICO", heading: "Il tuo abbonamento si rinnoverà presto", body: `L'abbonamento per ${business} si rinnoverà automaticamente a €100/anno il ${on}.`, supporting: "Non è richiesta alcuna azione se desideri mantenere attiva la tua Pagina Attività. Puoi gestire il rinnovo automatico dal tuo account.", cta: "Gestisci abbonamento" },
    AUTO_7_DAYS: { subject: "Il tuo abbonamento Salento Local si rinnoverà tra 7 giorni", eyebrow: "RINNOVO AUTOMATICO", heading: "Il tuo abbonamento si rinnoverà tra 7 giorni", body: `L'abbonamento per ${business} si rinnoverà automaticamente a €100/anno il ${on}.`, supporting: "Il rinnovo automatico è attivo: non è necessario alcun pagamento manuale. Puoi gestire le impostazioni dal tuo account.", cta: "Gestisci abbonamento" },
    MANUAL_30_DAYS: { subject: "Il tuo abbonamento Salento Local scade tra 30 giorni", eyebrow: "RINNOVO MANUALE", heading: "Il tuo abbonamento scade tra 30 giorni", body: `L'abbonamento per ${business} resta attivo fino al ${on}. Il rinnovo automatico è disattivato.`, supporting: "Rinnova a €100/anno entro questa data per mantenere attiva la tua Pagina Attività.", cta: "Rinnova abbonamento" },
    MANUAL_14_DAYS: { subject: "Il tuo abbonamento Salento Local scade presto", eyebrow: "RINNOVO MANUALE", heading: "Mancano 14 giorni al rinnovo", body: `L'abbonamento per ${business} resta attivo fino al ${on}. Il rinnovo automatico è disattivato.`, supporting: "Rinnova a €100/anno per mantenere attiva la tua Pagina Attività.", cta: "Rinnova abbonamento" },
    MANUAL_7_DAYS: { subject: "Mancano 7 giorni al rinnovo della tua Pagina Attività", eyebrow: "RINNOVO MANUALE", heading: "Mancano 7 giorni al rinnovo", body: `L'abbonamento per ${business} resta attivo fino al ${on}. Il rinnovo automatico è disattivato.`, supporting: "Rinnova a €100/anno entro questa data per evitare interruzioni della tua Pagina Attività.", cta: "Rinnova abbonamento" },
    GRACE_START: { subject: "Il tuo abbonamento è terminato: hai ancora 14 giorni", eyebrow: "PERIODO DI GRAZIA", heading: "La tua Pagina Attività è ancora visibile", body: `Il periodo annuale per ${business} è terminato, ma la Pagina Attività rimane visibile fino al ${on}.`, supporting: "Rinnova a €100/anno entro questa data per evitare che la pagina diventi inattiva.", cta: "Rinnova abbonamento" },
    GRACE_7_DAYS_LEFT: { subject: "Mancano 7 giorni alla disattivazione della tua Pagina Attività", eyebrow: "PERIODO DI GRAZIA", heading: "Mancano 7 giorni", body: `La Pagina Attività di ${business} rimane visibile fino al ${on}.`, supporting: "Il periodo annuale è terminato. Rinnova a €100/anno per mantenere attiva la pagina.", cta: "Rinnova abbonamento" },
    EXPIRES_TOMORROW: { subject: "La tua Pagina Attività sarà disattivata domani", eyebrow: "PERIODO DI GRAZIA", heading: "La tua Pagina Attività scade domani", body: `La Pagina Attività di ${business} non sarà più visibile dopo il ${on}.`, supporting: "Rinnova a €100/anno oggi per mantenerla attiva.", cta: "Rinnova abbonamento" },
    EXPIRED: { subject: "La tua Pagina Attività non è più visibile", eyebrow: "ABBONAMENTO SCADUTO", heading: "La tua Pagina Attività è inattiva", body: `La Pagina Attività di ${business} non è più visibile pubblicamente su Salento Local.`, supporting: "Le informazioni della tua attività sono ancora salvate. Riattiva l'abbonamento a €100 per rendere di nuovo pubblica la pagina.", cta: "Riattiva abbonamento" },
  } : {
    AUTO_30_DAYS: { subject: "Your Salento Local membership renews in 30 days", eyebrow: "AUTOMATIC RENEWAL", heading: "Your membership renews soon", body: `Your membership for ${business} will automatically renew for €100/year on ${on}.`, supporting: "No action is required if you'd like to keep your Business Page active. You can manage automatic renewal from your account.", cta: "Manage membership" },
    AUTO_7_DAYS: { subject: "Your Salento Local membership renews in 7 days", eyebrow: "AUTOMATIC RENEWAL", heading: "Your membership renews in 7 days", body: `Your membership for ${business} will automatically renew for €100/year on ${on}.`, supporting: "Automatic renewal is on, so no manual payment is required. You can manage your settings from your account.", cta: "Manage membership" },
    MANUAL_30_DAYS: { subject: "Your Salento Local membership expires in 30 days", eyebrow: "MANUAL RENEWAL", heading: "Your membership expires in 30 days", body: `Your membership for ${business} is active until ${on}. Automatic renewal is off.`, supporting: "Renew your membership for €100/year before this date to keep your Business Page active.", cta: "Renew membership" },
    MANUAL_14_DAYS: { subject: "Your Salento Local membership expires soon", eyebrow: "MANUAL RENEWAL", heading: "14 days left to renew", body: `Your membership for ${business} is active until ${on}. Automatic renewal is off.`, supporting: "Renew your membership for €100/year to keep your Business Page active.", cta: "Renew membership" },
    MANUAL_7_DAYS: { subject: "7 days left to renew your Salento Local Business Page", eyebrow: "MANUAL RENEWAL", heading: "7 days left to renew", body: `Your membership for ${business} is active until ${on}. Automatic renewal is off.`, supporting: "Renew your membership for €100/year before this date to avoid an interruption to your Business Page.", cta: "Renew membership" },
    GRACE_START: { subject: "Your membership has ended — 14 days to keep your Business Page visible", eyebrow: "GRACE PERIOD", heading: "Your Business Page is still visible", body: `The annual term for ${business} has ended, but its Business Page remains visible until ${on}.`, supporting: "Renew for €100/year before that date to prevent the page from becoming inactive.", cta: "Renew membership" },
    GRACE_7_DAYS_LEFT: { subject: "7 days until your Business Page is removed", eyebrow: "GRACE PERIOD", heading: "7 days remaining", body: `The Business Page for ${business} remains visible until ${on}.`, supporting: "Its paid annual term has ended. Renew for €100/year to keep the page active.", cta: "Renew membership" },
    EXPIRES_TOMORROW: { subject: "Your Business Page will be removed tomorrow", eyebrow: "GRACE PERIOD", heading: "Your Business Page expires tomorrow", body: `The Business Page for ${business} will no longer be visible after ${on}.`, supporting: "Renew for €100/year today to keep it active.", cta: "Renew membership" },
    EXPIRED: { subject: "Your Business Page is no longer visible", eyebrow: "MEMBERSHIP EXPIRED", heading: "Your Business Page is inactive", body: `The Business Page for ${business} is no longer publicly visible on Salento Local.`, supporting: "Your business information remains saved. Reactivate for €100 to make the page public again.", cta: "Reactivate membership" },
  };
  return copy[type];
}

function renderMembershipEmail(copy: MembershipEmailCopy, businessName: string, locale: Locale, manageUrl: string) {
  const businessLabel = locale === "it" ? "Attività" : "Business";
  const footer = locale === "it" ? "Salento Local · Comunicazione sul tuo abbonamento" : "Salento Local · Membership account notice";
  const text = `SALENTO LOCAL\n${copy.eyebrow}\n\n${copy.heading}\n\n${businessLabel}: ${businessName}\n\n${copy.body}\n\n${copy.supporting}\n\n${copy.cta}: ${manageUrl}\n\nSalento Local`;
  return {
    html: `<div style="margin:0;padding:28px 12px;background:#f7f2ea;color:#243b34;font-family:Arial,sans-serif;line-height:1.55"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fffdf9;border:1px solid #e5ddd1;border-radius:20px"><tr><td style="padding:34px"><p style="margin:0;color:#2a6257;font-size:13px;font-weight:700;letter-spacing:1.7px">SALENTO LOCAL</p><p style="margin:26px 0 0;color:#806e55;font-size:12px;font-weight:700;letter-spacing:1.4px">${escapeHtml(copy.eyebrow)}</p><h1 style="margin:8px 0 0;color:#243b34;font-family:Georgia,serif;font-size:32px;line-height:1.2">${escapeHtml(copy.heading)}</h1><p style="margin:24px 0 0;color:#64736d;font-size:14px">${escapeHtml(businessLabel)}</p><p style="margin:2px 0 22px;color:#243b34;font-size:18px;font-weight:700">${escapeHtml(businessName)}</p><p style="margin:0;font-size:16px">${escapeHtml(copy.body)}</p><p style="margin:16px 0 0;color:#485c54;font-size:15px">${escapeHtml(copy.supporting)}</p><p style="margin:28px 0"><a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:#2a6257;border-radius:10px;color:#fffdf9;font-weight:700;padding:13px 20px;text-decoration:none">${escapeHtml(copy.cta)}</a></p><p style="margin:28px 0 0;border-top:1px solid #e5ddd1;padding-top:18px;color:#64736d;font-size:12px">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></div>`,
    subject: copy.subject,
    text,
  };
}

export function buildMembershipReminderEmail(params: { businessName: string; date: Date; locale: Locale; manageUrl: string; type: MembershipReminderType }) {
  return renderMembershipEmail(reminderCopy(params.type, params.locale, params.businessName, params.date), params.businessName, params.locale, params.manageUrl);
}

export function buildMembershipPaymentOutcomeEmail(params: { businessName: string; date: Date; failed: boolean; locale: Locale; manageUrl: string }) {
  const on = formatDate(params.locale, params.date);
  const failed = params.failed;
  const copy: MembershipEmailCopy = params.locale === "it" ? (failed
    ? { subject: "Non siamo riusciti a rinnovare il tuo abbonamento Salento Local", eyebrow: "PAGAMENTO NON RIUSCITO", heading: "Il rinnovo automatico non è andato a buon fine", body: `Non siamo riusciti ad addebitare €100 per rinnovare automaticamente l'abbonamento di “${params.businessName}”.`, supporting: `La Pagina Attività resta visibile durante il periodo di grazia, fino al ${on}. Accedi al tuo account per rinnovare o gestire il pagamento.`, cta: "Gestisci abbonamento" }
    : { subject: "Il tuo abbonamento Salento Local è stato rinnovato", eyebrow: "RINNOVO COMPLETATO", heading: "Il tuo abbonamento è stato rinnovato", body: `L'abbonamento per “${params.businessName}” è stato rinnovato con successo. Sono stati addebitati €100.`, supporting: `La tua Pagina Attività è attiva per un altro anno, fino al ${on}. Ricevuta e dettagli di pagamento sono disponibili dal tuo account.`, cta: "Gestisci abbonamento" }) : (failed
    ? { subject: "We couldn’t renew your Salento Local membership", eyebrow: "PAYMENT FAILED", heading: "Automatic renewal was unsuccessful", body: `We couldn't charge €100 to automatically renew the membership for “${params.businessName}”.`, supporting: `The Business Page remains visible during its grace period, until ${on}. Sign in to renew or manage payment.`, cta: "Manage membership" }
    : { subject: "Your Salento Local membership has been renewed", eyebrow: "RENEWAL COMPLETE", heading: "Your membership has been renewed", body: `The membership for “${params.businessName}” renewed successfully. €100 was charged.`, supporting: `Your Business Page is active for another year, until ${on}. Your receipt and payment information are available in your account.`, cta: "Manage membership" });
  return renderMembershipEmail(copy, params.businessName, params.locale, params.manageUrl);
}

export function createMembershipReminderStore(db: PrismaClient = prisma): MembershipReminderStore {
  return {
    async listMemberships() {
      return db.businessMembership.findMany({ include: { business: { select: {
        name: true,
        ownerAccesses: { orderBy: { updatedAt: "desc" }, select: { activatedAt: true, email: true, updatedAt: true, userId: true, user: { select: { legalAcceptances: { orderBy: { acceptedAt: "desc" }, select: { locale: true }, take: 1 } } } } },
        submissions: { orderBy: { createdAt: "desc" }, select: { ownerEmail: true, ownerHasNoEmail: true } },
      } } } });
    },
    async claimReminder(params) {
      let reminder = await db.membershipReminder.findUnique({ where: { membershipId_cycleEndsAt_type: { membershipId: params.membershipId, cycleEndsAt: params.cycleEndsAt, type: params.type } }, select: { acceptedAt: true, id: true } });
      if (!reminder) {
        try { reminder = await db.membershipReminder.create({ data: { cycleEndsAt: params.cycleEndsAt, membershipId: params.membershipId, type: params.type }, select: { acceptedAt: true, id: true } }); }
        catch { reminder = await db.membershipReminder.findUnique({ where: { membershipId_cycleEndsAt_type: { membershipId: params.membershipId, cycleEndsAt: params.cycleEndsAt, type: params.type } }, select: { acceptedAt: true, id: true } }); }
      }
      if (!reminder || reminder.acceptedAt) return null;
      const count = await db.membershipReminder.updateMany({
        where: { id: reminder.id, acceptedAt: null, OR: [{ attemptedAt: null }, { attemptedAt: { lt: new Date(params.now.getTime() - REMINDER_ATTEMPT_STALE_AFTER_MS) } }, { failureMessage: { not: null } }] },
        data: { attemptedAt: params.now, attemptCount: { increment: 1 }, failureMessage: null },
      });
      return count.count === 1 ? { id: reminder.id } : null;
    },
    async markAccepted(params) { await db.membershipReminder.update({ where: { id: params.id }, data: { acceptedAt: params.acceptedAt, failureMessage: null, provider: params.provider, providerMessageId: params.messageId } }); },
    async markFailed(params) { await db.membershipReminder.update({ where: { id: params.id }, data: { failureMessage: params.error } }); },
  };
}

function safeErrorMessage(error: unknown) { return (error instanceof Error ? error.message : "email_delivery_failed").slice(0, 500); }

export async function runDailyMembershipReminderJob(nowOrDependencies: Date | MembershipReminderJobDependencies = new Date(), dependencies: MembershipReminderJobDependencies = {}) {
  const supplied = nowOrDependencies instanceof Date ? dependencies : nowOrDependencies;
  const now = nowOrDependencies instanceof Date ? nowOrDependencies : supplied.now ?? new Date();
  const store = supplied.store ?? createMembershipReminderStore();
  const sendEmail = supplied.sendEmail ?? sendTransactionalEmail;
  let sent = 0;
  for (const membership of await store.listMemberships()) {
    const type = getMembershipReminderType({ automaticRenewal: membership.automaticRenewal, currentPeriodEnd: membership.currentPeriodEnd, entitlementRevokedAt: membership.entitlementRevokedAt, graceEndsAt: membership.graceEndsAt, healthyAutomaticRenewal: isHealthyAutomaticRenewal(membership), now });
    const recipient = resolveMembershipReminderRecipient(membership.business);
    if (!type || !recipient) continue;
    const claim = await store.claimReminder({ cycleEndsAt: membership.currentPeriodEnd, membershipId: membership.id, now, type });
    if (!claim) continue;
    const date = ["GRACE_START", "GRACE_7_DAYS_LEFT", "EXPIRES_TOMORROW", "EXPIRED"].includes(type) ? membership.graceEndsAt : membership.currentPeriodEnd;
    const message = buildMembershipReminderEmail({ businessName: membership.business.name, date, locale: recipient.locale, manageUrl: `${getAppUrl().replace(/\/+$/, "")}/dashboard`, type });
    try {
      const result = await sendEmail({ html: message.html, idempotencyKey: `membership-reminder:${membership.id}:${membership.currentPeriodEnd.toISOString()}:${type}`, subject: message.subject, text: message.text, to: recipient.email });
      await store.markAccepted({ acceptedAt: new Date(), id: claim.id, messageId: result.messageId, provider: result.provider });
      sent += 1;
    } catch (error) { await store.markFailed({ error: safeErrorMessage(error), id: claim.id }); }
  }
  return { sent };
}

export async function sendMembershipPaymentOutcomeEmail(params: { membershipId: string; failed?: boolean }) {
  const membership = await prisma.businessMembership.findUnique({ where: { id: params.membershipId }, include: { business: { select: {
    name: true,
    ownerAccesses: { orderBy: { updatedAt: "desc" }, select: { activatedAt: true, email: true, updatedAt: true, userId: true, user: { select: { legalAcceptances: { orderBy: { acceptedAt: "desc" }, select: { locale: true }, take: 1 } } } } },
    submissions: { orderBy: { createdAt: "desc" }, select: { ownerEmail: true, ownerHasNoEmail: true } },
  } } } });
  if (!membership) return false;
  const recipient = resolveMembershipReminderRecipient(membership.business);
  if (!recipient) return false;
  const message = buildMembershipPaymentOutcomeEmail({ businessName: membership.business.name, date: params.failed ? membership.graceEndsAt : membership.currentPeriodEnd, failed: Boolean(params.failed), locale: recipient.locale, manageUrl: `${getAppUrl().replace(/\/+$/, "")}/dashboard` });
  await sendTransactionalEmail({ html: message.html, idempotencyKey: `membership-outcome:${membership.id}:${params.failed ? membership.graceEndsAt.toISOString() : membership.currentPeriodEnd.toISOString()}`, subject: message.subject, text: message.text, to: recipient.email });
  return true;
}
