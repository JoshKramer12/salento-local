"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/(account)/auth-actions";
import { canUsePrimaryAdminUsername } from "@/lib/admin";
import { signIn } from "@/lib/auth";
import { requireViewer } from "@/lib/auth-guards";
import {
  attachOwnerAccessToUser,
  createOwnerAccessInvitation,
  findUserByNormalizedEmail,
  findUserByNormalizedPhone,
  getOwnerAccessUrl,
  markOwnerAccessInvitationUsed,
  resolveOwnerAccessInvitation,
  sendOwnerAccessEmail,
} from "@/lib/business-owner-access";
import type { Locale } from "@/lib/i18n";
import { recordCurrentLegalAcceptances } from "@/lib/legal-consent";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/payment";
import {
  openOwnerAccessSignupHandoff,
  sealOwnerAccessSignupHandoff,
  validateOwnerAccessSignupEntry,
  type OwnerAccessSignupEntry,
} from "@/lib/owner-access-signup-flow";
import { getRequestClientAddress, consumeSecurityRateLimit } from "@/lib/security-rate-limit";
import {
  getStringValue,
  localPartnerOnboardingSchema,
  normalizeEmail,
  normalizePhoneNumber,
  normalizeUsername,
} from "@/lib/validation";

export type OwnerAccessFormState = FormState;

const ownerAccessSignupHandoffCookie = "salento-local-owner-access-signup";
const ownerAccessSignupHandoffMaxAge = 15 * 60;

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
        phoneExists: "Esiste già un account per questo numero. Accedi per continuare.",
      }
    : {
        accountExists: "An account already exists for this email. Log in to continue.",
        invalid: "Please check the details and try again.",
        passwordMismatch: "The passwords do not match.",
        terms: "Please read and accept the Business Terms & Conditions.",
        wrongAccount: "This link belongs to a different email. Log in with the correct account.",
        phoneExists: "An account already exists for this phone number. Log in to continue.",
      };
}

function getOwnerAccessSignupHandoffSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  return secret?.trim() || null;
}

export async function getPendingOwnerAccessSignupForPage(token: string): Promise<OwnerAccessSignupEntry | null> {
  const secret = getOwnerAccessSignupHandoffSecret();
  if (!secret) return null;

  const value = (await cookies()).get(ownerAccessSignupHandoffCookie)?.value;
  const entry = value ? openOwnerAccessSignupHandoff(value, secret) : null;
  return entry?.token === token ? entry : null;
}

