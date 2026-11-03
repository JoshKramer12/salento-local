import crypto from "node:crypto";
import type { PartnerWithdrawal, Prisma } from "@prisma/client";
import { addUtcDays } from "@/lib/business-membership";
import { INITIAL_COMMISSION_HOLD_DAYS } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { areRealPartnerDisbursementsAllowed } from "@/lib/stripe";
import { sandboxWithdrawalExecutionAllowed, withdrawalPaymentLivemode } from "@/lib/partner-withdrawal-sandbox-context";
import {
  stripeWithdrawalProvider, type AccountEvidence, type PayoutEvidence,
  type TransferEvidence, type WithdrawalProvider,
} from "@/lib/partner-withdrawal-provider";

type Tx = Prisma.TransactionClient;
type Options = { provider?: WithdrawalProvider; now?: Date };
const LEASE_MS = 5 * 60 * 1000;
const ACCOUNT_SYNC_MS = 24 * 60 * 60 * 1000;

export function withdrawalExecutionAllowed() {
  return sandboxWithdrawalExecutionAllowed() ||
    (process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED === "true" &&
    areRealPartnerDisbursementsAllowed());
}

async function lockPartner(tx: Tx, partnerUserId: string, now: Date) {
  const changed = await tx.localPartnerProfile.updateMany({
    where: { userId: partnerUserId }, data: { updatedAt: now },
  });
  if (changed.count !== 1) throw new Error("partner_profile_missing");
}

async function recordEvent(tx: Tx, withdrawal: PartnerWithdrawal, toStatus: PartnerWithdrawal["status"], reason: string) {
  if (withdrawal.status === toStatus) return;
  await tx.partnerWithdrawalEvent.create({ data: {
    withdrawalId: withdrawal.id, fromStatus: withdrawal.status, toStatus, reason,
  } });
}

async function validateAllocations(tx: Tx, withdrawal: PartnerWithdrawal, now: Date) {
  const paymentLivemode = withdrawalPaymentLivemode(withdrawal.partnerUserId);
  const allocations = await tx.partnerWithdrawalCommission.findMany({
    where: { withdrawalId: withdrawal.id, releasedAt: null },
    include: { commission: {
      include: {
        payment: true,
        business: { include: { membership: true } },
        businessSubmission: true,
      },
    } },
  });
  if (!allocations.length ||
      allocations.reduce((total, allocation) => total + allocation.amountCents, 0) !== withdrawal.requestedAmountCents ||
      withdrawal.requestedAmountCents < 5000 || withdrawal.currency !== "eur" ||
      withdrawal.payoutMethod !== "STRIPE") throw new Error("withdrawal_allocation_conflict");

  const profile = await tx.localPartnerProfile.findUnique({
    where: { userId: withdrawal.partnerUserId },
    include: { user: { select: { role: true, profileCompleted: true } } },
  });
  if (!profile || profile.user.role !== "GETTER" || !profile.user.profileCompleted ||
      !profile.completedAt || !profile.partnerOnboardingCompletedAt ||
      profile.preferredPayoutMethod !== "STRIPE" ||
      profile.stripeConnectedAccountId !== withdrawal.stripeConnectedAccountId ||
      profile.stripePayoutAccountLast4 !== withdrawal.destinationLast4 ||
      profile.stripeAccountStatus !== "READY" || !profile.stripePayoutsEnabled ||
      !profile.stripeDetailsSubmitted || !profile.stripeOnboardingComplete ||
      !profile.stripeLastSyncedAt || profile.stripeLastSyncedAt > now ||
      now.getTime() - profile.stripeLastSyncedAt.getTime() > ACCOUNT_SYNC_MS) {
    throw new Error("withdrawal_destination_changed");
  }

  for (const allocation of allocations) {
    const credit = allocation.commission;
    const payment = credit.payment;
    if (allocation.amountCents <= 0 || credit.status !== "RESERVED" ||
        credit.type !== "COMMISSION" || credit.currency !== "eur" ||
        credit.partnerUserId !== withdrawal.partnerUserId ||
        credit.payoutId !== withdrawal.payoutId ||
        !payment || payment.status !== "PAID" || payment.stripeLivemode !== paymentLivemode ||
        payment.currency !== "eur" || payment.businessId !== credit.businessId ||
        payment.businessSubmissionId !== credit.businessSubmissionId ||
        !credit.business || !credit.businessSubmission ||
        credit.businessSubmission.userId !== withdrawal.partnerUserId ||
        credit.businessSubmission.createdBusinessId !== credit.businessId ||
        credit.business.membership?.originatingPartnerUserId !== withdrawal.partnerUserId ||
        !credit.eligibleAt || credit.eligibleAt > now ||
        (payment.purpose === "INITIAL_MEMBERSHIP" &&
          (!payment.paidAt || addUtcDays(payment.paidAt, INITIAL_COMMISSION_HOLD_DAYS) > now ||
           Boolean(payment.refundRequestedAt && payment.refundStatus !== "support_closed"))) ||
        !["INITIAL_MEMBERSHIP", "ANNUAL_RENEWAL", "REACTIVATION"].includes(payment.purpose)) {
      throw new Error("withdrawal_commission_no_longer_eligible");
    }
    const recovered = await tx.partnerDebtRecovery.aggregate({
      where: { creditCommissionId: credit.id, voidedAt: null }, _sum: { amountCents: true },
    });
    if (credit.amountCents - (recovered._sum.amountCents ?? 0) !== allocation.amountCents) {
      throw new Error("withdrawal_recovery_allocation_changed");
    }
  }
  const debts = await tx.partnerCommission.findMany({
    where: { partnerUserId: withdrawal.partnerUserId, type: "REVERSAL", status: "DEBT" },
    select: { id: true, amountCents: true },
  });
  for (const debt of debts) {
    const recovered = await tx.partnerDebtRecovery.aggregate({
      where: { debtCommissionId: debt.id, voidedAt: null }, _sum: { amountCents: true },
    });
    if (-debt.amountCents - (recovered._sum.amountCents ?? 0) > 0) {
      throw new Error("withdrawal_debt_reopened");
    }
  }
  const unresolvedLegacy = await tx.partnerPayout.findFirst({
    where: { partnerUserId: withdrawal.partnerUserId, id: { not: withdrawal.payoutId ?? undefined },
      OR: [{ status: { in: ["SCHEDULED", "PROCESSING", "FAILED", "CANCELED"] } },
        { status: "ACTION_REQUIRED", attemptCount: { gt: 0 } }],
    }, select: { id: true },
  });
  if (unresolvedLegacy) throw new Error("withdrawal_legacy_payout_unresolved");
  return { allocations, profile };
}

