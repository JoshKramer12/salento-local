"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { canUsePrimaryAdminUsername } from "@/lib/admin";
import { signIn } from "@/lib/auth";
import { requireViewer } from "@/lib/auth-guards";
import {
  attachOwnerAccessToUser,
  createOwnerAccessInvitation,
  getOwnerAccessUrl,
  markOwnerAccessInvitationUsed,
  resolveOwnerAccessInvitation,
  sendOwnerAccessEmail,
} from "@/lib/business-owner-access";
import type { Locale } from "@/lib/i18n";
import { recordCurrentLegalAcceptances } from "@/lib/legal-consent";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/payment";
import { getRequestClientAddress, consumeSecurityRateLimit } from "@/lib/security-rate-limit";
import { getStringValue, normalizeEmail, normalizeUsername, signupSchema } from "@/lib/validation";

export type OwnerAccessFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  notice?: string;
};

function getLocale(formData: FormData): Locale {
  return getStringValue(formData.get("locale")) === "en" ? "en" : "it";
}

function copy(locale: Locale) {
  return locale === "it"
    ? {
        accountExists: "Esiste già un account per questa email. Accedi per continuare.",
        invalid: "Controlla i dati e riprova.",
        passwordMismatch: "Le password non coincidono.",
        terms: "Leggi e accetta i Termini e Condizioni per le Attività Commerciali.",
        wrongAccount: "Questo link è associato a un'altra email. Accedi con l'account corretto.",
      }
    : {
        accountExists: "An account already exists for this email. Log in to continue.",
        invalid: "Please check the details and try again.",
        passwordMismatch: "The passwords do not match.",
        terms: "Please read and accept the Business Terms & Conditions.",
        wrongAccount: "This link belongs to a different email. Log in with the correct account.",
      };
}

export async function activateOwnerAccessForCurrentUserAction(formData: FormData) {
  const token = getStringValue(formData.get("token"));
  const locale = getLocale(formData);
  const viewer = await requireViewer();
  const resolved = await resolveOwnerAccessInvitation(token);

  if (resolved.status !== "active" || !resolved.invitation) {
    redirect(`/owner-access/${encodeURIComponent(token)}`);
  }

  if (normalizeEmail(viewer.email) !== resolved.invitation.businessOwnerAccess.email) {
    redirect(`/owner-access/${encodeURIComponent(token)}?error=${encodeURIComponent(copy(locale).wrongAccount)}`);
  }

  const businessSlug = resolved.invitation.businessOwnerAccess.business.slug;
  await prisma.$transaction(async (tx) => {
    const attached = await attachOwnerAccessToUser({
      accessId: resolved.invitation!.businessOwnerAccessId,
      db: tx,
      userId: viewer.id,
    });
    if (!attached) throw new Error("owner_access_attachment_failed");
    await markOwnerAccessInvitationUsed({ db: tx, invitationId: resolved.invitation!.id });
  });

  redirect(`/businesses/${encodeURIComponent(businessSlug)}/edit`);
}

