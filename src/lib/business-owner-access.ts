import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { hasResendConfiguration, sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { hasSmtpConfiguration } from "@/lib/claim-delivery";
import { normalizeEmail, normalizePhoneNumber } from "@/lib/validation";
import { normalizeEnvValue } from "@/lib/env";

type OwnerAccessDb = PrismaClient | Prisma.TransactionClient;

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Owner invitation email addresses are normalized when new data is written.
 * Older accounts can still contain a differently-cased address, though, so
 * invitation access must look them up case-insensitively as well.
 */
export async function findUserByNormalizedEmail(params: {
  db?: OwnerAccessDb;
  email: string;
}) {
  const db = params.db ?? prisma;
  const email = normalizeEmail(params.email);
  const exactMatch = await db.user.findUnique({
    where: { email },
    select: { email: true, id: true },
  });
  if (exactMatch) return exactMatch;

  // Prisma's SQLite string filters are case-sensitive. Keep this narrowly
  // parameterized query here so a legacy `Mario@Example.com` account can use
  // an invitation addressed to `mario@example.com` without creating a second
  // account. Test doubles do not need to implement raw queries.
  if (!("$queryRaw" in db) || typeof db.$queryRaw !== "function") return null;

  const matches = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "User" WHERE lower("email") = ${email} LIMIT 1
  `;
  if (!matches[0]) return null;

  return db.user.findUnique({
    where: { id: matches[0].id },
    select: { email: true, id: true },
  });
}

export async function findUserByNormalizedPhone(params: {
  db?: OwnerAccessDb;
  phone: string;
}) {
  const db = params.db ?? prisma;
  const phone = normalizePhoneNumber(params.phone);
  if (!phone) return null;
  return db.user.findUnique({
    where: { phone },
    select: { id: true, phone: true },
  });
}

export function getOwnerAccountPrefill(params: {
  email?: string | null;
  ownerName?: string | null;
  phone?: string | null;
}) {
  const name = params.ownerName?.trim().replace(/\s+/g, " ") ?? "";
  const [firstName = "", ...lastNameParts] = name ? name.split(" ") : [];
  return {
    email: params.email ? normalizeEmail(params.email) : "",
    firstName,
    lastName: lastNameParts.join(" "),
    name,
    phone: params.phone ?? "",
  };
}

function deriveDeliveryToken(invitationId: string) {
  const secret =
    normalizeEnvValue(process.env.OWNER_ACCESS_TOKEN_SECRET) ||
    normalizeEnvValue(process.env.AUTH_SECRET) ||
    normalizeEnvValue(process.env.NEXTAUTH_SECRET);

  return secret
    ? createHmac("sha256", secret).update(`owner-access:${invitationId}`).digest("base64url")
    : null;
}

export function getOwnerAccessInvitationExpiry(now = new Date()) {
  return new Date(now.getTime() + invitationLifetimeMs);
}

export function getOwnerAccessUrl(token: string, appUrl = getAppUrl()) {
  return `${appUrl.replace(/\/+$/, "")}/owner-access/${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

/**
 * The paid-listing email is intentionally built separately from access-token
 * creation. Tokens remain opaque, while this copy can be reused by the
 * authoritative payment finalizer and tested without sending email.
 */
export function buildOwnerListingEmailCopy(params: {
  businessName: string;
  locale: "en" | "it";
  manageUrl: string;
  ownerName: string;
  receiptUrl: string;
  viewUrl: string;
}) {
  const businessName = escapeHtml(params.businessName.trim());
  const firstName = escapeHtml(params.ownerName.trim().split(/\s+/)[0] || "");
  const manageUrl = escapeHtml(params.manageUrl);
  const receiptUrl = escapeHtml(params.receiptUrl);
  const viewUrl = escapeHtml(params.viewUrl);

  if (params.locale === "it") {
    return {
      html: `<div style="margin:0;padding:32px 16px;background:#f4ede3;color:#243b34;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fffdf9;border:1px solid #e5d9cc;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 32px 18px;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:bold;color:#243b34">Salento Local</td></tr><tr><td style="padding:10px 32px 34px;font-size:16px;line-height:1.6"><p style="margin:0 0 18px">Ciao${firstName ? ` ${firstName}` : ""},</p><p style="margin:0 0 18px">La tua attività, <strong>${businessName}</strong>, è ora su Salento Local.</p><p style="margin:0 0 26px">La scheda è stata creata con l'aiuto di un Partner Salento Local. Da qui puoi consultarla pubblicamente e gestirla in modo sicuro.</p><p style="margin:0 0 14px"><a href="${viewUrl}" style="display:inline-block;background:#2a6257;border-radius:9px;color:#ffffff;padding:13px 20px;text-decoration:none;font-weight:bold">Visualizza la tua attività</a></p><p style="margin:0 0 26px"><a href="${manageUrl}" style="color:#a95738;text-decoration:underline;font-weight:bold">Gestisci la tua attività</a></p><p style="margin:0 0 20px;color:#50625c;font-size:14px">Crea il tuo account o accedi utilizzando questo indirizzo email per aggiornare le informazioni della tua attività, le foto, gli orari e gli altri dettagli.</p><p style="margin:0;color:#50625c;font-size:13px">La ricevuta del pagamento è allegata a questa email. Puoi anche <a href="${receiptUrl}" style="color:#2a6257">aprirla online</a>.</p></td></tr></table></td></tr></table></div>`,
      subject: "La tua attività è ora su Salento Local",
      text: `Ciao${firstName ? ` ${firstName}` : ""},\n\nLa tua attività, ${params.businessName.trim()}, è ora su Salento Local. La scheda è stata creata con l'aiuto di un Partner Salento Local.\n\nVisualizza la tua attività: ${params.viewUrl}\nGestisci la tua attività: ${params.manageUrl}\n\nCrea il tuo account o accedi utilizzando questo indirizzo email per aggiornare le informazioni della tua attività, le foto, gli orari e gli altri dettagli.\n\nRicevuta: ${params.receiptUrl}`,
    };
  }

  return {
    html: `<div style="margin:0;padding:32px 16px;background:#f4ede3;color:#243b34;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fffdf9;border:1px solid #e5d9cc;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 32px 18px;font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:bold;color:#243b34">Salento Local</td></tr><tr><td style="padding:10px 32px 34px;font-size:16px;line-height:1.6"><p style="margin:0 0 18px">Hello${firstName ? ` ${firstName}` : ""},</p><p style="margin:0 0 18px">Your business, <strong>${businessName}</strong>, is now on Salento Local.</p><p style="margin:0 0 26px">Your listing was created with the help of a Salento Local Partner. You can now view it and manage it securely.</p><p style="margin:0 0 14px"><a href="${viewUrl}" style="display:inline-block;background:#2a6257;border-radius:9px;color:#ffffff;padding:13px 20px;text-decoration:none;font-weight:bold">View your business</a></p><p style="margin:0 0 26px"><a href="${manageUrl}" style="color:#a95738;text-decoration:underline;font-weight:bold">Manage your business</a></p><p style="margin:0 0 20px;color:#50625c;font-size:14px">Create an account or sign in with this email address to update your business information, photos, opening hours, and other details.</p><p style="margin:0;color:#50625c;font-size:13px">Your payment receipt is attached. You can also <a href="${receiptUrl}" style="color:#2a6257">open it online</a>.</p></td></tr></table></td></tr></table></div>`,
    subject: "Your business is now on Salento Local",
    text: `Hello${firstName ? ` ${firstName}` : ""},\n\nYour business, ${params.businessName.trim()}, is now on Salento Local. Your listing was created with the help of a Salento Local Partner.\n\nView your business: ${params.viewUrl}\nManage your business: ${params.manageUrl}\n\nCreate an account or sign in with this email address to update your business information, photos, opening hours, and other details.\n\nReceipt: ${params.receiptUrl}`,
  };
}

export async function ensureOwnerAccessForPublishedSubmission(params: {
  db?: OwnerAccessDb;
  submissionId: string;
}) {
  const db = params.db ?? prisma;
  const submission = await db.businessSubmission.findUnique({
    where: { id: params.submissionId },
    select: {
      createdBusinessId: true,
      id: true,
      ownerEmail: true,
      ownerHasNoEmail: true,
      ownerPhone: true,
    },
  });

  if (!submission?.createdBusinessId) {
    return null;
  }

  const noEmailOwner = submission.ownerHasNoEmail || !submission.ownerEmail.trim();
  const email = noEmailOwner ? null : normalizeEmail(submission.ownerEmail);
  const phone = noEmailOwner ? normalizePhoneNumber(submission.ownerPhone) : null;
  if (!email && !phone) return null;

  const ownerUser = email
    ? await findUserByNormalizedEmail({ db, email })
    : await findUserByNormalizedPhone({ db, phone: phone! });
  const existing = await db.businessOwnerAccess.findFirst({
    where: {
      OR: [
        { sourceSubmissionId: submission.id },
        email
          ? { AND: [{ businessId: submission.createdBusinessId }, { email }] }
          : { AND: [{ businessId: submission.createdBusinessId }, { phone: phone! }] },
      ],
    },
    select: { id: true, userId: true },
  });
  const userId = ownerUser?.id ?? existing?.userId ?? null;

  const access = existing
    ? await db.businessOwnerAccess.update({
        where: { id: existing.id },
        data: {
          email,
          phone,
          sourceSubmissionId: submission.id,
          userId,
          ...(userId && !existing.userId ? { activatedAt: new Date() } : {}),
          verifiedAt: new Date(),
        },
      })
    : await db.businessOwnerAccess.create({
        data: {
          businessId: submission.createdBusinessId,
          email,
          phone,
          sourceSubmissionId: submission.id,
          userId,
          ...(userId ? { activatedAt: new Date() } : {}),
        },
      });

  // Keep the legacy owner field populated for old queries and existing screens.
  // New authorization is based on BusinessOwnerAccess, so this never limits an
  // account to a single business.
  if (userId) {
    await db.business.updateMany({
      where: { id: submission.createdBusinessId, ownerUserId: null },
      data: { ownerUserId: userId },
    });
  }

  return access;
}

export async function attachOwnerAccessToUser(params: {
  accessId: string;
  db?: OwnerAccessDb;
  userId: string;
}) {
  const db = params.db ?? prisma;
  const access = await db.businessOwnerAccess.findUnique({
    where: { id: params.accessId },
    select: { businessId: true, email: true, id: true, phone: true, userId: true },
  });

  if (!access) return null;

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { email: true, id: true, phone: true },
  });

  const emailMatches = Boolean(access.email && user?.email && normalizeEmail(user.email) === access.email);
  const phoneMatches = Boolean(access.phone && user?.phone && user.phone === access.phone);
  if (!user || (!emailMatches && !phoneMatches)) {
    return null;
  }

  if (access.userId && access.userId !== user.id) {
    return null;
  }

  const updated = await db.businessOwnerAccess.update({
    where: { id: access.id },
    data: {
      activatedAt: new Date(),
      userId: user.id,
    },
  });

  await db.business.updateMany({
    where: { id: access.businessId, ownerUserId: null },
    data: { ownerUserId: user.id },
  });

  return updated;
}

export async function canManageBusiness(params: {
  businessId: string;
  db?: OwnerAccessDb;
  userId: string;
}) {
  const db = params.db ?? prisma;
  const business = await db.business.findFirst({
    where: {
      id: params.businessId,
      OR: [
        { ownerUserId: params.userId },
        { ownerAccesses: { some: { userId: params.userId } } },
      ],
    },
    select: { id: true },
  });

  return Boolean(business);
}

export async function createOwnerAccessInvitation(params: {
  accessId: string;
  db?: OwnerAccessDb;
  now?: Date;
}) {
  const db = params.db ?? prisma;
  const now = params.now ?? new Date();
  const token = makeToken();

  await db.businessOwnerAccessInvitation.updateMany({
    where: {
      businessOwnerAccessId: params.accessId,
      revokedAt: null,
      usedAt: null,
    },
    data: { revokedAt: now },
  });

  const invitation = await db.businessOwnerAccessInvitation.create({
    data: {
      businessOwnerAccessId: params.accessId,
      expiresAt: getOwnerAccessInvitationExpiry(now),
      tokenHash: hashToken(token),
    },
  });

  return { ...invitation, token };
}

export async function getOrCreateOwnerAccessDeliveryInvitation(params: {
  accessId: string;
  db?: OwnerAccessDb;
  now?: Date;
}) {
  const db = params.db ?? prisma;
  const now = params.now ?? new Date();
  const activeInvitation = await db.businessOwnerAccessInvitation.findFirst({
    where: {
      businessOwnerAccessId: params.accessId,
      expiresAt: { gt: now },
      revokedAt: null,
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (activeInvitation) {
    const reusableToken = deriveDeliveryToken(activeInvitation.id);
    if (reusableToken && hashToken(reusableToken) === activeInvitation.tokenHash) {
      return { ...activeInvitation, token: reusableToken };
    }
  }

  await db.businessOwnerAccessInvitation.updateMany({
    where: {
      businessOwnerAccessId: params.accessId,
      revokedAt: null,
      usedAt: null,
    },
    data: { revokedAt: now },
  });

  const id = randomUUID();
  const token = deriveDeliveryToken(id) ?? makeToken();
  const invitation = await db.businessOwnerAccessInvitation.create({
    data: {
      businessOwnerAccessId: params.accessId,
      expiresAt: getOwnerAccessInvitationExpiry(now),
      id,
      tokenHash: hashToken(token),
    },
  });

  return { ...invitation, token };
}

export async function resolveOwnerAccessInvitation(token: string, db: OwnerAccessDb = prisma) {
  if (!token || token.length < 20) return { status: "invalid" as const, invitation: null };

  const invitation = await db.businessOwnerAccessInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      businessOwnerAccess: {
        include: {
          business: {
            select: {
              address: true,
              category: { select: { name: true } },
              images: { orderBy: { sortOrder: "asc" }, select: { url: true }, take: 1 },
              name: true,
              slug: true,
              town: { select: { name: true } },
            },
          },
          user: { select: { id: true } },
        },
      },
    },
  });

  if (!invitation || invitation.revokedAt) {
    return { status: "invalid" as const, invitation: null };
  }
  if (invitation.usedAt) return { status: "used" as const, invitation };
  if (invitation.expiresAt <= new Date()) return { status: "expired" as const, invitation };
  return { status: "active" as const, invitation };
}

export async function markOwnerAccessInvitationUsed(params: {
  db?: OwnerAccessDb;
  invitationId: string;
}) {
  const db = params.db ?? prisma;
  await db.businessOwnerAccessInvitation.updateMany({
    where: { id: params.invitationId, usedAt: null },
    data: { usedAt: new Date() },
  });
}

export async function sendOwnerAccessEmail(params: {
  businessName: string;
  locale: "en" | "it";
  manageUrl: string;
  recipient: string;
  viewUrl: string;
}) {
  if (!hasResendConfiguration() && !hasSmtpConfiguration()) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[owner-access] transactional email is not configured.");
    }
    return false;
  }

  const copy = params.locale === "it"
    ? {
        body: `La tua attività <strong>${params.businessName}</strong> è pronta su Salento Local. Crea o usa il tuo account per aggiornare informazioni, foto e orari quando vuoi.`,
        manage: "Gestisci la tua attività",
        subject: `${params.businessName} è pronta su Salento Local`,
        view: "Vedi la tua attività",
      }
    : {
        body: `Your business <strong>${params.businessName}</strong> is ready on Salento Local. Create or use your account to update its information, photos, and opening hours whenever you need to.`,
        manage: "Manage your business",
        subject: `${params.businessName} is ready on Salento Local`,
        view: "View your business",
      };

  await sendTransactionalEmail({
    headers: { "X-Transactional-Message": "owner-access" },
    html: `<div style="font-family:Arial,sans-serif;color:#243b34;line-height:1.55"><p>${copy.body}</p><p style="margin:28px 0"><a href="${params.viewUrl}" style="display:inline-block;background:#f4ede3;color:#243b34;padding:12px 18px;border-radius:10px;text-decoration:none;margin-right:10px">${copy.view}</a><a href="${params.manageUrl}" style="display:inline-block;background:#2a6257;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">${copy.manage}</a></p><p style="color:#64736d;font-size:14px">${params.locale === "it" ? "Se non hai ancora un account, il link ti guiderà nella creazione in sicurezza." : "If you do not have an account yet, the link will guide you through secure setup."}</p></div>`,
    subject: copy.subject,
    text: `${params.locale === "it" ? `La tua attività ${params.businessName} è pronta su Salento Local.` : `Your business ${params.businessName} is ready on Salento Local.`}\n${copy.view}: ${params.viewUrl}\n${copy.manage}: ${params.manageUrl}`,
    to: params.recipient,
  });
  return true;
}

