import parsePhoneNumberFromString from "libphonenumber-js/min";
import type { CountryCode } from "libphonenumber-js";

import { isVerificationCodeValid } from "@/lib/verification";

export const CLAIM_VERIFICATION_EXPIRY_MINUTES = 15;
export const CLAIM_VERIFICATION_RESEND_COOLDOWN_MINUTES = 2;
export const CLAIM_VERIFICATION_MAX_ATTEMPTS = 5;
export const CLAIM_VERIFICATION_MAX_RESENDS = 5;

export const claimVerificationMethodValues = ["EMAIL", "SMS", "WHATSAPP"] as const;

export type ClaimVerificationMethod = (typeof claimVerificationMethodValues)[number];

type ClaimContactInput = {
  channel: ClaimVerificationMethod;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
};

type ClaimCodeStatus =
  | "valid"
  | "invalid"
  | "expired"
  | "too_many_attempts";

type ClaimResendStatus = "allowed" | "cooldown" | "limit_reached";

function normalizeMethod(value: string) {
  return value.trim().toUpperCase();
}

export function normalizeVerificationEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeVerificationPhone(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("+")) {
    const normalizedInternational = `+${trimmed.slice(1).replace(/\D+/g, "")}`;

    if (/^\+\d{8,15}$/.test(normalizedInternational)) {
      return normalizedInternational;
    }
  }

  const defaultCountry = (process.env.DEFAULT_PHONE_COUNTRY || "IT").trim().toUpperCase();
  let phoneNumber = null;

  try {
    phoneNumber = trimmed.startsWith("+")
      ? parsePhoneNumberFromString(trimmed)
      : parsePhoneNumberFromString(trimmed, defaultCountry as CountryCode);
  } catch {
    if (!trimmed.startsWith("+") && defaultCountry !== "IT") {
      phoneNumber = parsePhoneNumberFromString(trimmed, "IT");
    }
  }

  if (!phoneNumber?.isValid()) {
    return null;
  }

  return phoneNumber.number;
}

export function getEnabledVerificationMethods(env = process.env) {
  const configuredValue = env.VERIFICATION_METHODS?.trim();
  const configuredMethods = configuredValue
    ? configuredValue
        .split(",")
        .map((value) => normalizeMethod(value))
        .filter((value): value is ClaimVerificationMethod =>
          claimVerificationMethodValues.includes(value as ClaimVerificationMethod),
        )
    : [];

  return configuredMethods.length ? configuredMethods : (["EMAIL", "SMS"] as ClaimVerificationMethod[]);
}

export function isVerificationMethodEnabled(
  channel: ClaimVerificationMethod,
  env = process.env,
) {
  return getEnabledVerificationMethods(env).includes(channel);
}

export function resolveClaimVerificationRecipient({
  channel,
  email,
  phone,
  whatsapp,
}: ClaimContactInput) {
  if (channel === "EMAIL") {
    return email ? normalizeVerificationEmail(email) : null;
  }

  if (channel === "SMS") {
    return phone ? normalizeVerificationPhone(phone) : null;
  }

  if (channel === "WHATSAPP") {
    return whatsapp ? normalizeVerificationPhone(whatsapp) : null;
  }

  return null;
}

export function maskVerificationRecipient(
  channel: ClaimVerificationMethod,
  recipient: string | null | undefined,
) {
  if (!recipient) {
    return null;
  }

  if (channel === "EMAIL") {
    const [local, domain] = recipient.split("@");

    if (!local || !domain) {
      return recipient;
    }

    const visibleLocal = local.length <= 2 ? `${local[0] ?? ""}*` : `${local.slice(0, 2)}***`;
    const domainParts = domain.split(".");
    const domainName = domainParts[0] ?? "";
    const domainSuffix = domainParts.slice(1).join(".");
    const visibleDomain =
      domainName.length <= 2 ? `${domainName[0] ?? ""}*` : `${domainName.slice(0, 2)}***`;

    return `${visibleLocal}@${visibleDomain}${domainSuffix ? `.${domainSuffix}` : ""}`;
  }

  const digits = recipient.replace(/\D+/g, "");

  if (digits.length <= 4) {
    return recipient;
  }

  return `${recipient.slice(0, Math.max(2, recipient.length - 6))}${"*".repeat(
    Math.min(6, Math.max(2, recipient.length - 6)),
  )}${recipient.slice(-2)}`;
}

export function evaluateClaimCodeAttempt({
  code,
  expiresAt,
  hash,
  now = new Date(),
  attempts,
}: {
  attempts: number;
  code: string;
  expiresAt: Date | null;
  hash: string | null;
  now?: Date;
}) {
  if (!hash || !expiresAt) {
    return "expired" satisfies ClaimCodeStatus;
  }

  if (attempts >= CLAIM_VERIFICATION_MAX_ATTEMPTS) {
    return "too_many_attempts" satisfies ClaimCodeStatus;
  }

  if (expiresAt.getTime() < now.getTime()) {
    return "expired" satisfies ClaimCodeStatus;
  }

  if (!isVerificationCodeValid(code, hash)) {
    return "invalid" satisfies ClaimCodeStatus;
  }

  return "valid" satisfies ClaimCodeStatus;
}

export function evaluateClaimResend({
  now = new Date(),
  resendAvailableAt,
  resendCount,
}: {
  now?: Date;
  resendAvailableAt: Date | null;
  resendCount: number;
}) {
  if (resendCount >= CLAIM_VERIFICATION_MAX_RESENDS) {
    return "limit_reached" satisfies ClaimResendStatus;
  }

  if (resendAvailableAt && resendAvailableAt.getTime() > now.getTime()) {
    return "cooldown" satisfies ClaimResendStatus;
  }

  return "allowed" satisfies ClaimResendStatus;
}