async function invalidateBeforeProvider(tx: Tx, withdrawal: PartnerWithdrawal, now: Date, reason: string) {
  if (withdrawal.providerStartedAt || withdrawal.payoutId) throw new Error("withdrawal_provider_state_conflict");
  const allocations = await tx.partnerWithdrawalCommission.findMany({
    where: { withdrawalId: withdrawal.id, releasedAt: null },
  });
  for (const allocation of allocations) {
    const released = await tx.partnerCommission.updateMany({
      where: { id: allocation.commissionId, partnerUserId: withdrawal.partnerUserId, status: "RESERVED", payoutId: null },
      data: { status: "AVAILABLE" },
    });
    if (released.count !== 1) throw new Error("withdrawal_reservation_changed");
    await tx.partnerWithdrawalCommission.update({ where: { id: allocation.id }, data: { releasedAt: now } });
  }
  await recordEvent(tx, withdrawal, "INVALIDATED", reason);
  await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
    status: "INVALIDATED", activePartnerUserId: null, canceledAt: now, failureCode: reason,
  } });
}

async function freezeNewerWithdrawal(tx: Tx, older: PartnerWithdrawal, now: Date, reason: string) {
  const newer = await tx.partnerWithdrawal.findUnique({
    where: { activePartnerUserId: older.partnerUserId },
  });
  if (!newer || newer.id === older.id) return;
  if (["REQUESTED", "READY_FOR_PROCESSING"].includes(newer.status) &&
      !newer.providerStartedAt && !newer.payoutId) {
    await invalidateBeforeProvider(tx, newer, now, reason);
  } else {
    await recordEvent(tx, newer, "OUTCOME_UNKNOWN", reason);
    await tx.partnerWithdrawal.update({ where: { id: newer.id }, data: {
      status: "OUTCOME_UNKNOWN", failureCode: reason,
    } });
  }
}

function checkAccount(account: AccountEvidence, withdrawal: PartnerWithdrawal) {
  if (account.id !== withdrawal.stripeConnectedAccountId ||
      !account.payoutsEnabled || !account.detailsSubmitted ||
      account.livemode !== withdrawalPaymentLivemode(withdrawal.partnerUserId) ||
      !account.externalAccountId || account.externalAccountLast4 !== withdrawal.destinationLast4 ||
      (withdrawal.destinationExternalAccountId &&
        withdrawal.destinationExternalAccountId !== account.externalAccountId)) {
    throw new Error("withdrawal_provider_destination_unverified");
  }
  return account.externalAccountId;
}

function checkTransfer(evidence: TransferEvidence, withdrawal: PartnerWithdrawal, payoutId: string) {
  if (evidence.withdrawalId !== withdrawal.id || evidence.payoutId !== payoutId ||
      evidence.amountCents !== withdrawal.requestedAmountCents ||
      evidence.currency !== withdrawal.currency ||
      evidence.destination !== withdrawal.stripeConnectedAccountId ||
      evidence.livemode !== withdrawalPaymentLivemode(withdrawal.partnerUserId) ||
      evidence.amountReversedCents < 0 || evidence.amountReversedCents > evidence.amountCents) {
    throw new Error("withdrawal_transfer_evidence_mismatch");
  }
}

function checkPayout(evidence: PayoutEvidence, withdrawal: PartnerWithdrawal, payoutId: string) {
  if (evidence.withdrawalId !== withdrawal.id || evidence.payoutId !== payoutId ||
      evidence.amountCents !== withdrawal.requestedAmountCents ||
      evidence.currency !== withdrawal.currency ||
      evidence.connectedAccountId !== withdrawal.stripeConnectedAccountId ||
      evidence.livemode !== withdrawalPaymentLivemode(withdrawal.partnerUserId) ||
      evidence.destinationExternalAccountId !== withdrawal.destinationExternalAccountId) {
    throw new Error("withdrawal_payout_evidence_mismatch");
  }
}

async function setUncertain(withdrawalId: string, attemptId: string, code: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    const attempt = await tx.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status === "SUCCEEDED") return;
    await tx.partnerWithdrawalAttempt.update({ where: { id: attemptId }, data: {
      status: "OUTCOME_UNKNOWN", errorCode: code,
    } });
    await recordEvent(tx, withdrawal, "OUTCOME_UNKNOWN", code);
    await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
      status: "OUTCOME_UNKNOWN", failureCode: code, leaseOwner: null, leaseExpiresAt: null,
    } });
  });
}

