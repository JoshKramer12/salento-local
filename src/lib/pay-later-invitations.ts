import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { BusinessSubmission, BusinessSubmissionInvitation, Prisma } from "@prisma/client";
import { z } from "zod";

import { buildSelectedAddressFromStoredFields } from "@/lib/address-selection";
import { sendTransactionalEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { isPublicFinancialHold } from "@/lib/stripe";
import { getSupportContactEmail } from "@/lib/support-contact";
import { isPossiblePhoneNumber, normalizeEmail, normalizePhoneNumber } from "@/lib/validation";

export const PAY_LATER_TOKEN_DAYS = 45;
export const PAY_LATER_OTP_MINUTES = 10;
export const PAY_LATER_REMINDER_DAYS = [3, 6, 13, 20, 27, 34] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_LEASE_MS = 15 * 60 * 1000;
const SESSION_MS = 2 * 60 * 60 * 1000;

export function isPayLaterEnabled() {
  return process.env.PAY_LATER_ENABLED === "true";
}

function secret() {
  const value = process.env.PAY_LATER_TOKEN_SECRET?.trim() || process.env.OWNER_ACCESS_TOKEN_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("pay_later_token_secret_missing");
  return value;
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function hmac(value: string) { return createHmac("sha256", secret()).update(value).digest("base64url"); }
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function deriveInvitationToken(invitation: Pick<BusinessSubmissionInvitation, "id" | "tokenNonce">) {
  return hmac(`pay-later:invitation:${invitation.id}:${invitation.tokenNonce}`);
}
export function hashInvitationToken(token: string) { return sha256(token); }
export function getInvitationUrl(invitation: Pick<BusinessSubmissionInvitation, "id" | "tokenNonce">) {
  return `${getAppUrl()}/pay-later#invite=${encodeURIComponent(deriveInvitationToken(invitation))}`;
}
export function getPayLaterSessionCookieName(invitationId: string) { return `pay_later_${invitationId}`; }
export function getOwnerDetailsHash(submission: BusinessSubmission) {
  return sha256(JSON.stringify({
    address: submission.address, addressPlaceId: submission.addressPlaceId,
    businessName: submission.businessName, categoryId: submission.categoryId,
    email: submission.email, longDescription: submission.longDescription,
    openingHours: submission.openingHours, ownerEmail: normalizeEmail(submission.ownerEmail),
    ownerName: submission.ownerName, ownerPhone: normalizePhoneNumber(submission.ownerPhone) ?? submission.ownerPhone.trim(),
    phone: submission.phone, photoUrls: submission.photoUrls, shortDescription: submission.shortDescription,
    townId: submission.townId, whatsapp: submission.whatsapp,
    businessTermsVersion: LISTING_OFFER.businessTermsVersion,
    privacyPolicyVersion: LISTING_OFFER.privacyPolicyVersion,
    annualPriceCents: LISTING_OFFER.annualPriceCents,
  }));
}

export type PayLaterMissingField = "businessName" | "categoryId" | "townId" | "address" | "phone" |
  "ownerName" | "ownerPhone" | "ownerEmail" | "longDescription" | "openingHours" | "photoUrls";

export class PayLaterMissingFieldsError extends Error {
  constructor(readonly fields: PayLaterMissingField[]) {
    super("pay_later_missing_fields");
  }
}

export function getPartnerListingMissingFields(submission: BusinessSubmission): PayLaterMissingField[] {
  const missing: PayLaterMissingField[] = [];
  const photos = Array.isArray(submission.photoUrls) ? submission.photoUrls.filter((url) => typeof url === "string" && url.trim()) : [];
  const selectedAddress = buildSelectedAddressFromStoredFields(submission);
  if (submission.businessName.trim().length < 2) missing.push("businessName");
  if (!submission.categoryId) missing.push("categoryId");
  if (!submission.townId) missing.push("townId");
  if (!selectedAddress || submission.address.trim() !== selectedAddress.formattedAddress.trim()) missing.push("address");
  // Match the wizard and final submission's possible-number rule. A stricter
  // national-prefix check here rejected drafts accepted by those earlier steps.
  if (!isPossiblePhoneNumber(submission.phone)) missing.push("phone");
  if (submission.ownerName.trim().length < 2) missing.push("ownerName");
  if (!isPossiblePhoneNumber(submission.ownerPhone)) missing.push("ownerPhone");
  if (!z.email().safeParse(normalizeEmail(submission.ownerEmail)).success) missing.push("ownerEmail");
  if (!submission.longDescription.trim()) missing.push("longDescription");
  if (!submission.openingHours.trim()) missing.push("openingHours");
  if (photos.length < 2) missing.push("photoUrls");
  return missing;
}

export function assertInvitationDraftEligible(submission: BusinessSubmission | null, submitterRole: string) {
  if (!submission || !["GETTER", "BUSINESS_OWNER"].includes(submitterRole) || submission.status !== "DRAFT" ||
    submission.paymentMethod || submission.paymentStatus !== "NOT_REQUIRED" || submission.createdBusinessId) {
    throw new Error("pay_later_submission_ineligible");
  }
  const missingFields = getPartnerListingMissingFields(submission);
  if (missingFields.length) throw new PayLaterMissingFieldsError(missingFields);
}

export function invitationIsOpen(invitation: BusinessSubmissionInvitation, submission: Pick<BusinessSubmission, "status" | "paymentStatus" | "createdBusinessId">, now = new Date()) {
  return !invitation.revokedAt && !invitation.declinedAt && !invitation.completedAt &&
    invitation.tokenExpiresAt > now && submission.status !== "PUBLISHED" &&
    submission.paymentStatus !== "PAID" && !submission.createdBusinessId;
}

export async function getInvitationByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const invitation = await prisma.businessSubmissionInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) }, include: { businessSubmission: true },
  });
  if (!invitation || !invitationIsOpen(invitation, invitation.businessSubmission) ||
    invitation.recipientEmail !== normalizeEmail(invitation.businessSubmission.ownerEmail)) return null;
  if (!safeEqual(deriveInvitationToken(invitation), token)) return null;
  return invitation;
}

