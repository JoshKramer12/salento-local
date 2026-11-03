import type { PartnerWithdrawalStatus, Prisma } from "@prisma/client";
import { getViewer } from "@/lib/auth-guards";
import { payableCommissionWhere } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { areRealPartnerDisbursementsAllowed } from "@/lib/stripe";

// Stage 1 has no route, Server Action, worker, or provider call. Future entry
// points must use these session-derived functions, never a submitted user ID.
const MINIMUM_WITHDRAWAL_CENTS = 5000;
const MAX_ACCOUNT_SYNC_AGE_MS = 24 * 60 * 60 * 1000;
type Tx = Prisma.TransactionClient;
type Viewer = { id: string; role: string; profileCompleted: boolean };
type Dependencies = { authenticate?: () => Promise<Viewer | null>; now?: Date; expectedAmountCents?: number };

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function requireWholeCents(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

async function requirePartner(dependencies: Dependencies): Promise<Viewer> {
  const viewer = await (dependencies.authenticate ?? getViewer)();
  if (!viewer?.id || viewer.role !== "GETTER" || !viewer.profileCompleted) {
    throw new Error("partner_withdrawal_not_authorized");
  }
  return viewer;
}

async function lockPartner(tx: Tx, partnerUserId: string, now: Date) {
  // The first write in every Stage 1 mutation serializes Partner financial
  // changes on SQLite. The unique active request slot is the final DB guard.
  const locked = await tx.localPartnerProfile.updateMany({
    where: { userId: partnerUserId }, data: { updatedAt: now },
  });
  if (locked.count !== 1) throw new Error("partner_profile_missing");
}

async function assertPartnerRecord(tx: Tx, viewer: Viewer) {
  const user = await tx.user.findUnique({
    where: { id: viewer.id }, select: { role: true, profileCompleted: true },
  });
  if (user?.role !== "GETTER" || !user.profileCompleted) {
    throw new Error("partner_withdrawal_not_authorized");
  }
}

async function readState(tx: Tx, partnerUserId: string, now: Date) {
  const [profile, credits, debts, recoveries, reserved, activeWithdrawal, unresolvedLegacyPayout] = await Promise.all([
    tx.localPartnerProfile.findUnique({
      where: { userId: partnerUserId },
      select: {
        completedAt: true, partnerOnboardingCompletedAt: true,
        preferredPayoutMethod: true, stripeConnectedAccountId: true,
        stripeAccountStatus: true, stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true, stripeOnboardingComplete: true,
        stripeLastSyncedAt: true, stripePayoutAccountLast4: true,
      },
    }),
    tx.partnerCommission.findMany({
      where: { ...payableCommissionWhere(now), partnerUserId, currency: "eur" },
      orderBy: [{ eligibleAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: {
        payment: { select: { id: true, businessId: true, businessSubmissionId: true, currency: true, status: true, stripeLivemode: true } },
        business: { select: { id: true, membership: { select: { originatingPartnerUserId: true } } } },
        businessSubmission: { select: { id: true, userId: true, createdBusinessId: true } },
      },
    }),
    tx.partnerCommission.findMany({
      where: { partnerUserId, type: "REVERSAL", status: "DEBT" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, amountCents: true, currency: true, sourceKey: true, payment: { select: { stripeLivemode: true } } },
    }),
    tx.partnerDebtRecovery.findMany({
      where: { partnerUserId, voidedAt: null },
      include: { creditCommission: { select: {
        partnerUserId: true, status: true, type: true, currency: true, amountCents: true,
        payment: { select: { status: true, stripeLivemode: true } },
      } } },
    }),
    tx.partnerCommission.findMany({
      where: { partnerUserId, type: "COMMISSION", status: "RESERVED" },
      select: { id: true, amountCents: true, currency: true },
    }),
    tx.partnerWithdrawal.findUnique({ where: { activePartnerUserId: partnerUserId }, select: { id: true, status: true } }),
    tx.partnerPayout.findFirst({ where: { partnerUserId, OR: [
      { status: { in: ["SCHEDULED", "PROCESSING", "FAILED", "CANCELED"] } },
      { status: "ACTION_REQUIRED", OR: [
        { attemptCount: { gt: 0 } }, { stripeTransferId: { not: null } },
        { stripePayoutId: { not: null } }, { providerBatchId: { not: null } },
      ] },
    ] }, select: { id: true, status: true } }),
  ]);

  if (!profile?.completedAt || !profile.partnerOnboardingCompletedAt) throw new Error("partner_onboarding_incomplete");
  for (const credit of credits) {
    if (!credit.payment || !credit.business || !credit.businessSubmission ||
        credit.payment.businessId !== credit.businessId ||
        credit.payment.businessSubmissionId !== credit.businessSubmissionId ||
        credit.businessSubmission.createdBusinessId !== credit.businessId ||
        credit.businessSubmission.userId !== partnerUserId ||
        credit.business.membership?.originatingPartnerUserId !== partnerUserId ||
        credit.payment.currency !== "eur" || credit.amountCents <= 0) {
      throw new Error("commission_payment_attribution_conflict");
    }
    requireWholeCents(credit.amountCents, "commission_amount_invalid");
  }

  const debtById = new Map(debts.map((debt) => [debt.id, debt]));
  for (const debt of debts) {
    requireWholeCents(Math.abs(debt.amountCents), "partner_debt_requires_review");
    if (debt.amountCents >= 0 || debt.currency !== "eur" || debt.payment?.stripeLivemode !== true ||
        !debt.sourceKey.startsWith("commission:reversal:")) throw new Error("partner_debt_requires_review");
    const originalId = debt.sourceKey.slice("commission:reversal:".length);
    const original = await tx.partnerCommission.findUnique({
      where: { id: originalId },
      select: { partnerUserId: true, amountCents: true, status: true, payout: { select: { status: true } } },
    });
    if (!original || original.partnerUserId !== partnerUserId || original.amountCents !== -debt.amountCents ||
        original.status !== "PAID" || original.payout?.status !== "PAID") throw new Error("partner_debt_requires_review");
  }

  const recoveredByDebt = new Map<string, number>();
  const recoveredByCredit = new Map<string, number>();
  for (const recovery of recoveries) {
    requireWholeCents(recovery.amountCents, "partner_recovery_invalid");
    if (recovery.amountCents === 0 || !debtById.has(recovery.debtCommissionId) ||
        recovery.creditCommission.partnerUserId !== partnerUserId ||
        recovery.creditCommission.type !== "COMMISSION" ||
        recovery.creditCommission.currency !== "eur" ||
        recovery.creditCommission.amountCents <= 0 ||
        recovery.creditCommission.status === "REVERSED" ||
        recovery.creditCommission.payment?.status !== "PAID" ||
        recovery.creditCommission.payment.stripeLivemode !== true) {
      throw new Error("partner_recovery_invalid");
    }
    recoveredByDebt.set(recovery.debtCommissionId, (recoveredByDebt.get(recovery.debtCommissionId) ?? 0) + recovery.amountCents);
    recoveredByCredit.set(recovery.creditCommissionId, (recoveredByCredit.get(recovery.creditCommissionId) ?? 0) + recovery.amountCents);
  }
  for (const recovery of recoveries) {
    if ((recoveredByCredit.get(recovery.creditCommissionId) ?? 0) > recovery.creditCommission.amountCents) {
      throw new Error("partner_recovery_invalid");
    }
  }
  for (const debt of debts) {
    if ((recoveredByDebt.get(debt.id) ?? 0) > -debt.amountCents) throw new Error("partner_recovery_invalid");
  }
  for (const credit of credits) {
    if ((recoveredByCredit.get(credit.id) ?? 0) > credit.amountCents) throw new Error("partner_recovery_invalid");
  }

  const grossEligibleCents = sum(credits.map((credit) => credit.amountCents));
  const eligibleUnreservedCents = sum(credits.map((credit) => credit.amountCents - (recoveredByCredit.get(credit.id) ?? 0)));
  const outstandingDebtCents = sum(debts.map((debt) => -debt.amountCents - (recoveredByDebt.get(debt.id) ?? 0)));
  const reservedCents = sum(reserved.map((credit) => Math.max(0, credit.amountCents - (recoveredByCredit.get(credit.id) ?? 0))));
  const netEligibleCents = Math.max(0, eligibleUnreservedCents - outstandingDebtCents);
  for (const value of [grossEligibleCents, eligibleUnreservedCents, outstandingDebtCents, reservedCents, netEligibleCents]) {
    requireWholeCents(value, "partner_balance_invalid");
  }
  const destinationReady = profile.preferredPayoutMethod === "STRIPE" &&
    Boolean(profile.stripeConnectedAccountId) && profile.stripeAccountStatus === "READY" &&
    profile.stripePayoutsEnabled && profile.stripeDetailsSubmitted && profile.stripeOnboardingComplete &&
    Boolean(profile.stripeLastSyncedAt && profile.stripeLastSyncedAt <= now &&
      now.getTime() - profile.stripeLastSyncedAt.getTime() <= MAX_ACCOUNT_SYNC_AGE_MS);
  const disbursementsAllowed = areRealPartnerDisbursementsAllowed();
  const withdrawableCents = destinationReady && disbursementsAllowed && !activeWithdrawal && !unresolvedLegacyPayout &&
    netEligibleCents >= MINIMUM_WITHDRAWAL_CENTS ? netEligibleCents : 0;
  return {
    profile, credits, debts, recoveredByCredit, recoveredByDebt, activeWithdrawal, unresolvedLegacyPayout,
    grossEligibleCents, eligibleUnreservedCents, outstandingDebtCents,
    debtRecoveredCents: sum(credits.map((credit) => recoveredByCredit.get(credit.id) ?? 0)), reservedCents,
    netEligibleCents, withdrawableCents, destinationReady, disbursementsAllowed,
  };
}

async function recoverDebtInTransaction(tx: Tx, partnerUserId: string, now: Date) {
  const state = await readState(tx, partnerUserId, now);
  let recoveredCents = 0;
  const remainingCredit = new Map(state.credits.map((credit) => [credit.id, credit.amountCents - (state.recoveredByCredit.get(credit.id) ?? 0)]));
  for (const debt of state.debts) {
    let remainingDebt = -debt.amountCents - (state.recoveredByDebt.get(debt.id) ?? 0);
    for (const credit of state.credits) {
      if (remainingDebt === 0) break;
      const available = remainingCredit.get(credit.id) ?? 0;
      if (available === 0) continue;
      const amountCents = Math.min(remainingDebt, available);
      await tx.partnerDebtRecovery.create({ data: {
        partnerUserId, debtCommissionId: debt.id, creditCommissionId: credit.id, amountCents,
      } });
      remainingDebt -= amountCents;
      remainingCredit.set(credit.id, available - amountCents);
      recoveredCents += amountCents;
    }
  }
  return recoveredCents;
}

export async function getPartnerWithdrawableBalance(dependencies: Dependencies = {}) {
  const viewer = await requirePartner(dependencies);
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await assertPartnerRecord(tx, viewer);
    const state = await readState(tx, viewer.id, now);
    return {
      grossEligibleCents: state.grossEligibleCents,
      eligibleUnreservedCents: state.eligibleUnreservedCents,
      debtRecoveredCents: state.debtRecoveredCents,
      outstandingDebtCents: state.outstandingDebtCents,
      reservedCents: state.reservedCents,
      netEligibleCents: state.netEligibleCents,
      withdrawableCents: state.withdrawableCents,
      destinationReady: state.destinationReady,
      activeWithdrawalId: state.activeWithdrawal?.id ?? null,
      unresolvedLegacyPayoutId: state.unresolvedLegacyPayout?.id ?? null,
      disbursementsAllowed: state.disbursementsAllowed,
      minimumCents: MINIMUM_WITHDRAWAL_CENTS,
    };
  });
}

export async function recoverEligiblePartnerDebt(dependencies: Dependencies = {}) {
  const viewer = await requirePartner(dependencies);
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPartner(tx, viewer.id, now);
    await assertPartnerRecord(tx, viewer);
    const recoveredCents = await recoverDebtInTransaction(tx, viewer.id, now);
    const state = await readState(tx, viewer.id, now);
    return { recoveredCents, outstandingDebtCents: state.outstandingDebtCents };
  });
}