async function saveTransfer(withdrawalId: string, attemptId: string, evidence: TransferEvidence, now: Date) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    if (!withdrawal.payoutId) throw new Error("withdrawal_execution_missing");
    checkTransfer(evidence, withdrawal, withdrawal.payoutId);
    const attempt = await tx.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.providerObjectId && attempt.providerObjectId !== evidence.id) throw new Error("withdrawal_transfer_identity_conflict");
    if (withdrawal.status === "FAILED_CONFIRMED") return withdrawal;
    await tx.partnerWithdrawalAttempt.update({ where: { id: attemptId }, data: {
      status: evidence.amountReversedCents > 0 || attempt.status === "ACTION_REQUIRED"
        ? "ACTION_REQUIRED" : "SUCCEEDED",
      providerObjectId: evidence.id, lastReconciledAt: now,
    } });
    const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: withdrawal.payoutId } });
    await tx.partnerPayout.update({ where: { id: withdrawal.payoutId }, data: {
      stripeTransferId: evidence.id,
      ...(["PAID", "ACTION_REQUIRED"].includes(payout.status) ? {} : { status: "PROCESSING" }),
    } });
    await tx.partnerCommission.updateMany({ where: {
      payoutId: withdrawal.payoutId, status: "RESERVED",
    }, data: { stripeTransferId: evidence.id, transferredAt: now } });
    if (evidence.amountReversedCents > 0) {
      await recordEvent(tx, withdrawal, "ACTION_REQUIRED", "transfer_partially_or_fully_reversed");
      await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
        status: "ACTION_REQUIRED", failureCode: "transfer_reversed", leaseOwner: null, leaseExpiresAt: null,
      } });
    }
    return withdrawal;
  });
}

async function savePayout(withdrawalId: string, attemptId: string, evidence: PayoutEvidence, now: Date) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    if (!withdrawal.payoutId) throw new Error("withdrawal_execution_missing");
    checkPayout(evidence, withdrawal, withdrawal.payoutId);
    const attempt = await tx.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (evidence.attemptId !== attempt.id) throw new Error("withdrawal_payout_attempt_mismatch");
    const latest = await tx.partnerWithdrawalAttempt.findFirstOrThrow({
      where: { withdrawalId, operation: "PAYOUT" }, orderBy: { sequence: "desc" },
    });
    if (latest.id !== attempt.id) {
      if (evidence.status === "paid") {
        await freezeNewerWithdrawal(tx, withdrawal, now, "older_bank_payout_later_paid");
        await recordEvent(tx, withdrawal, "ACTION_REQUIRED", "older_bank_payout_later_paid");
        await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
          status: "ACTION_REQUIRED", failureCode: "older_bank_payout_later_paid",
        } });
      }
      return withdrawal;
    }
    if (withdrawal.status === "PAID") return withdrawal;
    if (attempt.providerObjectId && attempt.providerObjectId !== evidence.id) throw new Error("withdrawal_payout_identity_conflict");
    const transfer = await tx.partnerWithdrawalAttempt.findFirst({ where: {
      withdrawalId, operation: "TRANSFER", status: "SUCCEEDED",
    } });
    if (!transfer?.providerObjectId) throw new Error("withdrawal_transfer_unconfirmed");
    await tx.partnerWithdrawalAttempt.update({ where: { id: attemptId }, data: {
      status: attempt.status === "ACTION_REQUIRED" && evidence.status !== "paid"
        ? "ACTION_REQUIRED" : "SUCCEEDED",
      providerObjectId: evidence.id, lastReconciledAt: now,
    } });
    const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: withdrawal.payoutId } });
    await tx.partnerPayout.update({ where: { id: withdrawal.payoutId }, data: {
      stripePayoutId: evidence.id, attemptCount: attempt.sequence,
      ...(["PAID", "ACTION_REQUIRED"].includes(payout.status) ? {} : { status: "PROCESSING" }),
    } });
    await tx.partnerCommission.updateMany({ where: {
      payoutId: withdrawal.payoutId, status: "RESERVED",
    }, data: { stripePayoutId: evidence.id } });
    return withdrawal;
  });
}

async function settleConfirmedTransferReversal(
  withdrawalId: string, transferEvidence: TransferEvidence, reversalId: string | null, now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    if (!withdrawal.payoutId) throw new Error("withdrawal_execution_missing");
    checkTransfer(transferEvidence, withdrawal, withdrawal.payoutId);
    if (transferEvidence.amountReversedCents !== withdrawal.requestedAmountCents) {
      throw new Error("withdrawal_transfer_not_fully_reversed");
    }
    if (await tx.partnerWithdrawalAttempt.count({ where: { withdrawalId, operation: "PAYOUT" } })) {
      throw new Error("withdrawal_bank_payout_may_be_in_flight");
    }
    const attempt = await tx.partnerWithdrawalAttempt.findFirstOrThrow({
      where: { withdrawalId, operation: "TRANSFER_REVERSAL" },
    });
    if (attempt.providerObjectId && reversalId && attempt.providerObjectId !== reversalId) {
      throw new Error("withdrawal_reversal_identity_conflict");
    }
    await tx.partnerWithdrawalAttempt.update({ where: { id: attempt.id }, data: {
      status: "SUCCEEDED", providerObjectId: reversalId ?? attempt.providerObjectId,
      lastReconciledAt: now,
    } });
    if (withdrawal.status === "FAILED_CONFIRMED") return withdrawal;
    const allocations = await tx.partnerWithdrawalCommission.findMany({
      where: { withdrawalId, releasedAt: null }, include: { commission: true },
    });
    if (!allocations.length || allocations.reduce((sum, item) => sum + item.amountCents, 0) !== withdrawal.requestedAmountCents) {
      throw new Error("withdrawal_allocation_conflict");
    }
    for (const allocation of allocations) {
      if (allocation.commission.status === "RESERVED") {
        const released = await tx.partnerCommission.updateMany({ where: {
          id: allocation.commissionId, status: "RESERVED", payoutId: withdrawal.payoutId,
        }, data: { status: "AVAILABLE", payoutId: null, stripeTransferId: null, transferredAt: null } });
        if (released.count !== 1) throw new Error("withdrawal_reservation_changed");
      } else if (allocation.commission.status !== "REVERSED") {
        throw new Error("withdrawal_settlement_commission_conflict");
      }
      await tx.partnerWithdrawalCommission.update({ where: { id: allocation.id }, data: { releasedAt: now } });
    }
    await tx.partnerPayout.update({ where: { id: withdrawal.payoutId }, data: {
      status: "FAILED", failedAt: now, failureMessage: "Transfer fully reversed before bank payout",
    } });
    const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: withdrawal.payoutId } });
    await tx.partnerPayoutRun.update({ where: { id: payout.payoutRunId }, data: {
      status: "FAILED", completedAt: now,
    } });
    await recordEvent(tx, withdrawal, "FAILED_CONFIRMED", "stripe_transfer_fully_reversed");
    return tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
      status: "FAILED_CONFIRMED", activePartnerUserId: null,
      completedAt: now, leaseOwner: null, leaseExpiresAt: null,
      failureCode: "transfer_fully_reversed",
    } });
  });
}

