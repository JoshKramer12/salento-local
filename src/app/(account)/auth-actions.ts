"use server";

import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  canUsePrimaryAdminUsername,
} from "@/lib/admin";
import { signIn, signOut } from "@/lib/auth";
import { requireViewer } from "@/lib/auth-guards";
import type { Locale } from "@/lib/i18n";
import { recordCurrentLegalAcceptances } from "@/lib/legal-consent";
import {
  createCompletePartnerSignup,
  openPartnerSignupHandoff,
  sealPartnerSignupHandoff,
  validatePartnerSignupEntry,
  type PartnerSignupEntry,
} from "@/lib/partner-signup-flow";
import { prisma } from "@/lib/prisma";
import { getSafeInternalRedirect } from "@/lib/redirects";
import {
  consumeSecurityRateLimit,
  getRequestClientAddress,
} from "@/lib/security-rate-limit";
import {
  type BirthdayValidationError,
  completeProfileSchema,
  getStringValue,
  loginSchema,
  localPartnerOnboardingSchema,
  normalizeEmail,
  normalizeUsername,
  signupSchema,
} from "@/lib/validation";
import {
  getBirthdayValidationMessage,
} from "@/lib/signup-validation-messages";

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  invalidFields?: string[];
  notice?: string;
  signupValues?: {
    baseTownOrArea?: string;
    businessTermsAccepted: boolean;
    birthDate?: string;
    confirmPassword?: string;
    email: string;
    firstName?: string;
    heardAbout?: string;
    heardAboutOther?: string;
    hometownTownId?: string;
    lastName?: string;
    partnerPhone?: string;
    partnerTermsAccepted: boolean;
    password?: string;
    username: string;
    whatsapp?: string;
  };
};

const formCopy = {
  en: {
    duplicateEmail: "That email is already being used.",
    duplicateUsername: "That username is already taken.",
    invalidEmail: "Please enter a valid email address.",
    invalidEmailOrPassword: "The email address or password is incorrect.",
    invalidCredentials: "Invalid email, username, or password.",
    invalidForm: "Please check the highlighted fields and try again.",
    invalidSession: "Please log in again to continue.",
    missingIdentifier: "Please enter your email address or username.",
    missingPassword: "Please enter your password.",
    missingBusinessTerms:
      "Please read and accept the Salento Local Business Terms & Conditions.",
    missingPartnerTerms:
      "Please read and accept the Salento Local Partner Terms & Conditions.",
    passwordRule:
      "Use at least 8 characters, including 1 uppercase letter, 1 number, and 1 special character.",
    passwordMismatch: "The passwords do not match.",
    reservedAdminUsername: "That username is reserved.",
    signupExpired: "Your signup details expired. Please start again.",
    unknownTown: "Please choose a valid town.",
    usernameRule:
      "Use 3 to 30 lowercase letters, numbers, dots, dashes, or underscores.",
  },
  it: {
    duplicateEmail: "Questa email e gia in uso.",
    duplicateUsername: "Questo username e gia occupato.",
    invalidEmail: "Inserisci un indirizzo email valido.",
    invalidEmailOrPassword: "L'indirizzo email o la password non sono corretti.",
    invalidCredentials: "Email, username o password non validi.",
    invalidForm: "Controlla i campi evidenziati e riprova.",
    invalidSession: "Accedi di nuovo per continuare.",
    missingIdentifier: "Inserisci il tuo indirizzo email o username.",
    missingPassword: "Inserisci la password.",
    missingBusinessTerms:
      "Leggi e accetta i Termini e Condizioni per le Attivita Commerciali di Salento Local.",
    missingPartnerTerms:
      "Leggi e accetta i Termini e Condizioni del Programma Partner di Salento Local.",
    passwordRule:
      "Usa almeno 8 caratteri, con 1 lettera maiuscola, 1 numero e 1 carattere speciale.",
    passwordMismatch: "Le password non coincidono.",
    reservedAdminUsername: "Questo username e riservato.",
    signupExpired: "I dati di registrazione sono scaduti. Ricomincia la registrazione.",
    unknownTown: "Seleziona un comune valido.",
    usernameRule:
      "Usa da 3 a 30 caratteri minuscoli: lettere, numeri, punti, trattini o underscore.",
  },
} satisfies Record<Locale, Record<string, string>>;