export async function createOwnerAccountFromInvitationAction(
  _previousState: OwnerAccessFormState,
  formData: FormData,
): Promise<OwnerAccessFormState> {
  const locale = getLocale(formData);
  const token = getStringValue(formData.get("token"));
  const username = normalizeUsername(getStringValue(formData.get("username")));
  const password = getStringValue(formData.get("password"));
  const confirmation = getStringValue(formData.get("confirmPassword"));
  const termsAccepted = getStringValue(formData.get("businessTermsAccepted")) === "on";
  const resolved = await resolveOwnerAccessInvitation(token);

  if (resolved.status !== "active" || !resolved.invitation) {
    return { error: locale === "it" ? "Questo link non è più valido. Richiedine uno nuovo." : "This link is no longer valid. Request a new one." };
  }

  const parsed = signupSchema.safeParse({
    email: resolved.invitation.businessOwnerAccess.email,
    password,
    username,
  });
  if (!parsed.success || !termsAccepted || confirmation !== password) {
    const messages = copy(locale);
    return {
      error: !termsAccepted ? messages.terms : confirmation !== password ? messages.passwordMismatch : messages.invalid,
      fieldErrors: {
        ...(parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), messages.invalid]))),
        ...(!termsAccepted ? { businessTermsAccepted: messages.terms } : {}),
        ...(confirmation !== password ? { confirmPassword: messages.passwordMismatch } : {}),
      },
    };
  }

  const requestHeaders = await headers();
  const limit = await consumeSecurityRateLimit({
    clientAddress: getRequestClientAddress(requestHeaders),
    limit: 5,
    namespace: "owner-account-activation",
    subject: parsed.data.email,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return { error: copy(locale).invalid };

  if (!canUsePrimaryAdminUsername(null, parsed.data.username)) {
    return { error: copy(locale).invalid, fieldErrors: { username: copy(locale).invalid } };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  let businessSlug = resolved.invitation.businessOwnerAccess.business.slug;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await resolveOwnerAccessInvitation(token, tx);
      if (current.status !== "active" || !current.invitation) throw new Error("owner_access_invitation_unavailable");

      const duplicate = await tx.user.findFirst({
        where: { OR: [{ email: parsed.data.email }, { username: parsed.data.username }] },
        select: { email: true, username: true },
      });
      if (duplicate?.email === parsed.data.email) throw new Error("owner_account_exists");
      if (duplicate?.username === parsed.data.username) throw new Error("owner_username_exists");

      const user = await tx.user.create({
        data: {
          email: parsed.data.email,
          emailVerified: new Date(),
          passwordHash,
          profileCompleted: true,
          role: "BUSINESS_OWNER",
          username: parsed.data.username,
        },
      });
      const attached = await attachOwnerAccessToUser({
        accessId: current.invitation.businessOwnerAccessId,
        db: tx,
        userId: user.id,
      });
      if (!attached) throw new Error("owner_access_attachment_failed");
      await markOwnerAccessInvitationUsed({ db: tx, invitationId: current.invitation.id });
      await recordCurrentLegalAcceptances({
        acceptanceContext: "BUSINESS_SIGNUP",
        audience: "business",
        db: tx,
        locale,
        userId: user.id,
      });
      businessSlug = current.invitation.businessOwnerAccess.business.slug;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "owner_account_exists") return { error: copy(locale).accountExists };
    if (message === "owner_username_exists") return { error: copy(locale).invalid, fieldErrors: { username: copy(locale).invalid } };
    return { error: copy(locale).invalid };
  }

  try {
    await signIn("credentials", {
      identifier: parsed.data.email,
      password,
      redirectTo: `/businesses/${encodeURIComponent(businessSlug)}/edit`,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: copy(locale).invalid };
    throw error;
  }

  return {};
}

export async function requestOwnerAccessAction(
  _previousState: OwnerAccessFormState,
  formData: FormData,
): Promise<OwnerAccessFormState> {
  const locale = getLocale(formData);
  const email = normalizeEmail(getStringValue(formData.get("email")));
  const genericNotice = locale === "it"
    ? "Se questa email è associata a un'attività Salento Local, ti abbiamo inviato i prossimi passaggi."
    : "If this email is associated with a Salento Local business, we have sent the next steps.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return { notice: genericNotice };

  const requestHeaders = await headers();
  const limit = await consumeSecurityRateLimit({
    clientAddress: getRequestClientAddress(requestHeaders),
    limit: 3,
    namespace: "owner-access-recovery",
    subject: email,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return { notice: genericNotice };

  const accesses = await prisma.businessOwnerAccess.findMany({
    where: { email },
    include: { business: { select: { name: true, slug: true } } },
    take: 10,
  });

  for (const access of accesses) {
    try {
      const invitation = await createOwnerAccessInvitation({ accessId: access.id });
      await sendOwnerAccessEmail({
        businessName: access.business.name,
        locale,
        manageUrl: getOwnerAccessUrl(invitation.token),
        recipient: access.email,
        viewUrl: `${getAppUrl()}/businesses/${encodeURIComponent(access.business.slug)}`,
      });
    } catch (error) {
      console.error("[owner-access] recovery email failed", error);
    }
  }

  return { notice: genericNotice };
}