async function settlePayout(evidence: PayoutEvidence, now: Date) {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUnique({ where: { id: evidence.withdrawalId } });
    if (!withdrawal?.payoutId) throw new Error("withdrawal_webhook_unmatched");
    await lockPartner(tx, withdrawal.partnerUserId, now);
    checkPayout(evidence, withdrawal, withdrawal.payoutId);
    const attempt = await tx.partnerWithdrawalAttempt.findFirst({ where: {
      id: evidence.attemptId, withdrawalId: withdrawal.id, operation: "PAYOUT", providerObjectId: evidence.id,
    } });
    const latest = await tx.partnerWithdrawalAttempt.findFirst({
      where: { withdrawalId: withdrawal.id, operation: "PAYOUT" }, orderBy: { sequence: "desc" },
    });
    if (attempt && latest?.id !== attempt.id) {
      if (evidence.status === "paid") {
        await recordEvent(tx, withdrawal, "ACTION_REQUIRED", "older_bank_payout_later_paid");
        await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
          status: "ACTION_REQUIRED", failureCode: "older_bank_payout_later_paid",
        } });
      }
      return withdrawal;
    }
    const transfer = await tx.partnerWithdrawalAttempt.findFirst({ where: {
      withdrawalId: withdrawal.id, operation: "TRANSFER", status: "SUCCEEDED",
    } });
    if (!attempt || !transfer?.providerObjectId) throw new Error("withdrawal_provider_evidence_incomplete");
    if (evidence.status === "paid") {
      if (withdrawal.status === "PAID") return withdrawal;
      const allocations = await tx.partnerWithdrawalCommission.findMany({ where: {
        withdrawalId: withdrawal.id, releasedAt: null,
      }, include: { commission: true } });
      if (!allocations.length ||
          allocations.reduce((total, item) => total + item.amountCents, 0) !== withdrawal.requestedAmountCents) {
        throw new Error("withdrawal_allocation_conflict");
      }
      for (const allocation of allocations) {
        const credit = allocation.commission;
        if (credit.status !== "RESERVED" && credit.status !== "REVERSED") {
          throw new Error("withdrawal_settlement_commission_conflict");
        }
        if (credit.status === "REVERSED") {
          const reversal = await tx.partnerCommission.findUnique({
            where: { sourceKey: `commission:reversal:${credit.id}` },
          });
          if (!reversal || reversal.status !== "REVERSED") throw new Error("withdrawal_reversal_missing");
          await tx.partnerCommission.update({ where: { id: reversal.id }, data: { status: "DEBT" } });
        }
        await tx.partnerCommission.update({ where: { id: credit.id }, data: {
          status: "PAID", payoutId: withdrawal.payoutId, paidAt: now,
          stripeTransferId: transfer.providerObjectId, stripePayoutId: evidence.id,
        } });
      }
      await tx.partnerPayout.update({ where: { id: withdrawal.payoutId }, data: {
        status: "PAID", paidAt: now, stripePayoutId: evidence.id,
      } });
      const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: withdrawal.payoutId } });
      await tx.partnerPayoutRun.update({ where: { id: payout.payoutRunId }, data: {
        status: "COMPLETED", completedAt: now,
      } });
      await recordEvent(tx, withdrawal, "PAID", "stripe_payout_paid_verified");
      return tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
        status: "PAID", activePartnerUserId: null, completedAt: now,
        leaseOwner: null, leaseExpiresAt: null, failureCode: null,
      } });
    }
    if (evidence.status === "failed" || evidence.status === "canceled") {
      if (withdrawal.status === "PAID") {
        // Stripe can report a late bank failure after payout.paid. Retain the
        // paid ledger and freeze new requests pending evidence-backed repair.
        await freezeNewerWithdrawal(tx, withdrawal, now, "older_bank_payout_later_failed");
        await recordEvent(tx, withdrawal, "ACTION_REQUIRED", "late_bank_payout_failure");
        await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
          status: "ACTION_REQUIRED", failureCode: "late_bank_payout_failure",
        } });
      } else {
        await recordEvent(tx, withdrawal, "ACTION_REQUIRED", `bank_payout_${evidence.status}`);
        await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
          status: "ACTION_REQUIRED", failureCode: `bank_payout_${evidence.status}`,
          leaseOwner: null, leaseExpiresAt: null,
        } });
      }
      await tx.partnerWithdrawalAttempt.update({ where: { id: attempt.id }, data: {
        status: "ACTION_REQUIRED", errorCode: `bank_payout_${evidence.status}`, lastReconciledAt: now,
      } });
      await tx.partnerPayout.update({ where: { id: withdrawal.payoutId }, data: {
        status: "ACTION_REQUIRED", actionRequiredAt: now,
      } });
      const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: withdrawal.payoutId } });
      await tx.partnerPayoutRun.update({ where: { id: payout.payoutRunId }, data: {
        status: "FAILED", completedAt: now,
      } });
    }
    return withdrawal;
  });
}