export async function requestPartnerWithdrawal(
  requestKey: string,
  dependencies: Dependencies = {},
) {
  const viewer = await requirePartner(dependencies);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) throw new Error("withdrawal_request_key_invalid");
  const now = dependencies.now ?? new Date();
  // Debt recovery is a separate, durable accounting operation. It must still
  // occur when the remaining balance is below the €50 withdrawal minimum.
  await recoverEligiblePartnerDebt({ ...dependencies, authenticate: async () => viewer, now });
  return prisma.$transaction(async (tx) => {
    await lockPartner(tx, viewer.id, now);
    await assertPartnerRecord(tx, viewer);
    const existing = await tx.partnerWithdrawal.findUnique({
      where: { partnerUserId_requestKey: { partnerUserId: viewer.id, requestKey } },
    });
    if (existing) return existing;
    await recoverDebtInTransaction(tx, viewer.id, now);
    const state = await readState(tx, viewer.id, now);
    if (state.activeWithdrawal) throw new Error("partner_withdrawal_already_active");
    if (state.unresolvedLegacyPayout) throw new Error("partner_legacy_payout_requires_review");
    if (!state.disbursementsAllowed) throw new Error("partner_real_payouts_paused");
    if (!state.destinationReady || !state.profile.stripeConnectedAccountId || !state.profile.stripeLastSyncedAt) {
      throw new Error("partner_stripe_destination_not_ready");
    }
    if (state.outstandingDebtCents !== 0) throw new Error("partner_debt_requires_review");
    if (state.withdrawableCents < MINIMUM_WITHDRAWAL_CENTS) throw new Error("partner_withdrawal_below_minimum");
    // The browser's reviewed amount is a comparison only. The ledger still
    // selects the full amount and exact commissions inside this transaction.
    if (dependencies.expectedAmountCents !== undefined &&
        state.withdrawableCents !== dependencies.expectedAmountCents) {
      throw new Error("withdrawal_balance_changed");
    }
    const allocations = state.credits.map((credit) => ({
      id: credit.id, amountCents: credit.amountCents - (state.recoveredByCredit.get(credit.id) ?? 0),
    })).filter((entry) => entry.amountCents > 0);
    if (sum(allocations.map((entry) => entry.amountCents)) !== state.withdrawableCents || !allocations.length) {
      throw new Error("partner_balance_invalid");
    }
    const withdrawal = await tx.partnerWithdrawal.create({ data: {
      partnerUserId: viewer.id, activePartnerUserId: viewer.id, requestKey,
      currency: "eur", grossEligibleCents: state.grossEligibleCents,
      debtRecoveredCents: state.debtRecoveredCents,
      requestedAmountCents: state.withdrawableCents, status: "REQUESTED",
      payoutMethod: "STRIPE", stripeConnectedAccountId: state.profile.stripeConnectedAccountId,
      destinationLast4: state.profile.stripePayoutAccountLast4,
      destinationVerifiedAt: state.profile.stripeLastSyncedAt,
    } });
    for (const allocation of allocations) {
      const reserved = await tx.partnerCommission.updateMany({
        where: { id: allocation.id, partnerUserId: viewer.id, currency: "eur", ...payableCommissionWhere(now) },
        data: { status: "RESERVED" },
      });
      if (reserved.count !== 1) throw new Error("commission_reservation_changed");
      await tx.partnerWithdrawalCommission.create({ data: {
        withdrawalId: withdrawal.id, commissionId: allocation.id, amountCents: allocation.amountCents,
      } });
    }
    await tx.partnerWithdrawalEvent.create({ data: {
      withdrawalId: withdrawal.id, toStatus: "REQUESTED", actorUserId: viewer.id, reason: "partner_requested_full_balance",
    } });
    return withdrawal;
  });
}

