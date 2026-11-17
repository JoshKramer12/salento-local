import { getViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { reconcilePartnerWithdrawal, requestPartnerPayoutRetry, requestPartnerTransferReversal } from "@/lib/partner-withdrawal-processing";
import type { WithdrawalProvider } from "@/lib/partner-withdrawal-provider";

type Admin = { id: string; role: string };
type Dependencies = { authenticate?: () => Promise<Admin | null>; provider?: WithdrawalProvider };

async function requireAdmin(dependencies: Dependencies) {
  const viewer = await (dependencies.authenticate ?? getViewer)();
  if (!viewer?.id || viewer.role !== "ADMIN") throw new Error("withdrawal_admin_not_authorized");
  const stored = await prisma.user.findUnique({ where: { id: viewer.id }, select: { role: true } });
  if (stored?.role !== "ADMIN") throw new Error("withdrawal_admin_not_authorized");
  return viewer;
}

export async function inspectAdminWithdrawal(withdrawalId: string, dependencies: Dependencies = {}) {
  await requireAdmin(dependencies);
  return prisma.partnerWithdrawal.findUnique({
    where: { id: withdrawalId },
    include: {
      attempts: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      commissions: { include: { commission: { select: {
        id: true, status: true, amountCents: true, payoutId: true, paymentId: true,
      } } } },
      payout: true,
    },
  });
}

function checkedReason(reason: string) {
  const value = reason.trim();
  if (value.length < 10 || value.length > 500) throw new Error("withdrawal_investigation_reason_invalid");
  return value;
}

export async function recordAdminWithdrawalInvestigation(
  withdrawalId: string, reason: string, dependencies: Dependencies = {},
) {
  const viewer = await requireAdmin(dependencies);
  const value = checkedReason(reason);
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    return tx.partnerWithdrawalEvent.create({ data: {
      withdrawalId, actorUserId: viewer.id, fromStatus: withdrawal.status,
      toStatus: withdrawal.status, reason: `operator_investigation:${value}`,
    } });
  });
}

export async function reconcileAdminWithdrawal(
  withdrawalId: string, reason: string, dependencies: Dependencies = {},
) {
  await recordAdminWithdrawalInvestigation(withdrawalId, reason, dependencies);
  return reconcilePartnerWithdrawal(withdrawalId, { provider: dependencies.provider });
}

export async function reverseAdminWithdrawalTransfer(
  withdrawalId: string, reason: string, dependencies: Dependencies = {},
) {
  await recordAdminWithdrawalInvestigation(withdrawalId, reason, dependencies);
  return requestPartnerTransferReversal(withdrawalId, { provider: dependencies.provider });
}

export async function retryAdminWithdrawalPayout(
  withdrawalId: string, reason: string, dependencies: Dependencies = {},
) {
  await recordAdminWithdrawalInvestigation(withdrawalId, reason, dependencies);
  return requestPartnerPayoutRetry(withdrawalId, { provider: dependencies.provider });
}