async function checkBeforeExternal(
  withdrawalId: string, attemptId: string, leaseOwner: string,
  account: AccountEvidence, now: Date,
) {
  await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    if (withdrawal.status !== "PROCESSING" || withdrawal.leaseOwner !== leaseOwner ||
        !withdrawal.leaseExpiresAt || withdrawal.leaseExpiresAt <= now) {
      throw new Error("withdrawal_processing_claim_lost");
    }
    const attempt = await tx.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== "INTENT" || attempt.providerObjectId) throw new Error("withdrawal_attempt_changed");
    const externalAccountId = checkAccount(account, withdrawal);
    await validateAllocations(tx, withdrawal, now);
    if (!withdrawal.destinationExternalAccountId) {
      if (attempt.operation !== "TRANSFER") throw new Error("withdrawal_destination_snapshot_missing");
      await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
        destinationExternalAccountId: externalAccountId,
      } });
    }
  });
}

export async function processPartnerWithdrawal(withdrawalId: string, options: Options = {}) {
  if (!withdrawalExecutionAllowed()) throw new Error("withdrawal_processing_paused");
  const now = options.now ?? new Date();
  const provider = options.provider ?? stripeWithdrawalProvider;
  const leaseOwner = crypto.randomUUID();
  const claim = await prisma.$transaction(async (tx) => {
    let withdrawal = await tx.partnerWithdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new Error("withdrawal_not_found");
    await lockPartner(tx, withdrawal.partnerUserId, now);
    withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    if (withdrawal.status === "PAID" || withdrawal.status === "CANCELED" || withdrawal.status === "INVALIDATED") {
      return { kind: "terminal" as const };
    }
    if (withdrawal.leaseExpiresAt && withdrawal.leaseExpiresAt > now) return { kind: "leased" as const };
    if (withdrawal.status === "OUTCOME_UNKNOWN" || withdrawal.status === "ACTION_REQUIRED") return { kind: "reconcile" as const };
    const attempts = await tx.partnerWithdrawalAttempt.findMany({
      where: { withdrawalId }, orderBy: [{ operation: "asc" }, { sequence: "desc" }],
    });
    const transfer = attempts.find((item) => item.operation === "TRANSFER");
    const payoutAttempt = attempts.find((item) => item.operation === "PAYOUT");
    if (payoutAttempt) return { kind: "reconcile" as const };
    if (transfer && transfer.status !== "SUCCEEDED") return { kind: "reconcile" as const };
    try {
      await validateAllocations(tx, withdrawal, now);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "withdrawal_preflight_failed";
      if (!withdrawal.providerStartedAt && !withdrawal.payoutId) {
        await invalidateBeforeProvider(tx, withdrawal, now, reason);
        return { kind: "invalidated" as const };
      }
      await recordEvent(tx, withdrawal, "ACTION_REQUIRED", reason);
      await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
        status: "ACTION_REQUIRED", failureCode: reason, leaseOwner: null, leaseExpiresAt: null,
      } });
      return { kind: "reconcile" as const };
    }
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    if (!transfer) {
      const run = await tx.partnerPayoutRun.create({ data: {
        runKey: `withdrawal:${withdrawal.id}`, scheduledFor: now, status: "RUNNING",
      } });
      const payout = await tx.partnerPayout.create({ data: {
        payoutRunId: run.id, partnerUserId: withdrawal.partnerUserId,
        amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
        status: "SCHEDULED", payoutMethod: "STRIPE",
        stripeConnectedAccountId: withdrawal.stripeConnectedAccountId,
      } });
      const allocations = await tx.partnerWithdrawalCommission.findMany({
        where: { withdrawalId, releasedAt: null }, select: { commissionId: true },
      });
      const changed = await tx.partnerCommission.updateMany({ where: {
        id: { in: allocations.map((item) => item.commissionId) },
        partnerUserId: withdrawal.partnerUserId, status: "RESERVED", payoutId: null,
      }, data: { payoutId: payout.id } });
      if (changed.count !== allocations.length) throw new Error("withdrawal_reservation_changed");
      await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
        payoutId: payout.id, status: "PROCESSING", providerStartedAt: now,
        leaseOwner, leaseExpiresAt,
      } });
      const attempt = await tx.partnerWithdrawalAttempt.create({ data: {
        withdrawalId, operation: "TRANSFER", sequence: 1,
        idempotencyKey: `cashout-transfer-v1-${withdrawalId}`,
        connectedAccountId: withdrawal.stripeConnectedAccountId,
        amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
      } });
      await recordEvent(tx, withdrawal, "PROCESSING", "transfer_intent_recorded");
      return { kind: "transfer" as const, attemptId: attempt.id, payoutId: payout.id };
    }
    if (!withdrawal.payoutId || !transfer.providerObjectId) throw new Error("withdrawal_transfer_unconfirmed");
    await tx.partnerWithdrawal.update({ where: { id: withdrawal.id }, data: {
      leaseOwner, leaseExpiresAt,
    } });
    const attempt = await tx.partnerWithdrawalAttempt.create({ data: {
      withdrawalId, operation: "PAYOUT", sequence: 1,
      idempotencyKey: `cashout-payout-v1-${withdrawalId}-1`,
      connectedAccountId: withdrawal.stripeConnectedAccountId,
      amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
    } });
    return { kind: "payout" as const, attemptId: attempt.id, payoutId: withdrawal.payoutId };
  });
  if (claim.kind !== "transfer" && claim.kind !== "payout") return claim.kind;
  const withdrawal = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  const attempt = await prisma.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } });
  try {
    const account = await provider.account(withdrawal.stripeConnectedAccountId);
    const externalAccountId = checkAccount(account, withdrawal);
    await checkBeforeExternal(withdrawalId, attempt.id, leaseOwner, account, new Date());
    if (!withdrawalExecutionAllowed()) throw new Error("withdrawal_processing_paused");
    if (claim.kind === "transfer") {
      const evidence = await provider.createTransfer({
        withdrawalId, payoutId: claim.payoutId,
        amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
        connectedAccountId: withdrawal.stripeConnectedAccountId,
        idempotencyKey: attempt.idempotencyKey,
      });
      await saveTransfer(withdrawalId, attempt.id, evidence, new Date());
    } else {
      if (withdrawal.destinationExternalAccountId !== externalAccountId) throw new Error("withdrawal_destination_changed");
      const evidence = await provider.createPayout({
        withdrawalId, payoutId: claim.payoutId, attemptId: attempt.id,
        amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
        connectedAccountId: withdrawal.stripeConnectedAccountId, externalAccountId,
        idempotencyKey: attempt.idempotencyKey,
      });
      await savePayout(withdrawalId, attempt.id, evidence, new Date());
      if (evidence.status === "paid" || evidence.status === "failed" || evidence.status === "canceled") {
        await settlePayout(evidence, new Date());
      }
    }
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9_]{2,100}$/.test(error.message)
      ? error.message : "provider_outcome_unknown";
    await setUncertain(withdrawalId, attempt.id, code, new Date());
    return "outcome_unknown";
  } finally {
    await prisma.partnerWithdrawal.updateMany({ where: { id: withdrawalId, leaseOwner }, data: {
      leaseOwner: null, leaseExpiresAt: null,
    } });
  }
  if (claim.kind === "transfer") return processPartnerWithdrawal(withdrawalId, options);
  return "processing";
}

