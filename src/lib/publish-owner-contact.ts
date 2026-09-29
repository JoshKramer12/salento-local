import { prisma } from "@/lib/prisma";
import { buildOwnerContactDefaults } from "@/lib/publish-owner-defaults";

export async function getPublishOwnerContactDefaults(userId: string) {
  const [account, accesses] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, phone: true } }),
    prisma.businessOwnerAccess.findMany({
      where: { userId, activatedAt: { not: null } },
      select: { businessId: true, email: true, phone: true, sourceSubmissionId: true },
    }),
  ]);
  const sourceIds = accesses.flatMap((access) => access.sourceSubmissionId ? [access.sourceSubmissionId] : []);
  const sources = sourceIds.length ? await prisma.businessSubmission.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, createdBusinessId: true, ownerName: true, ownerEmail: true, ownerPhone: true },
  }) : [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  return buildOwnerContactDefaults(account, accesses.map((access) => ({
    ...access, source: access.sourceSubmissionId ? byId.get(access.sourceSubmissionId) ?? null : null,
  })));
}