async function storePendingOwnerAccessSignup(entry: OwnerAccessSignupEntry) {
  const secret = getOwnerAccessSignupHandoffSecret();
  if (!secret) throw new Error("Owner access signup handoff is not configured.");

  (await cookies()).set(ownerAccessSignupHandoffCookie, sealOwnerAccessSignupHandoff(entry, secret), {
    httpOnly: true,
    maxAge: ownerAccessSignupHandoffMaxAge,
    path: "/owner-access",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function clearPendingOwnerAccessSignup() {
  (await cookies()).delete({ name: ownerAccessSignupHandoffCookie, path: "/owner-access" });
}

function ownerSignupValues(params: {
  businessTermsAccepted: boolean;
  email: string;
  firstName: string;
  lastName: string;
  username: string;
}) {
  return { ...params, partnerTermsAccepted: false };
}

function entryError(locale: Locale, fields: string[], validation: { passwordMismatch: boolean; termsMissing: boolean }) {
  const messages = copy(locale);
  const fieldErrors = Object.fromEntries(fields.map((field) => [
    field,
    field === "businessTermsAccepted"
      ? messages.terms
      : field === "confirmPassword"
        ? messages.passwordMismatch
        : messages.invalid,
  ]));
  return {
    error: validation.termsMissing && fields.length === 1
      ? messages.terms
      : validation.passwordMismatch && fields.length === 1
        ? messages.passwordMismatch
        : messages.invalid,
    fieldErrors,
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

  const access = resolved.invitation.businessOwnerAccess;
  const identityMatches = access.email
    ? Boolean(viewer.email && normalizeEmail(viewer.email) === access.email)
    : Boolean(access.phone && viewer.phone === access.phone);
  if (!identityMatches) {
    redirect(`/owner-access/${encodeURIComponent(token)}?error=${encodeURIComponent(copy(locale).wrongAccount)}`);
  }

  await prisma.$transaction(async (tx) => {
    const attached = await attachOwnerAccessToUser({
      accessId: resolved.invitation!.businessOwnerAccessId,
      db: tx,
      userId: viewer.id,
    });
    if (!attached) throw new Error("owner_access_attachment_failed");
    await markOwnerAccessInvitationUsed({ db: tx, invitationId: resolved.invitation!.id });
  });

  redirect("/dashboard");
}

export async function beginOwnerAccountActivationAction(
  _previousState: OwnerAccessFormState,
  formData: FormData,
): Promise<OwnerAccessFormState> {
  const locale = getLocale(formData);
  const token = getStringValue(formData.get("token"));
  const username = normalizeUsername(getStringValue(formData.get("username")));
  const firstName = getStringValue(formData.get("firstName"));
  const lastName = getStringValue(formData.get("lastName"));
  const submittedEmail = normalizeEmail(getStringValue(formData.get("email")));
  const password = getStringValue(formData.get("password"));
  const confirmation = getStringValue(formData.get("confirmPassword"));
  const termsAccepted = getStringValue(formData.get("businessTermsAccepted")) === "on";
  const resolved = await resolveOwnerAccessInvitation(token);

  if (resolved.status !== "active" || !resolved.invitation) {
    return { error: locale === "it" ? "Questo link non è più valido. Richiedine uno nuovo." : "This link is no longer valid. Request a new one." };
  }

  const access = resolved.invitation.businessOwnerAccess;
  const email = access.email ?? submittedEmail;
  const signupValues = ownerSignupValues({ businessTermsAccepted: termsAccepted, email, firstName, lastName, username });
  const validation = validateOwnerAccessSignupEntry({
    businessTermsAccepted: termsAccepted,
    confirmPassword: confirmation,
    email,
    emailRequired: Boolean(access.email),
    firstName,
    lastName,
    locale,
    password,
    token,
    username,
  });
  if (!validation.entry) return { ...entryError(locale, validation.fields, validation), signupValues };

  const requestHeaders = await headers();
  const limit = await consumeSecurityRateLimit({
    clientAddress: getRequestClientAddress(requestHeaders),
    limit: 5,
    namespace: "owner-account-activation",
    subject: access.email ?? access.phone ?? "owner-access",
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return { error: copy(locale).invalid };

  if (!canUsePrimaryAdminUsername(null, validation.entry.username)) {
    return { error: copy(locale).invalid, fieldErrors: { username: copy(locale).invalid }, signupValues };
  }

  const existingEmail = validation.entry.email
    ? await findUserByNormalizedEmail({ email: validation.entry.email })
    : null;
  if (existingEmail) return { error: copy(locale).accountExists, fieldErrors: { email: copy(locale).accountExists }, signupValues };
  if (access.phone && await findUserByNormalizedPhone({ phone: access.phone })) {
    return { error: copy(locale).phoneExists, signupValues };
  }
  if (await prisma.user.findUnique({ where: { username: validation.entry.username }, select: { id: true } })) {
    return { error: copy(locale).invalid, fieldErrors: { username: copy(locale).invalid }, signupValues };
  }

  await storePendingOwnerAccessSignup(validation.entry);
  redirect(`/owner-access/${encodeURIComponent(token)}/details`);

  return {};
}

export async function completeOwnerAccountFromInvitationAction(
  _previousState: OwnerAccessFormState,
  formData: FormData,
): Promise<OwnerAccessFormState> {
  const locale = getLocale(formData);
  const token = getStringValue(formData.get("token"));
  const entry = await getPendingOwnerAccessSignupForPage(token);
  if (!entry) return { error: locale === "it" ? "I dati di registrazione sono scaduti. Ricomincia dal link di accesso." : "Your signup details expired. Start again from the access link." };

  const resolved = await resolveOwnerAccessInvitation(token);
  if (resolved.status !== "active" || !resolved.invitation) return { error: locale === "it" ? "Questo link non è più valido. Richiedine uno nuovo." : "This link is no longer valid. Request a new one." };
  const access = resolved.invitation.businessOwnerAccess;
  const entryValidation = validateOwnerAccessSignupEntry({ ...entry, confirmPassword: entry.password, email: access.email ?? entry.email, emailRequired: Boolean(access.email) });
  if (!entryValidation.entry) {
    await clearPendingOwnerAccessSignup();
    return { error: locale === "it" ? "I dati di registrazione sono scaduti. Ricomincia dal link di accesso." : "Your signup details expired. Start again from the access link." };
  }
  const signupEntry = entryValidation.entry;
  const parsed = localPartnerOnboardingSchema.safeParse({
    baseTownOrArea: getStringValue(formData.get("baseTownOrArea")),
    birthDate: getStringValue(formData.get("birthDate")),
    heardAbout: getStringValue(formData.get("heardAbout")),
    heardAboutOther: getStringValue(formData.get("heardAboutOther")),
    phone: getStringValue(formData.get("phone")),
    whatsapp: getStringValue(formData.get("whatsapp")),
  });
  if (!parsed.success) return { error: copy(locale).invalid, fieldErrors: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "form"), copy(locale).invalid])) };
  const hometownTownId = getStringValue(formData.get("hometownTownId")).trim();
  const hometown = hometownTownId ? await prisma.town.findUnique({ where: { id: hometownTownId }, select: { name: true } }) : null;
  if (!hometown) return { error: copy(locale).invalid, fieldErrors: { baseTownOrArea: copy(locale).invalid } };
  if (parsed.data.heardAbout === "other" && !parsed.data.heardAboutOther?.trim()) return { error: copy(locale).invalid, fieldErrors: { heardAbout: copy(locale).invalid } };
  const finalPhone = access.phone ?? normalizePhoneNumber(parsed.data.phone);
  if (!finalPhone) return { error: copy(locale).invalid, fieldErrors: { phone: copy(locale).invalid } };
  const heardAbout = parsed.data.heardAbout === "other" ? `other:${parsed.data.heardAboutOther?.trim() || ""}` : parsed.data.heardAbout;
  const passwordHash = await bcrypt.hash(signupEntry.password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      const current = await resolveOwnerAccessInvitation(token, tx);
      if (current.status !== "active" || !current.invitation) throw new Error("owner_access_invitation_unavailable");
      const currentAccess = current.invitation.businessOwnerAccess;
      if (currentAccess.userId) throw new Error("owner_account_exists");
      if (signupEntry.email && await findUserByNormalizedEmail({ db: tx, email: signupEntry.email })) throw new Error("owner_account_exists");
      if (await findUserByNormalizedPhone({ db: tx, phone: finalPhone })) throw new Error("owner_phone_exists");
      if (await tx.user.findUnique({ where: { username: signupEntry.username }, select: { id: true } })) throw new Error("owner_username_exists");
      const user = await tx.user.create({ data: {
        email: signupEntry.email || null,
        ...(currentAccess.email ? { emailVerified: new Date() } : {}),
        name: `${signupEntry.firstName} ${signupEntry.lastName}`.trim(),
        passwordHash,
        phone: finalPhone,
        profileCompleted: true,
        role: "BUSINESS_OWNER",
        username: signupEntry.username,
      } });
      const attached = await attachOwnerAccessToUser({ accessId: current.invitation.businessOwnerAccessId, db: tx, userId: user.id });
      if (!attached) throw new Error("owner_access_attachment_failed");
      await markOwnerAccessInvitationUsed({ db: tx, invitationId: current.invitation.id });
      await recordCurrentLegalAcceptances({ acceptanceContext: "BUSINESS_SIGNUP", audience: "business", db: tx, locale: signupEntry.locale, userId: user.id });
      // The remaining onboarding fields are validated here for flow parity; the owner profile has no separate persistence model.
      void hometown.name;
      void heardAbout;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "owner_account_exists") return { error: copy(locale).accountExists, fieldErrors: { email: copy(locale).accountExists } };
    if (message === "owner_phone_exists") return { error: copy(locale).phoneExists, fieldErrors: { phone: copy(locale).phoneExists } };
    if (message === "owner_username_exists") return { error: copy(locale).invalid, fieldErrors: { username: copy(locale).invalid } };
    return { error: copy(locale).invalid };
  }
  await clearPendingOwnerAccessSignup();
  try {
    await signIn("credentials", { identifier: signupEntry.email || finalPhone, password: signupEntry.password, redirectTo: "/dashboard" });
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
        recipient: access.email!,
        viewUrl: `${getAppUrl()}/businesses/${encodeURIComponent(access.business.slug)}`,
      });
    } catch (error) {
      console.error("[owner-access] recovery email failed", error);
    }
  }

  return { notice: genericNotice };
}