export async function reconcilePartnerWithdrawal(withdrawalId: string, options: Options = {}) {
  const provider = options.provider ?? stripeWithdrawalProvider;
  const now = options.now ?? new Date();
  const withdrawal = await prisma.partnerWithdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal?.payoutId) throw new Error("withdrawal_execution_missing");
  const attempts = await prisma.partnerWithdrawalAttempt.findMany({
    where: { withdrawalId }, orderBy: { sequence: "desc" },
  });
  const transfer = attempts.find((item) => item.operation === "TRANSFER");
  if (!transfer) throw new Error("withdrawal_transfer_intent_missing");
  const transferMatches = transfer.providerObjectId
    ? [await provider.retrieveTransfer(transfer.providerObjectId)]
    : await provider.findTransfers(withdrawalId);
  if (transferMatches.length !== 1) {
    await setUncertain(withdrawalId, transfer.id, "transfer_requires_operator_reconciliation", now);
    return "outcome_unknown";
  }
  await saveTransfer(withdrawalId, transfer.id, transferMatches[0], now);
  const reversalAttempt = attempts.find((item) => item.operation === "TRANSFER_REVERSAL");
  if (reversalAttempt) {
    if (transferMatches[0].amountReversedCents === withdrawal.requestedAmountCents) {
      await settleConfirmedTransferReversal(
        withdrawalId, transferMatches[0], reversalAttempt.providerObjectId, now,
      );
      return "transfer_reversed";
    }
    return "reversal_requires_operator_reconciliation";
  }
  const payoutAttempt = attempts.find((item) => item.operation === "PAYOUT");
  if (!payoutAttempt) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      await lockPartner(tx, fresh.partnerUserId, now);
      if (fresh.status === "OUTCOME_UNKNOWN" && fresh.failureCode !== "commission_reversed_during_processing") {
        try {
          await validateAllocations(tx, fresh, now);
          await recordEvent(tx, fresh, "PROCESSING", "transfer_evidence_reconciled");
          await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
            status: "PROCESSING", failureCode: null,
          } });
        } catch {
          await recordEvent(tx, fresh, "ACTION_REQUIRED", "post_transfer_eligibility_changed");
          await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
            status: "ACTION_REQUIRED", failureCode: "post_transfer_eligibility_changed",
          } });
        }
      }
    });
    return "transfer_confirmed";
  }
  const payoutMatches = payoutAttempt.providerObjectId
    ? [await provider.retrievePayout(withdrawal.stripeConnectedAccountId, payoutAttempt.providerObjectId)]
    : await provider.findPayouts(withdrawal.stripeConnectedAccountId, payoutAttempt.requestedAt, withdrawalId, payoutAttempt.id);
  if (payoutMatches.length !== 1) {
    await setUncertain(withdrawalId, payoutAttempt.id, "payout_requires_operator_reconciliation", now);
    return "outcome_unknown";
  }
  await savePayout(withdrawalId, payoutAttempt.id, payoutMatches[0], now);
  await settlePayout(payoutMatches[0], now);
  return payoutMatches[0].status;
}