async function releaseWithdrawal(tx: Tx, withdrawalId: string, partnerUserId: string, now: Date) {
  const allocations = await tx.partnerWithdrawalCommission.findMany({
    where: { withdrawalId, releasedAt: null }, select: { id: true, commissionId: true },
  });
  if (!allocations.length) throw new Error("withdrawal_reservation_missing");
  for (const allocation of allocations) {
    const released = await tx.partnerCommission.updateMany({
      where: { id: allocation.commissionId, partnerUserId, status: "RESERVED", payoutId: null },
      data: { status: "AVAILABLE" },
    });
    if (released.count !== 1) throw new Error("withdrawal_reservation_changed");
    await tx.partnerWithdrawalCommission.update({ where: { id: allocation.id }, data: { releasedAt: now } });
  }
}

export async function cancelPartnerWithdrawal(
  withdrawalId: string,
  dependencies: Dependencies = {},
) {
  const viewer = await requirePartner(dependencies);
  const now = dependencies.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockPartner(tx, viewer.id, now);
    await assertPartnerRecord(tx, viewer);
    const withdrawal = await tx.partnerWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal || withdrawal.partnerUserId !== viewer.id) throw new Error("partner_withdrawal_not_authorized");
    if (withdrawal.status === "CANCELED") return withdrawal;
    if (!["REQUESTED", "READY_FOR_PROCESSING"].includes(withdrawal.status) ||
        withdrawal.providerStartedAt || withdrawal.payoutId || withdrawal.activePartnerUserId !== viewer.id) {
      throw new Error("partner_withdrawal_cannot_cancel");
    }
    await releaseWithdrawal(tx, withdrawal.id, viewer.id, now);
    const updated = await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
      status: "CANCELED", activePartnerUserId: null, canceledAt: now,
    } });
    await tx.partnerWithdrawalEvent.create({ data: {
      withdrawalId, fromStatus: withdrawal.status, toStatus: "CANCELED",
      actorUserId: viewer.id, reason: "partner_canceled_before_processing",
    } });
    return updated;
  });
}

