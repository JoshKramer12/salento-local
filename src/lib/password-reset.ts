import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { hasTransactionalEmailDelivery } from "@/lib/claim-delivery";
import { sendTransactionalEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

const resetLifetimeMs = 60 * 60 * 1000;
type PasswordResetReadDb = PrismaClient | Prisma.TransactionClient;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getPasswordResetUrl(token: string) {
  return `${getAppUrl()}/reset-password/${encodeURIComponent(token)}`;
}

export function getPasswordResetExpiry(now = new Date()) {
  return new Date(now.getTime() + resetLifetimeMs);
}

export async function issuePasswordResetToken(
  userId: string,
  options: { db?: PrismaClient; now?: Date } = {},
) {
  const db = options.db ?? prisma;
  const token = randomBytes(32).toString("base64url");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId, revokedAt: null, usedAt: null },
      data: { revokedAt: now },
    });
    await tx.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: getPasswordResetExpiry(now),
      },
    });
  });
  return token;
}

export async function resolvePasswordResetToken(token: string, db: PasswordResetReadDb = prisma) {
  if (!token || token.length < 20) return null;
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { email: true, id: true } } },
  });
  if (!record || record.usedAt || record.revokedAt || record.expiresAt <= new Date()) return null;
  return record;
}

export async function sendPasswordResetEmail(params: {
  locale: "en" | "it";
  recipient: string;
  resetUrl: string;
}) {
  if (!hasTransactionalEmailDelivery()) {
    if (process.env.NODE_ENV !== "production") console.warn("[password-reset] transactional email is not configured.");
    return false;
  }
  const copy = params.locale === "it"
    ? { body: "Abbiamo ricevuto una richiesta per reimpostare la password del tuo account Salento Local.", button: "Reimposta password", subject: "Reimposta la password Salento Local" }
    : { body: "We received a request to reset the password for your Salento Local account.", button: "Reset password", subject: "Reset your Salento Local password" };
  await sendTransactionalEmail({
    headers: { "X-Transactional-Message": "password-reset" },
    html: `<div style="font-family:Arial,sans-serif;color:#243b34;line-height:1.55"><p>${copy.body}</p><p><a href="${params.resetUrl}" style="display:inline-block;background:#2a6257;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">${copy.button}</a></p><p style="color:#64736d;font-size:14px">${params.locale === "it" ? "Il link scade tra un'ora. Se non hai fatto tu la richiesta, ignora questa email." : "This link expires in one hour. If you did not request it, you can ignore this email."}</p></div>`,
    subject: copy.subject,
    text: `${copy.body}\n${copy.button}: ${params.resetUrl}`,
    to: params.recipient,
  });
  return true;
}
