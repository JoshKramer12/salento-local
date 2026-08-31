import { normalizeAddressSelectionValue } from "@/lib/address-selection";

type SubmissionIdentity = {
  address: string;
  businessName: string;
  phone: string;
};

function normalizePhoneComparison(value: string) {
  return value.replace(/\D+/g, "");
}

/**
 * Confirms that a duplicate-check response still belongs to the exact values
 * submitted by PublishForm. The address must be the submitted street line,
 * not Google Places' longer display-only formatted address.
 */
export function duplicateResponseMatchesSubmittedValues(
  response: SubmissionIdentity,
  submitted: SubmissionIdentity,
) {
  return (
    response.businessName.trim() === submitted.businessName.trim() &&
    normalizeAddressSelectionValue(response.address) ===
      normalizeAddressSelectionValue(submitted.address) &&
    normalizePhoneComparison(response.phone) === normalizePhoneComparison(submitted.phone)
  );
}