const partnerSignupHandoffCookie = "salento-local-partner-signup";
const partnerSignupHandoffMaxAge = 15 * 60;

function getLocaleFromForm(formData: FormData): Locale {
  return getStringValue(formData.get("locale")) === "en" ? "en" : "it";
}

function getPartnerSignupHandoffSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  return secret?.trim() || null;
}

async function getPendingPartnerSignup(): Promise<PartnerSignupEntry | null> {
  const secret = getPartnerSignupHandoffSecret();
  if (!secret) return null;

  const cookieStore = await cookies();
  const value = cookieStore.get(partnerSignupHandoffCookie)?.value;
  return value ? openPartnerSignupHandoff(value, secret) : null;
}

async function storePendingPartnerSignup(entry: PartnerSignupEntry) {
  const secret = getPartnerSignupHandoffSecret();
  if (!secret) {
    throw new Error("Partner signup handoff is not configured.");
  }

  const cookieStore = await cookies();
  cookieStore.set(partnerSignupHandoffCookie, sealPartnerSignupHandoff(entry, secret), {
    httpOnly: true,
    maxAge: partnerSignupHandoffMaxAge,
    path: "/partner/join",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

async function clearPendingPartnerSignup() {
  const cookieStore = await cookies();
  cookieStore.set(partnerSignupHandoffCookie, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/partner/join",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function getPendingPartnerSignupForPage() {
  const entry = await getPendingPartnerSignup();
  if (!entry) return null;

  return {
    email: entry.email,
    firstName: entry.firstName,
    lastName: entry.lastName,
    partnerTermsAccepted: entry.partnerTermsAccepted,
    username: entry.username,
  };
}

function getBirthdayValidationError(
  issues: Array<{ message: string; path: PropertyKey[] }>,
): BirthdayValidationError | undefined {
  const message = issues.find((issue) => issue.path[0] === "birthDate")?.message;

  return message === "underage" || message === "invalid_birth_date"
    ? message
    : undefined;
}

function buildFieldErrors(
  fields: string[],
  locale: Locale,
  birthdayValidationError?: BirthdayValidationError,
) {
  const map: Record<string, string> = {
    baseTownOrArea: formCopy[locale].unknownTown,
    birthDate: getBirthdayValidationMessage(
      locale,
      birthdayValidationError ?? "invalid_birth_date",
    ),
    businessTermsAccepted: formCopy[locale].missingBusinessTerms,
    confirmPassword: formCopy[locale].passwordMismatch,
    email: formCopy[locale].invalidEmail,
    firstName: formCopy[locale].invalidForm,
    heardAbout: formCopy[locale].invalidForm,
    identifier: formCopy[locale].invalidForm,
    partnerTermsAccepted: formCopy[locale].missingPartnerTerms,
    password: formCopy[locale].passwordRule,
    phone: formCopy[locale].invalidForm,
    lastName: formCopy[locale].invalidForm,
    username: formCopy[locale].usernameRule,
    whatsapp: formCopy[locale].invalidForm,
  };

  return Object.fromEntries(
    fields.map((field) => [field, map[field] ?? formCopy[locale].invalidForm]),
  );
}

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function resolveRequestedAccountRole({
  requestedRole,
}: {
  requestedRole: string;
}) {
  if (requestedRole === "BUSINESS_OWNER") {
    return "BUSINESS_OWNER" as const;
  }

  if (requestedRole === "GETTER") {
    return "GETTER" as const;
  }

  return "USER" as const;
}

function buildPostAuthRedirect(role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER") {
  if (role === "GETTER") {
    return "/partner/start";
  }

  return "/dashboard";
}

function resolvePostAuthRedirect(
  role: "ADMIN" | "BUSINESS_OWNER" | "GETTER" | "USER",
  overrideValue: string,
) {
  return getSafeInternalRedirect(overrideValue) ?? buildPostAuthRedirect(role);
}

export async function loginAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const redirectTo = getSafeInternalRedirect(getStringValue(formData.get("redirectTo")));
  const rawIdentifier = getStringValue(formData.get("identifier"));
  const rawPassword = getStringValue(formData.get("password"));
  const emailLooksInvalid = looksLikeEmail(rawIdentifier) && !isValidEmail(rawIdentifier);
  const parsed = loginSchema.safeParse({
    identifier: rawIdentifier,
    password: rawPassword,
  });

  if (!rawIdentifier.trim()) {
    return {
      error: formCopy[locale].missingIdentifier,
      fieldErrors: { identifier: formCopy[locale].missingIdentifier },
    };
  }

  if (!rawPassword) {
    return {
      error: formCopy[locale].missingPassword,
      fieldErrors: { password: formCopy[locale].missingPassword },
    };
  }

  if (emailLooksInvalid) {
    return {
      error: formCopy[locale].invalidEmail,
      fieldErrors: { identifier: formCopy[locale].invalidEmail },
    };
  }

  if (!parsed.success) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(["identifier", "password"], locale),
    };
  }

  try {
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirectTo: redirectTo ?? "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: looksLikeEmail(parsed.data.identifier)
          ? formCopy[locale].invalidEmailOrPassword
          : formCopy[locale].invalidCredentials,
      };
    }

    throw error;
  }

  return {};
}