export async function sendOwnerAccessInvitationForSubmission(params: {
  locale: "en" | "it";
  submissionId: string;
}) {
  const access = await ensureOwnerAccessForPublishedSubmission({ submissionId: params.submissionId });
  if (!access) return null;

  const business = await prisma.business.findUnique({
    where: { id: access.businessId },
    select: { name: true, slug: true },
  });
  if (!business) return null;

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: params.submissionId },
    select: { ownerName: true },
  });

  const invitation = await getOrCreateOwnerAccessDeliveryInvitation({ accessId: access.id });
  const appUrl = getAppUrl();
  return {
    businessName: business.name,
    manageUrl: getOwnerAccessUrl(invitation.token, appUrl),
    ownerName: submission?.ownerName ?? "",
    recipient: access.email,
    viewUrl: `${appUrl}/businesses/${encodeURIComponent(business.slug)}`,
  };
}

export function buildOwnerWhatsAppMessage(params: {
  businessName: string;
  locale: "en" | "it";
  manageUrl: string;
  ownerName: string;
  viewUrl: string;
}) {
  const firstName = params.ownerName.trim().split(/\s+/)[0] || "";
  if (params.locale === "it") {
    return `Ciao${firstName ? ` ${firstName}` : ""}!\n\nLa tua attività ${params.businessName} è ora pubblicata su Salento Local.\n\nVisualizza la tua attività:\n${params.viewUrl}\n\nCrea il tuo account per gestire e aggiornare la tua attività:\n${params.manageUrl}\n\nQuesto link di accesso è personale. Non condividerlo con altre persone.\n\nSalento Local`;
  }
  return `Hello${firstName ? ` ${firstName}` : ""}!\n\nYour business ${params.businessName} is now published on Salento Local.\n\nView your business:\n${params.viewUrl}\n\nCreate your account to manage and update your business:\n${params.manageUrl}\n\nThis access link is personal. Please do not share it with anyone else.\n\nSalento Local`;
}