export async function requireVerifiedInvitation(token: string, sessionToken: string | undefined) {
  const invitation = await getInvitationByToken(token);
  if (!invitation || !sessionToken || !invitation.verifiedSessionHash ||
    !invitation.verifiedSessionExpiresAt || invitation.verifiedSessionExpiresAt <= new Date() ||
    !safeEqual(sha256(sessionToken), invitation.verifiedSessionHash)) return null;
  return invitation;
}

export async function createOrRotateInvitation(params: {
  partnerUserId: string; submissionId: string; locale: Locale; now?: Date;
}) {
  if (!isPayLaterEnabled()) throw new Error("pay_later_disabled");
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const submission = await tx.businessSubmission.findFirst({
      where: { id: params.submissionId, userId: params.partnerUserId },
      include: { user: { select: { role: true } }, payLaterInvitation: true },
    });
    assertInvitationDraftEligible(submission, submission?.user.role ?? "");
    if (!submission) throw new Error("pay_later_submission_ineligible");
    const payment = await tx.payment.findFirst({ where: { businessSubmissionId: submission.id,
      purpose: "INITIAL_MEMBERSHIP", status: { in: ["PENDING_PAYMENT", "AWAITING_BANK_TRANSFER", "PAID"] } },
      select: { id: true } });
    if (payment) throw new Error("pay_later_submission_ineligible");
    const recipientEmail = normalizeEmail(submission.ownerEmail);
    const id = submission.payLaterInvitation?.id ?? cryptoRandomId();
    const tokenNonce = randomBytes(32).toString("base64url");
    const tokenHash = hashInvitationToken(deriveInvitationToken({ id, tokenNonce }));
    const resetRecipient = submission.payLaterInvitation?.recipientEmail !== recipientEmail;
    const update: Prisma.BusinessSubmissionInvitationUpdateInput = {
      recipientEmail, ownerPhone: normalizePhoneNumber(submission.ownerPhone), locale: params.locale,
      tokenNonce, tokenHash, tokenExpiresAt: new Date(now.getTime() + PAY_LATER_TOKEN_DAYS * DAY_MS),
      tokenGeneration: { increment: 1 }, lastRotatedAt: now, revokedAt: null,
      declinedAt: null,
      remindersStoppedAt: resetRecipient ? null : submission.payLaterInvitation?.remindersStoppedAt ?? null,
      verifiedAt: null, verifiedDetailsHash: null,
      verifiedSessionHash: null, verifiedSessionExpiresAt: null,
      otpCodeHash: null, otpExpiresAt: null, otpAttemptCount: 0,
      emailAttemptedAt: null, emailFirstAttemptedAt: null,
      emailNextAttemptAt: now, emailFailureMessage: null,
      emailAcceptedGeneration: null,
      reminderCursor: resetRecipient ? 0 : submission.payLaterInvitation?.reminderCursor ?? 0,
      whatsappPreparedAt: null,
      partnerCapturedSignature: submission.agreementSignature || null,
      ...(resetRecipient ? { emailAcceptedAt: null, emailProvider: null, emailProviderMessageId: null } : {}),
    };
    if (submission.payLaterInvitation) {
      if (submission.payLaterInvitation.completedAt || submission.payLaterInvitation.declinedAt) throw new Error("pay_later_invitation_closed");
      if (resetRecipient) await tx.businessSubmissionInvitationReminder.deleteMany({ where: { invitationId: id } });
      await tx.businessSubmissionInvitation.update({ where: { id }, data: update });
    } else {
      await tx.businessSubmissionInvitation.create({ data: {
        id, businessSubmissionId: submission.id, partnerUserId: params.partnerUserId,
        recipientEmail, ownerPhone: normalizePhoneNumber(submission.ownerPhone), locale: params.locale,
        tokenNonce, tokenHash, tokenExpiresAt: new Date(now.getTime() + PAY_LATER_TOKEN_DAYS * DAY_MS),
        emailNextAttemptAt: now, partnerCapturedSignature: submission.agreementSignature || null,
      } });
    }
    return { id, tokenNonce, recipientEmail, ownerPhone: normalizePhoneNumber(submission.ownerPhone) };
  });
}
function cryptoRandomId() { return randomBytes(18).toString("base64url"); }

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
export function buildPayLaterEmailFrame(headline: string, body: string, action: string, href: string, footer: string) {
  return `<div style="padding:28px 12px;background:#f7f2ea;color:#243b34;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:620px;background:#fffdf9;border:1px solid #e5ddd1;border-radius:18px"><tr><td style="padding:32px"><p style="color:#2a6257;font-weight:700;letter-spacing:2px">SALENTO LOCAL</p><h1 style="font-family:Georgia,serif;font-size:30px">${escapeHtml(headline)}</h1><div style="line-height:1.65">${body}</div><p style="margin:30px 0"><a href="${escapeHtml(href)}" style="background:#2a6257;color:#fff;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></p><p style="font-size:13px;color:#65756d">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></div>`;
}
export function buildInvitationEmail(params: { businessName: string; townName: string; ownerName: string; locale: Locale; url: string; ownerSubmitted?: boolean; paymentPaused?: boolean }) {
  const it = params.locale === "it";
  const greeting = params.ownerName.trim() ? `${it ? "Ciao" : "Hello"} ${escapeHtml(params.ownerName.trim().split(" ")[0])}, ` : "";
  const origin = params.ownerSubmitted
    ? (it ? "hai salvato la scheda" : "you saved the listing")
    : (it ? "un Local Partner Salento Local ha preparato la scheda" : "a Salento Local Partner prepared the listing");
  const hold = params.paymentPaused
    ? (it ? " I pagamenti sono temporaneamente sospesi durante i test; non ti verrà addebitato nulla ora." : " Payments are temporarily paused during testing; you will not be charged now.")
    : "";
  const body = it
    ? `${greeting}${origin} di <strong>${escapeHtml(params.businessName)}</strong> a ${escapeHtml(params.townName)}. La scheda non è ancora attiva. Controlla i dati, verifica la tua email, accetta i termini, firma e scegli come pagare l’adesione annuale di <strong>€100</strong>.${hold}`
    : `${greeting}${origin} for <strong>${escapeHtml(params.businessName)}</strong> in ${escapeHtml(params.townName)}. It is not active yet. Review the details, verify your email, accept the terms, sign, and choose how to pay the <strong>€100 annual membership</strong>.${hold}`;
  const subject = it ? "La tua attività è pronta su Salento Local" : "Your business is ready on Salento Local";
  const headline = it ? "La tua attività è quasi pronta!" : "Your business is almost ready!";
  const action = it ? "Controlla e completa l’adesione" : "Review and complete membership";
  const support = getSupportContactEmail();
  const footer = it
    ? `Se non riconosci questa richiesta, apri il link e scegli di rifiutare. Per assistenza, ${support ? `scrivi a ${support}` : "rispondi a questa email"}.`
    : `If you do not recognize this request, open the link and decline. For help, ${support ? `write to ${support}` : "reply to this email"}.`;
  return { subject, html: buildPayLaterEmailFrame(headline, body, action, params.url, footer),
    text: `${headline}\n\n${params.businessName} · ${params.townName}\n\n${it ? "La scheda non è ancora attiva. Verifica la tua email, controlla i dati e completa l’adesione annuale di €100." : "The listing is not active. Verify your email, review the details and complete the €100 annual membership."}${hold}\n\n${params.url}\n\n${footer}` };
}

