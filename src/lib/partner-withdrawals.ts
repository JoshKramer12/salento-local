import { randomUUID } from "node:crypto";
import { Prisma, type PartnerPayoutMethod, type PartnerWithdrawalStatus } from "@prisma/client";
import { getPartnerMinimumPayoutCents } from "@/lib/partner-connect";
import { hasValidPartnerCommissionAttribution, payableCommissionWhere } from "@/lib/partner-ledger";
import { encryptPayoutDestination, isPaypalPayoutConfigured } from "@/lib/partner-payout-methods";
import { partnerCashoutRequestsEnabled } from "@/lib/partner-payout-mode";
import { prisma } from "@/lib/prisma";

export class PartnerWithdrawalError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const unresolvedStatuses: PartnerWithdrawalStatus[] = ["REQUESTED", "PROCESSING", "FAILED", "ACTION_REQUIRED"];

export function assertWithdrawalTransition(from: PartnerWithdrawalStatus, to: PartnerWithdrawalStatus, evidence: {
  verifiedSettlement?: boolean;
  confirmedNoTransfer?: boolean;
} = {}) {
  const allowed: Record<PartnerWithdrawalStatus, PartnerWithdrawalStatus[]> = {
    REQUESTED: ["PROCESSING", "CANCELED", "ACTION_REQUIRED"],
    PROCESSING: ["PAID", "FAILED", "ACTION_REQUIRED"],
    FAILED: ["PROCESSING", "CANCELED"],
    ACTION_REQUIRED: ["PROCESSING", "CANCELED"],
    PAID: [],
    CANCELED: [],
  };
  if (!allowed[from].includes(to) ||
      (to === "PAID" && !evidence.verifiedSettlement) ||
      (to === "CANCELED" && from !== "REQUESTED" && !evidence.confirmedNoTransfer)) {
    throw new PartnerWithdrawalError("invalid_withdrawal_transition");
  }
}

type DestinationProfile = {
  preferredPayoutMethod: PartnerPayoutMethod;
  payoutSetupStatus: string;
  stripeConnectedAccountId: string | null;
  stripeAccountStatus: string;
  stripePayoutsEnabled: boolean;
  stripePayoutAccountLast4: string | null;
  stripePayoutBankName: string | null;
  paypalPayoutEmail: string | null;
  bankPayoutIbanEncrypted: string | null;
  bankPayoutAccountLast4: string | null;
};

function destinationSnapshot(profile: DestinationProfile) {
  switch (profile.preferredPayoutMethod) {
    case "STRIPE":
      if (!profile.stripeConnectedAccountId || !profile.stripePayoutsEnabled || profile.stripeAccountStatus !== "READY") break;
      return encryptPayoutDestination(profile.stripeConnectedAccountId);
    case "PAYPAL":
      if (!profile.paypalPayoutEmail?.trim() || profile.payoutSetupStatus !== "READY" || !isPaypalPayoutConfigured()) break;
      return encryptPayoutDestination(profile.paypalPayoutEmail.trim());
    case "POSTEPAY":
    case "HYPE":
      if (!profile.bankPayoutIbanEncrypted || !profile.bankPayoutAccountLast4 || profile.payoutSetupStatus !== "READY") break;
      // Copy the already encrypted value. Later profile edits cannot redirect it.
      return profile.bankPayoutIbanEncrypted;
  }
  throw new PartnerWithdrawalError("payout_destination_unavailable");
}

function retryableWrite(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034" || error.message.includes("SQLITE_BUSY"));
}