/** Called in the same transaction as a commission reversal. No provider work. */
export async function invalidateWithdrawalForReversal(
  tx: Tx, partnerUserId: string, originalCommissionId: string,
  affectsBalance: boolean, now: Date, sourceEventId: string,
) {
  const withdrawal = await tx.partnerWithdrawal.findUnique({ where: { activePartnerUserId: partnerUserId } });
  if (!withdrawal) return;
  const allocated = await tx.partnerWithdrawalCommission.findFirst({
    where: { withdrawalId: withdrawal.id, commissionId: originalCommissionId, releasedAt: null }, select: { id: true },
  });
  if (!allocated && !affectsBalance) return;
  if (withdrawal.status === "REQUESTED" || withdrawal.status === "READY_FOR_PROCESSING") {
    if (withdrawal.providerStartedAt || withdrawal.payoutId) throw new Error("withdrawal_provider_state_conflict");
    await releaseWithdrawal(tx, withdrawal.id, partnerUserId, now);
    await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
      status: "INVALIDATED", activePartnerUserId: null, canceledAt: now,
      failureCode: "commission_reversed_before_processing",
    } });
    await tx.partnerWithdrawalEvent.create({ data: {
      withdrawalId: withdrawal.id, fromStatus: withdrawal.status, toStatus: "INVALIDATED",
      reason: `refund_or_dispute:${sourceEventId}`,
    } });
    return;
  }
  // Future Stage 2 provider states retain every reservation for reconciliation.
  if (withdrawal.status !== "OUTCOME_UNKNOWN") {
    await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
      status: "OUTCOME_UNKNOWN", failureCode: "commission_reversed_during_processing",
    } });
    await tx.partnerWithdrawalEvent.create({ data: {
      withdrawalId: withdrawal.id, fromStatus: withdrawal.status, toStatus: "OUTCOME_UNKNOWN",
      reason: `refund_or_dispute:${sourceEventId}`,
    } });
  }
}

export type WithdrawalState = PartnerWithdrawalStatus;