export async function attemptInvitationEmail(invitationId: string, now = new Date(), sendEmail = sendTransactionalEmail) {
  const pending = await prisma.businessSubmissionInvitation.findUnique({ where: { id: invitationId },
    select: { tokenGeneration: true, emailFirstAttemptedAt: true, emailNextAttemptAt: true } });
  if (!pending?.emailNextAttemptAt || pending.emailNextAttemptAt > now) return "skipped" as const;
  // Resend retains an idempotency key for 24 hours. After 23 hours, a lost
  // provider acknowledgement needs manual review instead of another send.
  if (pending.emailFirstAttemptedAt &&
    now.getTime() - pending.emailFirstAttemptedAt.getTime() >= 23 * 60 * 60 * 1000) {
    const quarantined = await prisma.businessSubmissionInvitation.updateMany({
      where: { id: invitationId, tokenGeneration: pending.tokenGeneration,
        completedAt: null, declinedAt: null, revokedAt: null,
        emailNextAttemptAt: { lte: now }, emailFirstAttemptedAt: pending.emailFirstAttemptedAt },
      data: { emailNextAttemptAt: null, emailFailureMessage: "delivery_uncertain_requires_review" },
    });
    return quarantined.count ? "pending" as const : "skipped" as const;
  }
  const claimed = await prisma.businessSubmissionInvitation.updateMany({
    where: { id: invitationId, tokenGeneration: pending.tokenGeneration,
      completedAt: null, declinedAt: null, revokedAt: null,
      emailNextAttemptAt: { lte: now }, emailFirstAttemptedAt: pending.emailFirstAttemptedAt },
    data: { emailAttemptedAt: now, emailFirstAttemptedAt: pending.emailFirstAttemptedAt ?? now,
      emailAttemptCount: { increment: 1 },
      emailNextAttemptAt: new Date(now.getTime() + EMAIL_LEASE_MS), emailFailureMessage: null },
  });
  if (!claimed.count) return "skipped" as const;
  const invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({
    where: { id: invitationId }, include: { businessSubmission: { include: { town: true, user: { select: { role: true } } } } },
  });
  if (invitation.tokenGeneration !== pending.tokenGeneration ||
    !invitationIsOpen(invitation, invitation.businessSubmission, now) ||
    normalizeEmail(invitation.businessSubmission.ownerEmail) !== invitation.recipientEmail) return "skipped" as const;
  const message = buildInvitationEmail({ businessName: invitation.businessSubmission.businessName,
    townName: invitation.businessSubmission.town.name, ownerName: invitation.businessSubmission.ownerName,
    locale: invitation.locale === "en" ? "en" : "it", url: getInvitationUrl(invitation),
    ownerSubmitted: invitation.businessSubmission.user.role === "BUSINESS_OWNER",
    paymentPaused: isPublicFinancialHold() });
  try {
    const sent = await sendEmail({ ...message, to: invitation.recipientEmail,
      idempotencyKey: `pay-later-invitation:${invitation.id}:${invitation.tokenGeneration}` });
    await prisma.businessSubmissionInvitation.updateMany({
      where: { id: invitation.id, tokenGeneration: invitation.tokenGeneration, revokedAt: null },
      data: { emailAcceptedAt: invitation.emailAcceptedAt ?? new Date(), emailAcceptedGeneration: invitation.tokenGeneration,
        emailNextAttemptAt: null,
        emailProvider: sent.provider, emailProviderMessageId: sent.messageId, emailFailureMessage: null },
    });
    return "accepted" as const;
  } catch {
    await prisma.businessSubmissionInvitation.updateMany({
      where: { id: invitation.id, tokenGeneration: invitation.tokenGeneration },
      data: { emailFailureMessage: "email_provider_failed",
        emailNextAttemptAt: new Date(now.getTime() + 30 * 60 * 1000) },
    });
    return "pending" as const;
  }
}

