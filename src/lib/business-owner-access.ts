import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { hasResendConfiguration, sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { hasSmtpConfiguration } from "@/lib/claim-delivery";
import { normalizeEmail } from "@/lib/validation";

type OwnerAccessDb = PrismaClient | Prisma.TransactionClient;

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return randomBytes(32).toString("base64url");
}

export function getOwnerAccessInvitationExpiry(now = new Date()) {
  return new Date(now.getTime() + invitationLifetimeMs);
}

export function getOwnerAccessUrl(token: string, appUrl = getAppUrl()) {
  return `${appUrl.replace(/\/+$/, "")}/owner-access/${encodeURIComponent(token)}`;
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
    },
  });

  if (
    !submission?.createdBusinessId ||
    submission.ownerHasNoEmail ||
    !submission.ownerEmail.trim()
  ) {
    return null;
  }

  const email = normalizeEmail(submission.ownerEmail);
  const ownerUser = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  const existing = await db.businessOwnerAccess.findFirst({
    where: {
      OR: [
        { sourceSubmissionId: submission.id },
        { AND: [{ businessId: submission.createdBusinessId }, { email }] },
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
    select: { businessId: true, email: true, id: true, userId: true },
  });

  if (!access) return null;

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { email: true, id: true },
  });

  if (!user || normalizeEmail(user.email) !== access.email) {
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

export async function resolveOwnerAccessInvitation(token: string, db: OwnerAccessDb = prisma) {
  if (!token || token.length < 20) return { status: "invalid" as const, invitation: null };

  const invitation = await db.businessOwnerAccessInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      businessOwnerAccess: {
        include: {
          business: { select: { name: true, slug: true } },
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

  const invitation = await createOwnerAccessInvitation({ accessId: access.id });
  const appUrl = getAppUrl();
  return {
    businessName: business.name,
    manageUrl: getOwnerAccessUrl(invitation.token, appUrl),
    recipient: access.email,
    viewUrl: `${appUrl}/businesses/${encodeURIComponent(business.slug)}`,
  };
}
