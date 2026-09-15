import { LEGAL_DOCUMENTS } from "@/lib/legal";

export const LISTING_SIGNER_ROLE_VALUES = [
  "OWNER",
  "LEGAL_REPRESENTATIVE",
  "MANAGER_AUTHORIZED_BY_OWNER",
  "OTHER_AUTHORIZED_REPRESENTATIVE",
] as const;

export type ListingSignerRole = (typeof LISTING_SIGNER_ROLE_VALUES)[number];

export const BUSINESS_MEMBERSHIP_ANNUAL_PRICE_CENTS = 10000;

export const LISTING_OFFER = {
  automaticRenewal: false,
  annualPriceCents: BUSINESS_MEMBERSHIP_ANNUAL_PRICE_CENTS,
  businessTermsVersion: LEGAL_DOCUMENTS.businessTerms.version,
  // Snapshot field compatibility: the initial payment is the annual price.
  firstYearPriceCents: BUSINESS_MEMBERSHIP_ANNUAL_PRICE_CENTS,
  privacyPolicyVersion: LEGAL_DOCUMENTS.privacyPolicy.version,
  renewalPriceCents: BUSINESS_MEMBERSHIP_ANNUAL_PRICE_CENTS,
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