export function getOwnerWhatsAppDeepLink(params: { message: string; phone: string }) {
  const phone = normalizePhoneNumber(params.phone);
  if (!phone) return null;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(params.message)}`;
}

/**
 * This is intentionally called only from a page that has already verified the
 * payment and publication state. It reuses the durable access and invitation
 * record, so refreshes and repeat WhatsApp taps never mint uncontrolled links.
 */
export async function getNoEmailOwnerWhatsAppHandoff(params: {
  appUrl?: string;
  locale: "en" | "it";
  submissionId: string;
}) {
  const submission = await prisma.businessSubmission.findUnique({
    where: { id: params.submissionId },
    select: {
      createdBusiness: { select: { name: true, slug: true } },
      ownerEmail: true,
      ownerHasNoEmail: true,
      ownerName: true,
      ownerPhone: true,
      paymentStatus: true,
      status: true,
    },
  });
  if (
    !submission ||
    submission.paymentStatus !== "PAID" ||
    submission.status !== "PUBLISHED" ||
    (!submission.ownerHasNoEmail && submission.ownerEmail.trim()) ||
    !submission.createdBusiness
  ) return null;

  const phone = normalizePhoneNumber(submission.ownerPhone);
  if (!phone) return null;
  const access = await ensureOwnerAccessForPublishedSubmission({ submissionId: params.submissionId });
  if (!access || access.userId || access.phone !== phone) return null;
  const invitation = await getOrCreateOwnerAccessDeliveryInvitation({ accessId: access.id });
  const appUrl = (params.appUrl || getAppUrl()).replace(/\/+$/, "");
  const viewUrl = `${appUrl}/businesses/${encodeURIComponent(submission.createdBusiness.slug)}`;
  const manageUrl = getOwnerAccessUrl(invitation.token, appUrl);
  const message = buildOwnerWhatsAppMessage({
    businessName: submission.createdBusiness.name,
    locale: params.locale,
    manageUrl,
    ownerName: submission.ownerName,
    viewUrl,
  });
  const href = getOwnerWhatsAppDeepLink({ message, phone });
  return href ? { href, phone } : null;
}
