import { normalizeEmail } from "@/lib/validation";

export function getBusinessClaimVerificationEmail(input: {
  ownerEmail: string | null | undefined;
  ownerHasNoEmail: boolean;
}) {
  if (input.ownerHasNoEmail || !input.ownerEmail?.trim()) {
    return null;
  }

  return normalizeEmail(input.ownerEmail);
}

export function isBusinessAlreadyManaged(input: {
  ownerAccessUserIds?: Array<string | null | undefined>;
  ownerUserId?: string | null;
}) {
  return Boolean(
    input.ownerUserId || input.ownerAccessUserIds?.some((userId) => Boolean(userId)),
  );
}

export function shouldShowClaimEmailChoice(
  accountEmail: string | null | undefined,
  verifiedBusinessEmail: string | null | undefined,
) {
  if (!accountEmail?.trim() || !verifiedBusinessEmail?.trim()) {
    return false;
  }

  return normalizeEmail(accountEmail) !== normalizeEmail(verifiedBusinessEmail);
}
