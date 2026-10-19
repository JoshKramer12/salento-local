import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { Locale } from "@/lib/i18n";
import { LEGAL_DOCUMENTS } from "@/lib/legal";
import {
  normalizeEmail,
  normalizeUsername,
  signupSchema,
} from "@/lib/validation";

const HANDOFF_VERSION = 2;
const HANDOFF_TTL_MS = 15 * 60 * 1000;

export type PartnerSignupEntry = {
  email: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  partnerTermsAccepted: boolean;
  partnerTermsVersion: string;
  password: string;
  redirectTo: string | null;
  username: string;
};

export type PartnerSignupEntryValidation = {
  entry?: PartnerSignupEntry;
  fields: string[];
  passwordMismatch: boolean;
  termsMissing: boolean;
};

type EncryptedPartnerSignupHandoff = PartnerSignupEntry & {
  expiresAt: number;
  version: number;
};

export type CompletePartnerSignupInput = {
  baseTownOrArea: string;
  birthDate: string;
  email: string;
  firstName: string;
  heardAbout: string;
  lastName: string;
  locale: Locale;
  passwordHash: string;
  phone: string;
  username: string;
  whatsapp?: string;
};

type PartnerSignupPersistence = {
  createProfile: (data: {
    baseTownOrArea: string;
    billingAddress: string;
    birthDate: Date;
    completedAt: Date;
    fullName: string;
    heardAbout: string;
    legalFullName: string;
    phone: string;
    preferredLanguage: string;
    taxIdOrVatNumber: string;
    understandsDirectPayment: boolean;
    understandsNoCash: boolean;
    understandsNoNegotiation: boolean;
    understandsNoPricing: boolean;
    userId: string;
    whatsapp: string | null;
  }) => Promise<unknown>;
  createUser: (data: {
    email: string;
    name: string;
    passwordHash: string;
    profileCompleted: boolean;
    role: "GETTER";
    username: string;
  }) => Promise<{ id: string }>;
  recordLegalAcceptance: (userId: string) => Promise<unknown>;
};

function getEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function isLocale(value: string): value is Locale {
  return value === "en" || value === "it";
}

function isValidHandoff(value: unknown): value is EncryptedPartnerSignupHandoff {
  if (!value || typeof value !== "object") return false;

  const handoff = value as Partial<EncryptedPartnerSignupHandoff>;
  return (
    handoff.version === HANDOFF_VERSION &&
    typeof handoff.expiresAt === "number" &&
    handoff.expiresAt > Date.now() &&
    typeof handoff.email === "string" &&
    typeof handoff.firstName === "string" &&
    typeof handoff.lastName === "string" &&
    isLocale(`${handoff.locale ?? ""}`) &&
    typeof handoff.partnerTermsAccepted === "boolean" &&
    handoff.partnerTermsVersion === LEGAL_DOCUMENTS.partnerTerms.version &&
    typeof handoff.password === "string" &&
    (handoff.redirectTo === null || typeof handoff.redirectTo === "string") &&
    typeof handoff.username === "string"
  );
}

export function validatePartnerSignupEntry(input: {
  email: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  partnerTermsAccepted: boolean;
  partnerTermsVersion: string;
  password: string;
  confirmPassword: string;
  redirectTo: string | null;
  username: string;
}): PartnerSignupEntryValidation {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const passwordMismatch = input.confirmPassword !== input.password;
  const termsMissing = !input.partnerTermsAccepted || input.partnerTermsVersion !== LEGAL_DOCUMENTS.partnerTerms.version;
  const fields: string[] = [];

  if (!firstName || firstName.length > 80) fields.push("firstName");
  if (!lastName || lastName.length > 80) fields.push("lastName");
  if (passwordMismatch) fields.push("confirmPassword");
  if (termsMissing) fields.push("partnerTermsAccepted");

  const parsed = signupSchema.safeParse({ email, password: input.password, username });
  if (!parsed.success) {
    fields.push(...parsed.error.issues.map((issue) => String(issue.path[0] ?? "form")));
  }

  const uniqueFields = [...new Set(fields)];
  if (uniqueFields.length) {
    return { fields: uniqueFields, passwordMismatch, termsMissing };
  }

  const parsedData = parsed.data!;

  return {
    entry: {
      email: parsedData.email,
      firstName,
      lastName,
      locale: input.locale,
      partnerTermsAccepted: true,
      partnerTermsVersion: input.partnerTermsVersion,
      password: parsedData.password,
      redirectTo: input.redirectTo,
      username: parsedData.username,
    },
    fields: [],
    passwordMismatch: false,
    termsMissing: false,
  };
}

export function sealPartnerSignupHandoff(entry: PartnerSignupEntry, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(secret), iv);
  const payload: EncryptedPartnerSignupHandoff = {
    ...entry,
    expiresAt: Date.now() + HANDOFF_TTL_MS,
    version: HANDOFF_VERSION,
  };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function openPartnerSignupHandoff(value: string, secret: string): PartnerSignupEntry | null {
  const [encodedIv, encodedTag, encodedPayload, ...extra] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedPayload || extra.length) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(secret),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(decrypted.toString("utf8"));

    if (!isValidHandoff(parsed)) return null;

    return {
      email: parsed.email,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      locale: parsed.locale,
      partnerTermsAccepted: parsed.partnerTermsAccepted,
      partnerTermsVersion: parsed.partnerTermsVersion,
      password: parsed.password,
      redirectTo: parsed.redirectTo,
      username: parsed.username,
    };
  } catch {
    return null;
  }
}

export async function createCompletePartnerSignup(
  input: CompletePartnerSignupInput,
  persistence: PartnerSignupPersistence,
) {
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  const user = await persistence.createUser({
    email: input.email,
    name: fullName,
    passwordHash: input.passwordHash,
    profileCompleted: true,
    role: "GETTER",
    username: input.username,
  });

  await persistence.createProfile({
    baseTownOrArea: input.baseTownOrArea,
    billingAddress: "",
    birthDate: new Date(input.birthDate),
    completedAt: new Date(),
    fullName,
    heardAbout: input.heardAbout,
    legalFullName: fullName,
    phone: input.phone,
    preferredLanguage: input.locale,
    taxIdOrVatNumber: "",
    understandsDirectPayment: true,
    understandsNoCash: true,
    understandsNoNegotiation: true,
    understandsNoPricing: true,
    userId: user.id,
    whatsapp: input.whatsapp?.trim() || null,
  });

  await persistence.recordLegalAcceptance(user.id);
  return user;
}