export async function requestPartnerTransferReversal(
  withdrawalId: string, options: Options = {},
) {
  if (process.env.PARTNER_WITHDRAWAL_REVERSAL_ENABLED !== "true") {
    throw new Error("withdrawal_reversal_paused");
  }
  const provider = options.provider ?? stripeWithdrawalProvider;
  const now = options.now ?? new Date();
  const claim = await prisma.$transaction(async (tx) => {
    const withdrawal = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, withdrawal.partnerUserId, now);
    if (!withdrawal.payoutId || !["ACTION_REQUIRED", "OUTCOME_UNKNOWN"].includes(withdrawal.status)) {
      throw new Error("withdrawal_reversal_not_allowed");
    }
    const transfer = await tx.partnerWithdrawalAttempt.findFirst({ where: {
      withdrawalId, operation: "TRANSFER", status: "SUCCEEDED",
    } });
    if (!transfer?.providerObjectId ||
        await tx.partnerWithdrawalAttempt.count({ where: { withdrawalId, operation: "PAYOUT" } })) {
      throw new Error("withdrawal_reversal_not_allowed");
    }
    const existing = await tx.partnerWithdrawalAttempt.findFirst({ where: {
      withdrawalId, operation: "TRANSFER_REVERSAL",
    } });
    if (existing) return { kind: "reconcile" as const };
    const attempt = await tx.partnerWithdrawalAttempt.create({ data: {
      withdrawalId, operation: "TRANSFER_REVERSAL", sequence: 1,
      idempotencyKey: `cashout-reversal-v1-${withdrawalId}`,
      connectedAccountId: withdrawal.stripeConnectedAccountId,
      amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
    } });
    return { kind: "reverse" as const, attemptId: attempt.id, transferId: transfer.providerObjectId };
  });
  if (claim.kind === "reconcile") return "reconcile";
  try {
    const withdrawal = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    const transfer = await provider.retrieveTransfer(claim.transferId);
    checkTransfer(transfer, withdrawal, withdrawal.payoutId!);
    if (transfer.amountReversedCents !== 0) throw new Error("withdrawal_transfer_already_reversed");
    const attempt = await prisma.partnerWithdrawalAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } });
    const result = await provider.reverseTransfer({
      transferId: claim.transferId, amountCents: withdrawal.requestedAmountCents,
      idempotencyKey: attempt.idempotencyKey,
    });
    checkTransfer(result.transfer, withdrawal, withdrawal.payoutId!);
    await settleConfirmedTransferReversal(withdrawalId, result.transfer, result.reversalId, new Date());
    return "transfer_reversed";
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9_]{2,100}$/.test(error.message)
      ? error.message : "reversal_outcome_unknown";
    await setUncertain(withdrawalId, claim.attemptId, code, new Date());
    return "outcome_unknown";
  }
}

export async function requestPartnerPayoutRetry(
  withdrawalId: string, options: Options = {},
) {
  if (process.env.PARTNER_WITHDRAWAL_RETRY_ENABLED !== "true" || !withdrawalExecutionAllowed()) {
    throw new Error("withdrawal_payout_retry_paused");
  }
  const provider = options.provider ?? stripeWithdrawalProvider;
  const now = options.now ?? new Date();
  const withdrawal = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  if (!withdrawal.payoutId || withdrawal.status !== "ACTION_REQUIRED") {
    throw new Error("withdrawal_payout_retry_not_allowed");
  }
  const previous = await prisma.partnerWithdrawalAttempt.findFirstOrThrow({
    where: { withdrawalId, operation: "PAYOUT" }, orderBy: { sequence: "desc" },
  });
  const transfer = await prisma.partnerWithdrawalAttempt.findFirstOrThrow({
    where: { withdrawalId, operation: "TRANSFER", status: "SUCCEEDED" },
  });
  if (!previous.providerObjectId || !transfer.providerObjectId ||
      previous.status !== "ACTION_REQUIRED") throw new Error("withdrawal_payout_retry_not_allowed");
  const previousEvidence = await provider.retrievePayout(
    withdrawal.stripeConnectedAccountId, previous.providerObjectId,
  );
  checkPayout(previousEvidence, withdrawal, withdrawal.payoutId);
  if (previousEvidence.attemptId !== previous.id || previousEvidence.status !== "failed" ||
      !previousEvidence.failureBalanceTransactionId) {
    throw new Error("withdrawal_payout_failure_not_confirmed");
  }
  const transferEvidence = await provider.retrieveTransfer(transfer.providerObjectId);
  checkTransfer(transferEvidence, withdrawal, withdrawal.payoutId);
  if (transferEvidence.amountReversedCents !== 0) throw new Error("withdrawal_transfer_reversed");
  const account = await provider.account(withdrawal.stripeConnectedAccountId);
  checkAccount(account, withdrawal);
  const leaseOwner = crypto.randomUUID();
  const newAttempt = await prisma.$transaction(async (tx) => {
    const fresh = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    await lockPartner(tx, fresh.partnerUserId, now);
    if (fresh.status !== "ACTION_REQUIRED" || fresh.payoutId !== withdrawal.payoutId ||
        (fresh.leaseExpiresAt && fresh.leaseExpiresAt > now)) {
      throw new Error("withdrawal_payout_retry_claim_changed");
    }
    const latest = await tx.partnerWithdrawalAttempt.findFirstOrThrow({
      where: { withdrawalId, operation: "PAYOUT" }, orderBy: { sequence: "desc" },
    });
    if (latest.id !== previous.id || latest.status !== "ACTION_REQUIRED") {
      throw new Error("withdrawal_payout_retry_claim_changed");
    }
    await validateAllocations(tx, fresh, now);
    const attempt = await tx.partnerWithdrawalAttempt.create({ data: {
      withdrawalId, operation: "PAYOUT", sequence: latest.sequence + 1,
      idempotencyKey: `cashout-payout-v1-${withdrawalId}-${latest.sequence + 1}`,
      connectedAccountId: fresh.stripeConnectedAccountId,
      amountCents: fresh.requestedAmountCents, currency: fresh.currency,
    } });
    await recordEvent(tx, fresh, "PROCESSING", "confirmed_failed_bank_payout_retry_intent");
    await tx.partnerWithdrawal.update({ where: { id: withdrawalId }, data: {
      status: "PROCESSING", failureCode: null, leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    } });
    await tx.partnerPayout.update({ where: { id: fresh.payoutId! }, data: { status: "PROCESSING" } });
    const payout = await tx.partnerPayout.findUniqueOrThrow({ where: { id: fresh.payoutId! } });
    await tx.partnerPayoutRun.update({ where: { id: payout.payoutRunId }, data: {
      status: "RUNNING", completedAt: null,
    } });
    return attempt;
  });
  try {
    await checkBeforeExternal(withdrawalId, newAttempt.id, leaseOwner, account, new Date());
    if (!withdrawalExecutionAllowed()) throw new Error("withdrawal_processing_paused");
    const evidence = await provider.createPayout({
      withdrawalId, payoutId: withdrawal.payoutId, attemptId: newAttempt.id,
      amountCents: withdrawal.requestedAmountCents, currency: withdrawal.currency,
      connectedAccountId: withdrawal.stripeConnectedAccountId,
      externalAccountId: withdrawal.destinationExternalAccountId!,
      idempotencyKey: newAttempt.idempotencyKey,
    });
    await savePayout(withdrawalId, newAttempt.id, evidence, new Date());
    if (["paid", "failed", "canceled"].includes(evidence.status)) {
      await settlePayout(evidence, new Date());
    }
    return "processing";
  } catch (error) {
    const code = error instanceof Error && /^[a-z][a-z0-9_]{2,100}$/.test(error.message)
      ? error.message : "payout_retry_outcome_unknown";
    await setUncertain(withdrawalId, newAttempt.id, code, new Date());
    return "outcome_unknown";
  } finally {
    await prisma.partnerWithdrawal.updateMany({ where: { id: withdrawalId, leaseOwner }, data: {
      leaseOwner: null, leaseExpiresAt: null,
    } });
  }
}