export async function partnerSignupAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const firstName = getStringValue(formData.get("firstName"));
  const lastName = getStringValue(formData.get("lastName"));
  const email = normalizeEmail(getStringValue(formData.get("email")));
  const rawUsername = getStringValue(formData.get("username"));
  const password = getStringValue(formData.get("password"));
  const confirmPassword = getStringValue(formData.get("confirmPassword"));
  const partnerTermsAccepted = getStringValue(formData.get("partnerTermsAccepted")) === "on";
  const redirectTo = getSafeInternalRedirect(getStringValue(formData.get("redirectTo")));
  const signupValues = {
    businessTermsAccepted: false,
    email,
    firstName,
    lastName,
    partnerTermsAccepted,
    username: rawUsername,
  };

  const validation = validatePartnerSignupEntry({
    email,
    firstName,
    lastName,
    locale,
    partnerTermsAccepted,
    password,
    confirmPassword,
    redirectTo,
    username: rawUsername,
  });

  if (!validation.entry) {
    return {
      error:
        validation.termsMissing && validation.fields.length === 1
          ? formCopy[locale].missingPartnerTerms
          : validation.passwordMismatch && validation.fields.length === 1
            ? formCopy[locale].passwordMismatch
            : formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(validation.fields, locale),
      signupValues,
    };
  }

  const requestHeaders = await headers();
  const clientAddress = getRequestClientAddress(requestHeaders);
  const signupLimit = await consumeSecurityRateLimit({
    clientAddress,
    limit: 5,
    namespace: "partner-signup",
    subject: validation.entry.email,
    windowMs: 60 * 60 * 1000,
  });

  if (!signupLimit.allowed) {
    return {
      error: formCopy[locale].invalidForm,
      signupValues,
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: validation.entry.email }, { username: validation.entry.username }],
    },
    select: { email: true, username: true },
  });

  if (existing?.email === validation.entry.email) {
    return {
      error: formCopy[locale].duplicateEmail,
      fieldErrors: { email: formCopy[locale].duplicateEmail },
      signupValues,
    };
  }

  if (existing?.username === validation.entry.username) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: { username: formCopy[locale].duplicateUsername },
      signupValues,
    };
  }

  if (!canUsePrimaryAdminUsername(null, validation.entry.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: { username: formCopy[locale].reservedAdminUsername },
      signupValues,
    };
  }

  await storePendingPartnerSignup(validation.entry);
  redirect("/partner/join/details");

  return {};
}