export async function createPartnerWithdrawalRequest(params: { partnerUserId: string; idempotencyKey: string }) {
  if (!partnerCashoutRequestsEnabled()) throw new PartnerWithdrawalError("cashout_disabled");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(params.idempotencyKey)) throw new PartnerWithdrawalError("invalid_idempotency_key");
  const key = { partnerUserId_idempotencyKey: params };
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await prisma.partnerWithdrawalRequest.findUnique({ where: key });
    if (previous) return { id: previous.id, status: previous.status };
    try {
      return await prisma.$transaction(async (tx) => {
        const duplicate = await tx.partnerWithdrawalRequest.findUnique({ where: key });
        if (duplicate) return { id: duplicate.id, status: duplicate.status };

        const partner = await tx.user.findUnique({ where: { id: params.partnerUserId }, select: { role: true, localPartnerProfile: true } });
        if (partner?.role !== "GETTER") throw new PartnerWithdrawalError("partner_required");
        const profile = partner.localPartnerProfile;
        if (!profile) throw new PartnerWithdrawalError("payout_destination_unavailable");
        const alreadyOpen = await tx.partnerWithdrawalRequest.findFirst({
          where: { partnerUserId: params.partnerUserId, status: { in: unresolvedStatuses } }, select: { id: true },
        });
        if (alreadyOpen) throw new PartnerWithdrawalError("withdrawal_already_open");
        const snapshot = destinationSnapshot(profile);

        const now = new Date();
        const commissions = await tx.partnerCommission.findMany({
          where: { ...payableCommissionWhere(now), partnerUserId: params.partnerUserId },
          select: {
            id: true, amountCents: true, businessId: true, businessSubmissionId: true,
            payment: { select: { businessId: true, businessSubmissionId: true } },
            businessSubmission: { select: { userId: true } },
            business: { select: { membership: { select: { originatingPartnerUserId: true } } } },
          },
        });
        if (commissions.some((row) => !hasValidPartnerCommissionAttribution(row, params.partnerUserId))) {
          throw new PartnerWithdrawalError("commission_payment_attribution_conflict");
        }
        const amountCents = commissions.reduce((sum, row) => sum + row.amountCents, 0);
        if (amountCents < getPartnerMinimumPayoutCents()) throw new PartnerWithdrawalError("below_minimum_payout");

        const requestId = randomUUID();
        const run = await tx.partnerPayoutRun.create({ data: {
          runKey: `cashout:${requestId}`, scheduledFor: now, status: "RUNNING",
        } });
        const method = profile.preferredPayoutMethod;
        const payout = await tx.partnerPayout.create({ data: {
          payoutRunId: run.id, partnerUserId: params.partnerUserId, localPartnerProfileId: profile.id,
          amountCents, payoutMethod: method, status: "SCHEDULED",
          stripeConnectedAccountId: method === "STRIPE" ? profile.stripeConnectedAccountId : null,
          bankAccountLast4: method === "STRIPE" ? profile.stripePayoutAccountLast4 : profile.bankPayoutAccountLast4,
          bankName: method === "STRIPE" ? profile.stripePayoutBankName : method,
        } });
        const withdrawal = await tx.partnerWithdrawalRequest.create({ data: {
          id: requestId, partnerUserId: params.partnerUserId, idempotencyKey: params.idempotencyKey,
          payoutId: payout.id, amountCents, payoutMethod: method,
          destinationSnapshotEncrypted: snapshot, status: "REQUESTED",
        } });
        const reserved = await tx.partnerCommission.updateMany({
          where: { id: { in: commissions.map((row) => row.id) }, partnerUserId: params.partnerUserId, ...payableCommissionWhere(now) },
          data: { payoutId: payout.id, status: "RESERVED" },
        });
        if (reserved.count !== commissions.length) throw new PartnerWithdrawalError("commission_reservation_changed");
        await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: withdrawal.id, toStatus: "REQUESTED" } });
        return { id: withdrawal.id, status: withdrawal.status };
      });
    } catch (error) {
      if (!retryableWrite(error)) throw error;
      const duplicate = await prisma.partnerWithdrawalRequest.findUnique({ where: key });
      if (duplicate) return { id: duplicate.id, status: duplicate.status };
      if (attempt === 3) throw new PartnerWithdrawalError("withdrawal_write_conflict");
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new PartnerWithdrawalError("withdrawal_write_conflict");
}

/** Only a never-dispatched request can be canceled in Phase 2. */
export async function cancelRequestedPartnerWithdrawal(id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.partnerWithdrawalRequest.findUnique({ where: { id }, include: { payout: true } });
    if (!request || request.status !== "REQUESTED" || request.payout.status !== "SCHEDULED" ||
        request.payout.stripeTransferId || request.payout.stripePayoutId || request.payout.providerBatchId) {
      throw new PartnerWithdrawalError("withdrawal_not_cancelable");
    }
    assertWithdrawalTransition(request.status, "CANCELED");
    const changed = await tx.partnerWithdrawalRequest.updateMany({ where: { id, status: "REQUESTED" }, data: { status: "CANCELED", failureReason: reason } });
    if (changed.count !== 1) throw new PartnerWithdrawalError("withdrawal_state_changed");
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "CANCELED", canceledAt: new Date(), failureMessage: reason } });
    await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId, status: "RESERVED" }, data: { payoutId: null, status: "AVAILABLE" } });
    await tx.partnerPayoutRun.update({ where: { id: request.payout.payoutRunId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: id, fromStatus: "REQUESTED", toStatus: "CANCELED", reason } });
    return { id, status: "CANCELED" as const };
  });
}
