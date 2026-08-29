import { LEGAL_DOCUMENTS } from "@/lib/legal";

export const LISTING_SIGNER_ROLE_VALUES = [
  "OWNER",
  "LEGAL_REPRESENTATIVE",
  "MANAGER_AUTHORIZED_BY_OWNER",
  "OTHER_AUTHORIZED_REPRESENTATIVE",
] as const;

export type ListingSignerRole = (typeof LISTING_SIGNER_ROLE_VALUES)[number];

export const LISTING_OFFER = {
  automaticRenewal: false,
  businessTermsVersion: LEGAL_DOCUMENTS.businessTerms.version,
  firstYearPriceCents: 10000,
  privacyPolicyVersion: LEGAL_DOCUMENTS.privacyPolicy.version,
  renewalPriceCents: 5000,
  specificApproval: null as
    | null
    | {
        text: {
          en: string;
          it: string;
        };
      },
  termMonths: 12,
} as const;

export function resolveContractualEmail(params: {
  businessEmail?: string | null;
  ownerEmail?: string | null;
}) {
  const businessEmail = params.businessEmail?.trim() || "";

  if (businessEmail) {
    return businessEmail;
  }

  return params.ownerEmail?.trim() || "";
}