export async function completePartnerSignupAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const entry = await getPendingPartnerSignup();

  if (!entry) {
    return { error: formCopy[locale].signupExpired };
  }

  const entryValidation = validatePartnerSignupEntry({
    ...entry,
    confirmPassword: entry.password,
  });
  if (!entryValidation.entry) {
    await clearPendingPartnerSignup();
    return { error: formCopy[locale].signupExpired };
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

  if (!parsed.success) {
    const invalidFields = parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));
    const birthdayValidationError = getBirthdayValidationError(parsed.error.issues);
    return {
      error: birthdayValidationError
        ? getBirthdayValidationMessage(locale, birthdayValidationError)
        : formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(
        [...new Set(invalidFields)],
        locale,
        birthdayValidationError,
      ),
    };
  }

  const hometownTownId = getStringValue(formData.get("hometownTownId")).trim();
  const hometown = hometownTownId
    ? await prisma.town.findUnique({
        where: { id: hometownTownId },
        select: { name: true },
      })
    : null;

  if (!hometown) {
    return {
      error: formCopy[locale].unknownTown,
      fieldErrors: { baseTownOrArea: formCopy[locale].unknownTown },
    };
  }

  if (parsed.data.heardAbout === "other" && !parsed.data.heardAboutOther?.trim()) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: { heardAbout: formCopy[locale].invalidForm },
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: signupEntry.email },
        { username: signupEntry.username },
      ],
    },
    select: { email: true, username: true },
  });

  if (existing?.email === signupEntry.email) {
    return {
      error: formCopy[locale].duplicateEmail,
      fieldErrors: { email: formCopy[locale].duplicateEmail },
    };
  }

  if (existing?.username === signupEntry.username) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: { username: formCopy[locale].duplicateUsername },
    };
  }

  if (!canUsePrimaryAdminUsername(null, signupEntry.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: { username: formCopy[locale].reservedAdminUsername },
    };
  }

  const heardAbout =
    parsed.data.heardAbout === "other"
      ? `other:${parsed.data.heardAboutOther?.trim() || ""}`
      : parsed.data.heardAbout;
  const passwordHash = await bcrypt.hash(signupEntry.password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      await createCompletePartnerSignup(
        {
          baseTownOrArea: hometown.name,
          birthDate: parsed.data.birthDate,
          email: signupEntry.email,
          firstName: signupEntry.firstName,
          heardAbout,
          lastName: signupEntry.lastName,
          locale: signupEntry.locale,
          passwordHash,
          phone: parsed.data.phone,
          username: signupEntry.username,
          whatsapp: parsed.data.whatsapp,
        },
        {
          createProfile: (data) => tx.localPartnerProfile.create({ data }),
          createUser: (data) => tx.user.create({ data }),
          recordLegalAcceptance: (userId) =>
            recordCurrentLegalAcceptances({
              acceptanceContext: "PARTNER_SIGNUP",
              audience: "partner",
              db: tx,
              locale: signupEntry.locale,
              userId,
            }),
        },
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.user.findFirst({
        where: {
          OR: [
            { email: signupEntry.email },
            { username: signupEntry.username },
          ],
        },
        select: { email: true, username: true },
      });
      const duplicateField =
        duplicate?.email === signupEntry.email ? "email" : "username";
      const duplicateMessage =
        duplicateField === "email"
          ? formCopy[locale].duplicateEmail
          : formCopy[locale].duplicateUsername;
      return { error: duplicateMessage, fieldErrors: { [duplicateField]: duplicateMessage } };
    }

    throw error;
  }

  await clearPendingPartnerSignup();
  await signIn("credentials", {
    identifier: signupEntry.email,
    password: signupEntry.password,
    redirectTo: signupEntry.redirectTo ?? "/partner/start",
  });

  return {};
}

export async function deleteAccountAction(formData: FormData) {
  const viewer = await requireViewer();
  const confirmation = getStringValue(formData.get("confirmation"));

  if (confirmation !== "delete-account") {
    redirect("/settings?delete=confirmation-required");
  }

  await prisma.user.delete({
    where: { id: viewer.id },
  });

  await signOut({
    redirectTo: "/?accountDeleted=1",
  });
}

