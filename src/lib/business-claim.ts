import type { Prisma } from "@prisma/client";

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

export async function approveVerifiedBusinessClaim(input: {
  businessId: string;
  claimId: string;
  userId: string;
  verificationEmail: string;
  tx: Prisma.TransactionClient;
}) {
  const { businessId, claimId, tx, userId } = input;
  const verificationEmail = normalizeEmail(input.verificationEmail);
  const ownershipUpdate = await tx.business.updateMany({
    where: {
      id: businessId,
      ownerUserId: null,
      ownerAccesses: { none: { userId: { not: null } } },
    },
    data: {
      ownerUserId: userId,
      verificationStatus: "OWNER_VERIFIED",
    },
  });

  if (!ownershipUpdate.count) {
    await tx.businessClaim.updateMany({
      where: { id: claimId, status: "AWAITING_VERIFICATION" },
      data: { status: "REJECTED" },
    });
    return false;
  }

  await tx.businessClaim.update({
    where: { id: claimId },
    data: {
      reviewedAt: new Date(),
      status: "APPROVED",
      verificationCodeExpiresAt: null,
      verificationCodeHash: null,
      verificationSentTo: null,
      verifiedAt: new Date(),
    },
  });

  await tx.businessOwnerAccess.upsert({
    where: { businessId_email: { businessId, email: verificationEmail } },
    create: { activatedAt: new Date(), businessId, email: verificationEmail, userId },
    update: { activatedAt: new Date(), userId, verifiedAt: new Date() },
  });
  return true;
}
