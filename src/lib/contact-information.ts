import { resolveContractualEmail } from "@/lib/listing-offer";
import { normalizePhoneNumber } from "@/lib/validation";

export type OwnerWhatsappChoice = "business-whatsapp" | "business-phone" | "different" | null;
export type OwnerEmailChoice = "business-email" | "different" | "none" | null;

export function resolvePartnerPhoneContacts(params: {
  businessPhone: string;
  businessWhatsappManual: string;
  businessWhatsappSameAsPhone: boolean;
  ownerWhatsappChoice: OwnerWhatsappChoice;
  ownerWhatsappManual: string;
}) {
  const businessWhatsapp = params.businessWhatsappSameAsPhone
    ? params.businessPhone : params.businessWhatsappManual;
  const normalizedPhone = normalizePhoneNumber(params.businessPhone);
  const normalizedWhatsapp = normalizePhoneNumber(businessWhatsapp);
  const sameBusinessContactNumber = Boolean(
    normalizedPhone && normalizedWhatsapp && normalizedPhone === normalizedWhatsapp,
  );
  const hasBusinessWhatsapp = Boolean(businessWhatsapp.trim());
  const availableOwnerWhatsappChoice =
    params.ownerWhatsappChoice === "business-whatsapp" && !hasBusinessWhatsapp ? null
      : params.ownerWhatsappChoice === "business-phone" && !params.businessPhone.trim() ? null
      : params.ownerWhatsappChoice === "business-phone" && hasBusinessWhatsapp && sameBusinessContactNumber
        ? "business-whatsapp" : params.ownerWhatsappChoice;
  const ownerPhone = availableOwnerWhatsappChoice === "business-whatsapp" ? businessWhatsapp
    : availableOwnerWhatsappChoice === "business-phone" ? params.businessPhone
    : availableOwnerWhatsappChoice === "different" ? params.ownerWhatsappManual : "";

  return {
    availableOwnerWhatsappChoice,
    businessWhatsapp,
    hasBusinessWhatsapp,
    ownerPhone,
    sameBusinessContactNumber,
  };
}

export function resolvePartnerEmailContact(params: {
  businessEmail: string;
  ownerEmailChoice: OwnerEmailChoice;
  ownerEmailManual: string;
  ownerHasNoEmailInput: boolean;
}) {
  if (params.businessEmail.trim()) {
    return {
      ownerEmail: params.ownerEmailChoice === "business-email" ? params.businessEmail.trim()
        : params.ownerEmailChoice === "different" ? params.ownerEmailManual : "",
      ownerHasNoEmail: params.ownerEmailChoice === "none",
    };
  }

  return {
    ownerEmail: params.ownerHasNoEmailInput ? "" : params.ownerEmailManual,
    ownerHasNoEmail: params.ownerHasNoEmailInput,
  };
}

export function resolveSubmissionContactValues(params: {
  businessEmail?: string | null;
  businessWhatsapp?: string | null;
  ownerEmail?: string | null;
}) {
  return {
    contractualEmail: resolveContractualEmail({
      businessEmail: params.businessEmail,
      ownerEmail: params.ownerEmail,
    }),
    publicEmail: params.businessEmail?.trim() || "",
    publicWhatsapp: params.businessWhatsapp?.trim() || "",
  };
}

/** Legacy submissions could have inherited phone as WhatsApp without consent.
 * Equal numbers are public only for submissions created after the new form was deployed. */
export function getConfirmedPublicWhatsapp(params: {
  businessPhone: string;
  businessWhatsapp: string;
  createdAt: Date;
  verifiedFrom?: string;
}) {
  const whatsapp = normalizePhoneNumber(params.businessWhatsapp);
  if (!whatsapp) return null;
  const phone = normalizePhoneNumber(params.businessPhone);
  if (whatsapp !== phone) return whatsapp;

  const cutoff = params.verifiedFrom ? new Date(params.verifiedFrom) : null;
  return cutoff && Number.isFinite(cutoff.getTime()) && params.createdAt >= cutoff
    ? whatsapp : null;
}