export async function signupAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const requestedRole = getStringValue(formData.get("accountType"));
  const redirectTo = getStringValue(formData.get("redirectTo"));
  const confirmPassword = getStringValue(formData.get("confirmPassword"));
  const rawPassword = getStringValue(formData.get("password"));
  const rawEmail = getStringValue(formData.get("email"));
  const rawUsername = getStringValue(formData.get("username"));
  const requestedUsername = normalizeUsername(rawUsername);
  const signupValues = {
    baseTownOrArea: getStringValue(formData.get("baseTownOrArea")),
    businessTermsAccepted: getStringValue(formData.get("businessTermsAccepted")) === "on",
    birthDate: getStringValue(formData.get("birthDate")),
    confirmPassword,
    email: rawEmail,
    heardAbout: getStringValue(formData.get("heardAbout")).trim(),
    heardAboutOther: getStringValue(formData.get("heardAboutOther")).trim(),
    hometownTownId: getStringValue(formData.get("hometownTownId")).trim(),
    partnerPhone: getStringValue(formData.get("phone")),
    partnerTermsAccepted: getStringValue(formData.get("partnerTermsAccepted")) === "on",
    password: rawPassword,
    username: rawUsername,
    whatsapp: getStringValue(formData.get("whatsapp")),
  };
  const parsed = signupSchema.safeParse({
    email: normalizeEmail(rawEmail),
    password: rawPassword,
    username: requestedUsername,
  });
  const requiresBusinessTerms = requestedRole === "BUSINESS_OWNER";
  const requiresPartnerTerms = requestedRole === "GETTER";
  const missingBusinessTerms = requiresBusinessTerms && !signupValues.businessTermsAccepted;
  const missingPartnerTerms = requiresPartnerTerms && !signupValues.partnerTermsAccepted;
  const passwordMismatch = confirmPassword !== rawPassword;
  const hometownTownId = signupValues.hometownTownId;
  const rawHeardAbout = signupValues.heardAbout;
  const rawHeardAboutOther = signupValues.heardAboutOther;
  const rawPartnerProfile = {
    baseTownOrArea: signupValues.baseTownOrArea,
    birthDate: signupValues.birthDate,
    heardAbout: rawHeardAbout,
    heardAboutOther: rawHeardAboutOther,
    phone: signupValues.partnerPhone,
    whatsapp: signupValues.whatsapp,
  };
  const parsedPartnerProfile =
    requestedRole === "GETTER"
      ? localPartnerOnboardingSchema.safeParse(rawPartnerProfile)
      : null;
  const hometown =
    requestedRole === "GETTER" && hometownTownId
      ? await prisma.town.findUnique({
          where: { id: hometownTownId },
          select: { name: true },
        })
      : null;
  const invalidPartnerTown =
    requestedRole === "GETTER" && (!hometownTownId || !hometown);
  const invalidHeardAboutOther =
    requestedRole === "GETTER" && rawHeardAbout === "other" && !rawHeardAboutOther;

  if (
    !parsed.success ||
    missingBusinessTerms ||
    missingPartnerTerms ||
    passwordMismatch ||
    (requestedRole === "GETTER" &&
      (!parsedPartnerProfile?.success || invalidPartnerTown || invalidHeardAboutOther))
  ) {
    const invalidFields = parsed.success
      ? []
      : parsed.error.issues.map((issue) => String(issue.path[0] ?? "form"));

    if (missingBusinessTerms) invalidFields.push("businessTermsAccepted");
    if (missingPartnerTerms) invalidFields.push("partnerTermsAccepted");
    if (passwordMismatch) invalidFields.push("confirmPassword");

    if (requestedRole === "GETTER") {
      if (parsedPartnerProfile && !parsedPartnerProfile.success) {
        invalidFields.push(
          ...parsedPartnerProfile.error.issues.map((issue) => String(issue.path[0] ?? "form")),
        );
      }

      if (invalidPartnerTown) invalidFields.push("baseTownOrArea");
      if (invalidHeardAboutOther) invalidFields.push("heardAbout");
    }

    const uniqueInvalidFields = [...new Set(invalidFields)];
    const birthdayValidationError =
      parsedPartnerProfile && !parsedPartnerProfile.success
        ? getBirthdayValidationError(parsedPartnerProfile.error.issues)
        : undefined;
    const hasInvalidBirthday = Boolean(birthdayValidationError);

    return {
      error:
        hasInvalidBirthday
          ? getBirthdayValidationMessage(
              locale,
              birthdayValidationError ?? "invalid_birth_date",
            )
          : missingBusinessTerms && uniqueInvalidFields.length === 1
          ? formCopy[locale].missingBusinessTerms
          : missingPartnerTerms && uniqueInvalidFields.length === 1
            ? formCopy[locale].missingPartnerTerms
            : passwordMismatch && uniqueInvalidFields.length === 1
              ? formCopy[locale].passwordMismatch
              : formCopy[locale].invalidForm,
      fieldErrors: buildFieldErrors(
        uniqueInvalidFields,
        locale,
        birthdayValidationError,
      ),
      signupValues,
    };
  }

  const requestHeaders = await headers();
  const clientAddress = getRequestClientAddress(requestHeaders);
  const signupLimit = await consumeSecurityRateLimit({
    clientAddress,
    limit: 5,
    namespace: "signup",
    subject: parsed.data.email,
    windowMs: 60 * 60 * 1000,
  });

  if (!signupLimit.allowed) {
    return {
      error: formCopy[locale].invalidForm,
      signupValues,
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: parsed.data.email }, { username: parsed.data.username }],
    },
    select: {
      email: true,
      username: true,
    },
  });

  if (existing?.email === parsed.data.email) {
    return {
      error: formCopy[locale].duplicateEmail,
      fieldErrors: {
        email: formCopy[locale].duplicateEmail,
      },
      signupValues,
    };
  }

  if (existing?.username === parsed.data.username) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: {
        username: formCopy[locale].duplicateUsername,
      },
      signupValues,
    };
  }

  if (!canUsePrimaryAdminUsername(null, parsed.data.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: {
        username: formCopy[locale].reservedAdminUsername,
      },
      signupValues,
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const role = resolveRequestedAccountRole({
    requestedRole,
  });

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: parsed.data.email,
        passwordHash,
        profileCompleted: true,
        role,
        username: parsed.data.username,
      },
    });

    if (role === "GETTER" && parsedPartnerProfile?.success && hometown) {
      const heardAboutValue =
        parsedPartnerProfile.data.heardAbout === "other"
          ? `other:${rawHeardAboutOther}`
          : parsedPartnerProfile.data.heardAbout;

      await tx.localPartnerProfile.create({
        data: {
          baseTownOrArea: hometown.name,
          billingAddress: "",
          birthDate: new Date(parsedPartnerProfile.data.birthDate),
          completedAt: new Date(),
          fullName: "",
          heardAbout: heardAboutValue,
          legalFullName: "",
          phone: parsedPartnerProfile.data.phone,
          preferredLanguage: locale,
          taxIdOrVatNumber: "",
          understandsDirectPayment: true,
          understandsNoCash: true,
          understandsNoNegotiation: true,
          understandsNoPricing: true,
          user: {
            connect: { id: user.id },
          },
          whatsapp: parsedPartnerProfile.data.whatsapp?.trim() || null,
        },
      });

      await recordCurrentLegalAcceptances({
        acceptanceContext: "PARTNER_SIGNUP",
        audience: "partner",
        db: tx,
        locale,
        userId: user.id,
      });
    }

    if (role === "BUSINESS_OWNER") {
      await recordCurrentLegalAcceptances({
        acceptanceContext: "BUSINESS_SIGNUP",
        audience: "business",
        db: tx,
        locale,
        userId: user.id,
      });
    }
  });

  try {
    await signIn("credentials", {
      identifier: parsed.data.email,
      password: rawPassword,
      redirectTo: resolvePostAuthRedirect(role, redirectTo),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        error: formCopy[locale].invalidSession,
        signupValues,
      };
    }

    throw error;
  }

  return {};
}