export async function handleWithdrawalPayoutEvent(evidence: PayoutEvidence, options: Options = {}) {
  const provider = options.provider ?? stripeWithdrawalProvider;
  const withdrawal = await prisma.partnerWithdrawal.findUnique({ where: { id: evidence.withdrawalId } });
  if (!withdrawal?.payoutId) throw new Error("withdrawal_webhook_unmatched");
  checkPayout(evidence, withdrawal, withdrawal.payoutId);
  const current = await provider.retrievePayout(evidence.connectedAccountId, evidence.id);
  checkPayout(current, withdrawal, withdrawal.payoutId);
  const attempt = await prisma.partnerWithdrawalAttempt.findUnique({ where: { id: current.attemptId } });
  if (!attempt || attempt.withdrawalId !== withdrawal.id || attempt.operation !== "PAYOUT") {
    throw new Error("withdrawal_payout_intent_missing");
  }
  const latest = await prisma.partnerWithdrawalAttempt.findFirst({
    where: { withdrawalId: withdrawal.id, operation: "PAYOUT" }, orderBy: { sequence: "desc" },
  });
  if (latest?.id !== attempt.id) {
    if (current.status === "paid") {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.partnerWithdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
        await lockPartner(tx, fresh.partnerUserId, options.now ?? new Date());
        await freezeNewerWithdrawal(tx, fresh, options.now ?? new Date(), "older_bank_payout_later_paid");
        await recordEvent(tx, fresh, "ACTION_REQUIRED", "older_bank_payout_later_paid");
        await tx.partnerWithdrawal.update({ where: { id: fresh.id }, data: {
          status: "ACTION_REQUIRED", failureCode: "older_bank_payout_later_paid",
        } });
      });
    }
    return withdrawal;
  }
  if (!attempt) throw new Error("withdrawal_payout_intent_missing");
  await savePayout(withdrawal.id, attempt.id, current, options.now ?? new Date());
  return settlePayout(current, options.now ?? new Date());
}

export async function runPartnerWithdrawalWorker(options: Options & { limit?: number } = {}) {
  if (!withdrawalExecutionAllowed()) return { status: "paused" as const, processed: 0 };
  const pending = await prisma.partnerWithdrawal.findMany({
    where: { status: { in: ["REQUESTED", "READY_FOR_PROCESSING", "PROCESSING"] } },
    orderBy: { createdAt: "asc" }, take: Math.min(Math.max(options.limit ?? 5, 1), 10),
    select: { id: true },
  });
  let processed = 0;
  for (const item of pending) {
    await processPartnerWithdrawal(item.id, options);
    processed++;
  }
  return { status: "ran" as const, processed };
}

export async function runPartnerWithdrawalReconciliationWorker(options: Options & { limit?: number } = {}) {
  const pending = await prisma.partnerWithdrawal.findMany({
    where: { status: { in: ["PROCESSING", "OUTCOME_UNKNOWN", "ACTION_REQUIRED", "PAID"] }, payoutId: { not: null } },
    orderBy: [{ lastReconciledAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(options.limit ?? 5, 1), 10),
    select: { id: true },
  });
  let reconciled = 0;
  let requiresReview = 0;
  for (const item of pending) {
    try {
      await reconcilePartnerWithdrawal(item.id, options);
      reconciled++;
    } catch {
      requiresReview++;
    } finally {
      await prisma.partnerWithdrawal.update({ where: { id: item.id }, data: {
        lastReconciledAt: new Date(),
      } });
    }
  }
  return { status: "ran" as const, reconciled, requiresReview };
}
