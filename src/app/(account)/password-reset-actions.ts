"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getPasswordResetUrl, issuePasswordResetToken, resolvePasswordResetToken, sendPasswordResetEmail } from "@/lib/password-reset";
import { findUserByNormalizedEmail } from "@/lib/business-owner-access";
import { prisma } from "@/lib/prisma";
import { consumeSecurityRateLimit, getRequestClientAddress } from "@/lib/security-rate-limit";
import { getStringValue, normalizeEmail } from "@/lib/validation";
import { isStrongPassword } from "@/lib/password-rules";

export type PasswordResetFormState = { error?: string; notice?: string };

function localeOf(formData: FormData) {
  return getStringValue(formData.get("locale")) === "en" ? "en" as const : "it" as const;
}

export async function requestPasswordResetAction(_state: PasswordResetFormState, formData: FormData): Promise<PasswordResetFormState> {
  const locale = localeOf(formData);
  const email = normalizeEmail(getStringValue(formData.get("email")));
  const notice = locale === "it" ? "Se esiste un account con questa email, ti abbiamo inviato un link per reimpostare la password." : "If an account exists for this email, we have sent a password-reset link.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return { notice };
  const requestHeaders = await headers();
  const limit = await consumeSecurityRateLimit({ clientAddress: getRequestClientAddress(requestHeaders), limit: 3, namespace: "password-reset", subject: email, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return { notice };
  const account = await findUserByNormalizedEmail({ email });
  const user = account
    ? await prisma.user.findUnique({ where: { id: account.id }, select: { email: true, id: true, passwordHash: true } })
    : null;
  if (user?.passwordHash && user.email) {
    try {
      const token = await issuePasswordResetToken(user.id);
      await sendPasswordResetEmail({ locale, recipient: user.email, resetUrl: getPasswordResetUrl(token) });
    } catch (error) {
      console.error("[password-reset] email failed", error);
    }
  }
  return { notice };
}

export async function resetPasswordAction(_state: PasswordResetFormState, formData: FormData): Promise<PasswordResetFormState> {
  const locale = localeOf(formData);
  const token = getStringValue(formData.get("token"));
  const password = getStringValue(formData.get("password"));
  const confirmation = getStringValue(formData.get("confirmPassword"));
  if (!isStrongPassword(password) || confirmation !== password) {
    return { error: locale === "it" ? "Controlla la password e la conferma." : "Check the password and confirmation." };
  }
  const record = await resolvePasswordResetToken(token);
  if (!record) return { error: locale === "it" ? "Questo link non è valido o è scaduto." : "This link is invalid or has expired." };
  await prisma.$transaction(async (tx) => {
    const current = await tx.passwordResetToken.findUnique({ where: { id: record.id }, select: { expiresAt: true, revokedAt: true, usedAt: true } });
    if (!current || current.expiresAt <= new Date() || current.revokedAt || current.usedAt) throw new Error("password_reset_unavailable");
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: await bcrypt.hash(password, 12), sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.updateMany({ where: { userId: record.userId, id: { not: record.id }, revokedAt: null, usedAt: null }, data: { revokedAt: new Date() } });
  });
  redirect(`/login?reset=${locale === "it" ? "password-aggiornata" : "password-updated"}`);
}