export async function completeProfileAction(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const locale = getLocaleFromForm(formData);
  const viewer = await requireViewer();
  const requestedRole = getStringValue(formData.get("accountType"));
  const redirectTo = getStringValue(formData.get("redirectTo"));
  const parsed = completeProfileSchema.safeParse({
    username: normalizeUsername(getStringValue(formData.get("username"))),
  });

  if (!parsed.success) {
    return {
      error: formCopy[locale].invalidForm,
      fieldErrors: {
        username: formCopy[locale].usernameRule,
      },
    };
  }

  const existing = await prisma.user.findFirst({
    where: {
      username: parsed.data.username,
      NOT: { id: viewer.id },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      error: formCopy[locale].duplicateUsername,
      fieldErrors: {
        username: formCopy[locale].duplicateUsername,
      },
    };
  }

  if (!canUsePrimaryAdminUsername(viewer, parsed.data.username)) {
    return {
      error: formCopy[locale].reservedAdminUsername,
      fieldErrors: {
        username: formCopy[locale].reservedAdminUsername,
      },
    };
  }

  const role = resolveRequestedAccountRole({
    requestedRole,
  });

  await prisma.user.update({
    where: { id: viewer.id },
    data: {
      profileCompleted: true,
      role,
      username: parsed.data.username,
    },
  });

  redirect(resolvePostAuthRedirect(role, redirectTo));
}
