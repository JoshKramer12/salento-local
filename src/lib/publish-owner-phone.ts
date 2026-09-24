import type { CountryCode } from "libphonenumber-js";

import { getPhoneCountryCallingCode, isPossiblePhoneNumber, normalizePhoneNumber } from "@/lib/validation";

export const ownerEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildPhoneValue(parts: { country: CountryCode; number: string }) {
  const nationalNumber = parts.number.trim();
  return nationalNumber ? `${getPhoneCountryCallingCode(parts.country)} ${nationalNumber}` : "";
}

export function getOwnerPhoneStepError(params: {
  locale: "en" | "it";
  ownerHasNoEmail: boolean;
  ownerPhone: string;
  submitterRole: string;
}) {
  const valid = params.submitterRole === "GETTER" && params.ownerHasNoEmail
    ? Boolean(normalizePhoneNumber(params.ownerPhone))
    : isPossiblePhoneNumber(params.ownerPhone);
  if (valid) return "";

  if (!params.ownerPhone.trim()) {
    return params.locale === "it"
      ? "Inserisci il numero WhatsApp del titolare o responsabile."
      : "Enter the owner or manager's WhatsApp number.";
  }
  return params.locale === "it"
    ? "Controlla il numero WhatsApp del titolare o responsabile e il prefisso internazionale."
    : "Check the owner or manager's WhatsApp number and country code.";
}

export function getOwnerStepError(params: {
  locale: "en" | "it";
  ownerEmail: string;
  ownerHasNoEmail: boolean;
  ownerName: string;
  ownerPhone: string;
  submitterRole: string;
}) {
  const phoneError = getOwnerPhoneStepError(params);
  if (phoneError) return phoneError;
  if (params.ownerName.trim() && (params.ownerHasNoEmail || ownerEmailPattern.test(params.ownerEmail))) return "";
  return params.locale === "it"
    ? "Completa i dati privati del titolare, oppure conferma che non ha email."
    : "Complete the owner's private details, or confirm they do not have an email.";
}