export async function startInvitationOtp(token: string, now = new Date(), sendEmail = sendTransactionalEmail) {
  const invitation = await getInvitationByToken(token);
  if (!invitation || invitation.emailAcceptedGeneration !== invitation.tokenGeneration) return "unavailable" as const;
  const windowStart = invitation.otpSendWindowStartedAt;
  const inWindow = Boolean(windowStart && windowStart > new Date(now.getTime() - DAY_MS));
  if (inWindow && invitation.otpSendCount >= 6) return "limit" as const;
  if (invitation.otpSentAt && invitation.otpSentAt > new Date(now.getTime() - 2 * 60 * 1000)) return "cooldown" as const;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hmac(`pay-later:otp:${invitation.id}:${code}`);
  const updated = await prisma.businessSubmissionInvitation.updateMany({
    where: { id: invitation.id, tokenHash: invitation.tokenHash, otpSentAt: invitation.otpSentAt,
      completedAt: null, declinedAt: null, revokedAt: null },
    data: { otpCodeHash: hash, otpExpiresAt: new Date(now.getTime() + PAY_LATER_OTP_MINUTES * 60_000),
      otpAttemptCount: 0, otpSentAt: now, otpSendCount: inWindow ? { increment: 1 } : 1,
      otpSendWindowStartedAt: inWindow ? undefined : now },
  });
  if (!updated.count) return "cooldown" as const;
  const it = invitation.locale !== "en";
  const body = it ? `Il tuo codice di verifica è <strong>${code}</strong>. Scade tra 10 minuti.` : `Your verification code is <strong>${code}</strong>. It expires in 10 minutes.`;
  try {
    await sendEmail({ to: invitation.recipientEmail,
      subject: it ? "Codice di verifica Salento Local" : "Salento Local verification code",
      html: buildPayLaterEmailFrame(it ? "Verifica la tua email" : "Verify your email", body,
        it ? "Apri l'invito" : "Open invitation", getInvitationUrl(invitation), "Salento Local"),
      text: `${it ? "Codice di verifica" : "Verification code"}: ${code}\n${it ? "Scade tra 10 minuti." : "Expires in 10 minutes."}` });
    return "sent" as const;
  } catch {
    await prisma.businessSubmissionInvitation.updateMany({ where: { id: invitation.id, otpCodeHash: hash },
      data: { otpCodeHash: null, otpExpiresAt: null } });
    return "delivery_failed" as const;
  }
}

