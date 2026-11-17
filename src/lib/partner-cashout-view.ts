import { getViewer } from "@/lib/auth-guards";
import { getPartnerWithdrawableBalance } from "@/lib/partner-withdrawals";
import { payableCommissionWhere } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { withdrawalExecutionAllowed } from "@/lib/partner-withdrawal-processing";

export function cashoutUiEnabled() {
  return process.env.PARTNER_CASHOUT_UI_ENABLED === "true";
}

export function cashoutRequestsEnabled() {
  return cashoutUiEnabled() && process.env.PARTNER_CASHOUT_REQUESTS_ENABLED === "true" &&
    withdrawalExecutionAllowed();
}

export type CashoutHistoryItem = {
  id: string; amountCents: number; status: string; requestedAt: string;
  completedAt: string | null; destinationLast4: string | null; canCancel: boolean;
};

export type CashoutView = {
  availableCents: number; pendingCents: number; reservedCents: number;
  paidCents: number; grossEarnedCents: number; debtCents: number;
  testCents: number; unverifiedCents: number;
  destinationReady: boolean; destinationLast4: string | null; bankName: string | null;
  activeWithdrawalId: string | null; activeWithdrawalStatus: string | null; unresolvedLegacyPayoutId: string | null;
  requestEnabled: boolean; disbursementsAllowed: boolean; minimumCents: number;
  history: CashoutHistoryItem[]; hasMore: boolean; page: number;
  legacyHistory: { id: string; amountCents: number; status: string; initiatedAt: string; method: string }[];
};

type Viewer = { id: string; role: string; profileCompleted: boolean };
type Dependencies = { authenticate?: () => Promise<Viewer | null>; now?: Date };

export async function getPartnerCashoutView(page = 1, dependencies: Dependencies = {}): Promise<CashoutView> {
  const viewer = await (dependencies.authenticate ?? getViewer)();
  if (!viewer?.id || viewer.role !== "GETTER" || !viewer.profileCompleted) {
    throw new Error("partner_cashout_not_authorized");
  }
  const safePage = Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), 1000) : 1;
  const now = dependencies.now ?? new Date();
  const [balance, commissions, payable, withdrawals, setup, legacy] = await Promise.all([
    getPartnerWithdrawableBalance({ authenticate: async () => viewer, now }),
    prisma.partnerCommission.findMany({ where: { partnerUserId: viewer.id, type: "COMMISSION", amountCents: { gt: 0 } },
      select: { id: true, amountCents: true, status: true, payout: { select: { paidAt: true } },
        payment: { select: { status: true, stripeLivemode: true } } } }),
    prisma.partnerCommission.findMany({ where: { ...payableCommissionWhere(now), partnerUserId: viewer.id }, select: { id: true } }),
    prisma.partnerWithdrawal.findMany({ where: { partnerUserId: viewer.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (safePage - 1) * 10, take: 11,
      select: { id: true, requestedAmountCents: true, status: true, createdAt: true, completedAt: true,
        destinationLast4: true, providerStartedAt: true, payoutId: true } }),
    prisma.localPartnerProfile.findUnique({ where: { userId: viewer.id }, select: {
      stripePayoutAccountLast4: true, stripePayoutBankName: true,
    } }),
    prisma.partnerPayout.findMany({ where: { partnerUserId: viewer.id, withdrawal: { is: null } },
      orderBy: { initiatedAt: "desc" }, take: 12,
      select: { id: true, amountCents: true, status: true, initiatedAt: true, payoutMethod: true } }),
  ]);
  const payableIds = new Set(payable.map((entry) => entry.id));
  const verified = commissions.filter((entry) => entry.payment?.stripeLivemode === true && entry.status !== "REVERSED");
  // A paid commission stays in paid history if its Payment is later refunded;
  // its separate reversal is shown as debt, never subtracted from paid history.
  const historical = verified.filter((entry) => entry.status === "PAID" || entry.payment?.status === "PAID");
  return {
    availableCents: balance.netEligibleCents,
    pendingCents: historical.filter((entry) => entry.payment?.status === "PAID" &&
      ["PENDING", "AVAILABLE"].includes(entry.status) && !payableIds.has(entry.id))
      .reduce((sum, entry) => sum + entry.amountCents, 0),
    reservedCents: balance.reservedCents,
    paidCents: historical.filter((entry) => entry.status === "PAID" && entry.payout?.paidAt)
      .reduce((sum, entry) => sum + entry.amountCents, 0),
    grossEarnedCents: historical.reduce((sum, entry) => sum + entry.amountCents, 0),
    debtCents: balance.outstandingDebtCents,
    testCents: commissions.filter((entry) => entry.payment?.stripeLivemode === false)
      .reduce((sum, entry) => sum + entry.amountCents, 0),
    unverifiedCents: commissions.filter((entry) => entry.payment?.stripeLivemode == null)
      .reduce((sum, entry) => sum + entry.amountCents, 0),
    destinationReady: balance.destinationReady,
    destinationLast4: setup?.stripePayoutAccountLast4 ?? null,
    bankName: setup?.stripePayoutBankName ?? null,
    activeWithdrawalId: balance.activeWithdrawalId,
    activeWithdrawalStatus: balance.activeWithdrawalStatus,
    unresolvedLegacyPayoutId: balance.unresolvedLegacyPayoutId,
    requestEnabled: cashoutRequestsEnabled(),
    disbursementsAllowed: balance.disbursementsAllowed,
    minimumCents: balance.minimumCents,
    history: withdrawals.slice(0, 10).map((entry) => ({
      id: entry.id, amountCents: entry.requestedAmountCents, status: entry.status,
      requestedAt: entry.createdAt.toISOString(), completedAt: entry.completedAt?.toISOString() ?? null,
      destinationLast4: entry.destinationLast4,
      canCancel: ["REQUESTED", "READY_FOR_PROCESSING"].includes(entry.status) &&
        !entry.providerStartedAt && !entry.payoutId,
    })),
    hasMore: withdrawals.length > 10, page: safePage,
    legacyHistory: legacy.map((entry) => ({ id: entry.id, amountCents: entry.amountCents,
      status: entry.status, initiatedAt: entry.initiatedAt.toISOString(), method: entry.payoutMethod })),
  };
}
