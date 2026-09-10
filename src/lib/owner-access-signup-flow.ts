import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { Locale } from "@/lib/i18n";
import { isStrongPassword } from "@/lib/password-rules";
import {
  normalizeEmail,
  normalizeUsername,
  signupSchema,
  usernamePattern,
} from "@/lib/validation";

const HANDOFF_VERSION = 1;
const HANDOFF_TTL_MS = 15 * 60 * 1000;

export type OwnerAccessSignupEntry = {
  businessTermsAccepted: boolean;
  email: string;
  firstName: string;
  lastName: string;
  locale: Locale;
  password: string;
  token: string;
  username: string;
};

export type OwnerAccessSignupEntryValidation = {
  entry?: OwnerAccessSignupEntry;
  fields: string[];
  passwordMismatch: boolean;
  termsMissing: boolean;
};

type EncryptedOwnerAccessSignupHandoff = OwnerAccessSignupEntry & {
  expiresAt: number;
  version: number;
};

function getEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function isLocale(value: string): value is Locale {
  return value === "en" || value === "it";
}

function isValidHandoff(value: unknown): value is EncryptedOwnerAccessSignupHandoff {
  if (!value || typeof value !== "object") return false;
  const handoff = value as Partial<EncryptedOwnerAccessSignupHandoff>;
  return (
    handoff.version === HANDOFF_VERSION &&
    typeof handoff.expiresAt === "number" &&
    handoff.expiresAt > Date.now() &&
    typeof handoff.businessTermsAccepted === "boolean" &&
    typeof handoff.email === "string" &&
    typeof handoff.firstName === "string" &&
    typeof handoff.lastName === "string" &&
    isLocale(`${handoff.locale ?? ""}`) &&
    typeof handoff.password === "string" &&
    typeof handoff.token === "string" &&
    typeof handoff.username === "string"
  );
}

export function validateOwnerAccessSignupEntry(input: {
  businessTermsAccepted: boolean;
  confirmPassword: string;
  email: string;
  emailRequired: boolean;
  firstName: string;
  lastName: string;
  locale: Locale;
  password: string;
  token: string;
  username: string;
}): OwnerAccessSignupEntryValidation {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  const passwordMismatch = input.password !== input.confirmPassword;
  const termsMissing = !input.businessTermsAccepted;
  const fields: string[] = [];

  if (!firstName || firstName.length > 80) fields.push("firstName");
  if (!lastName || lastName.length > 80) fields.push("lastName");
  if (passwordMismatch) fields.push("confirmPassword");
  if (termsMissing) fields.push("businessTermsAccepted");

  if (input.emailRequired || email) {
    const parsed = signupSchema.safeParse({ email, password: input.password, username });
    if (!parsed.success) {
      fields.push(...parsed.error.issues.map((issue) => String(issue.path[0] ?? "form")));
    }
  } else {
    if (!usernamePattern.test(username)) fields.push("username");
    if (!isStrongPassword(input.password)) fields.push("password");
  }

  const uniqueFields = [...new Set(fields)];
  if (uniqueFields.length) {
    return { fields: uniqueFields, passwordMismatch, termsMissing };
  }

  return {
    entry: {
      businessTermsAccepted: true,
      email,
      firstName,
      lastName,
      locale: input.locale,
      password: input.password,
      token: input.token,
      username,
    },
    fields: [],
    passwordMismatch: false,
    termsMissing: false,
  };
}

export function sealOwnerAccessSignupHandoff(entry: OwnerAccessSignupEntry, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(secret), iv);
  const payload: EncryptedOwnerAccessSignupHandoff = {
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

export function openOwnerAccessSignupHandoff(
  value: string,
  secret: string,
): OwnerAccessSignupEntry | null {
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
      businessTermsAccepted: parsed.businessTermsAccepted,
      email: parsed.email,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      locale: parsed.locale,
      password: parsed.password,
      token: parsed.token,
      username: parsed.username,
    };
  } catch {
    return null;
  }
}