export async function verifyInvitationOtp(token: string, code: string, now = new Date()) {
  const invitation = await getInvitationByToken(token);
  if (!invitation || !/^\d{6}$/.test(code)) return null;
  if (!invitation.otpCodeHash || !invitation.otpExpiresAt || invitation.otpExpiresAt <= now ||
    invitation.otpAttemptCount >= 5) return null;
  if (!safeEqual(invitation.otpCodeHash, hmac(`pay-later:otp:${invitation.id}:${code}`))) {
    await prisma.businessSubmissionInvitation.updateMany({ where: { id: invitation.id, otpAttemptCount: { lt: 5 } },
      data: { otpAttemptCount: { increment: 1 } } });
    return null;
  }
  const sessionToken = randomBytes(32).toString("base64url");
  const updated = await prisma.businessSubmissionInvitation.updateMany({
    where: { id: invitation.id, otpCodeHash: invitation.otpCodeHash, otpExpiresAt: { gt: now }, otpAttemptCount: { lt: 5 },
      revokedAt: null, declinedAt: null, completedAt: null },
    data: { otpCodeHash: null, otpExpiresAt: null, verifiedAt: now,
      verifiedDetailsHash: getOwnerDetailsHash(invitation.businessSubmission),
      verifiedSessionHash: sha256(sessionToken), verifiedSessionExpiresAt: new Date(now.getTime() + SESSION_MS) },
  });
  return updated.count ? { invitationId: invitation.id, sessionToken } : null;
}

export async function closeInvitation(invitationId: string, action: "decline" | "stop", now = new Date()) {
  const updated = await prisma.businessSubmissionInvitation.updateMany({
    where: { id: invitationId, completedAt: null,
      ...(action === "decline" ? { businessSubmission: { status: "DRAFT" as const,
        paymentMethod: null, paymentStatus: "NOT_REQUIRED" as const } } : {}) },
    data: action === "decline" ? { declinedAt: now, remindersStoppedAt: now,
      verifiedSessionHash: null, verifiedSessionExpiresAt: null } : { remindersStoppedAt: now },
  });
  return updated.count > 0;
}

export function buildPayLaterWhatsAppUrl(invitation: Pick<BusinessSubmissionInvitation, "id" | "tokenNonce" | "ownerPhone" | "locale">) {
  const phone = normalizePhoneNumber(invitation.ownerPhone);
  if (!phone) return null;
  const text = invitation.locale === "en"
    ? `Hello! Your Salento Local listing is ready. Review it and complete your membership here: ${getInvitationUrl(invitation)}`
    : `Ciao! La tua scheda su Salento Local è pronta. Controlla le informazioni e completa l’adesione qui: ${getInvitationUrl(invitation)}`;
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
