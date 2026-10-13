import type Stripe from "stripe";
import { Prisma, type PartnerWithdrawalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { createPaypalPayout, decryptPayoutDestination, encryptPayoutDestination, getPaypalPayoutBatch, isPaypalPayoutConfigured, isValidItalianIban, type PaypalPayoutBatchEvidence } from "@/lib/partner-payout-methods";
import { hasValidPartnerCommissionAttribution } from "@/lib/partner-ledger";
import { bankReturnCreditSafe, bankReturnCreditSourceKey } from "@/lib/partner-recovery-credits";
import { partnerCashoutReconciliationEnabled, partnerCashoutRequestsEnabled } from "@/lib/partner-payout-mode";
import { assertWithdrawalTransition, PartnerWithdrawalError } from "@/lib/partner-withdrawals";

type Db = Prisma.TransactionClient;
type Withdrawal = NonNullable<Awaited<ReturnType<typeof loadWithdrawal>>>;
type Providers = {
  stripe?: Stripe;
  paypalCreate?: typeof createPaypalPayout;
  paypalLookup?: typeof getPaypalPayoutBatch;
};

async function loadWithdrawal(db: Db, id: string) {
  return db.partnerWithdrawalRequest.findUnique({ where: { id }, include: { payout: true } });
}

async function requireAdmin(actorUserId: string) {
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new PartnerWithdrawalError("admin_required");
}

function requireProcessingEnabled() {
  if (!partnerCashoutRequestsEnabled() || process.env.PARTNER_CASHOUT_PROCESSING_ENABLED !== "true") {
    throw new PartnerWithdrawalError("withdrawal_processing_disabled");
  }
}

function requireReconciliationEnabled() {
  if (!partnerCashoutReconciliationEnabled()) throw new PartnerWithdrawalError("withdrawal_reconciliation_disabled");
}

async function assertReservedAndSafe(tx: Db, request: Withdrawal) {
  const [debtCount, rows] = await Promise.all([
    tx.partnerCommission.count({ where: { partnerUserId: request.partnerUserId, amountCents: { lt: 0 }, OR: [
      { status: "DEBT" }, { type: "REVERSAL", status: "REVERSED", payoutId: { not: null } },
    ] } }),
    tx.partnerCommission.findMany({ where: { payoutId: request.payoutId }, select: {
      partnerUserId: true, amountCents: true, status: true, type: true, sourceEventType: true,
      sourceEventId: true, sourceKey: true, businessId: true, businessSubmissionId: true,
      payment: { select: { businessId: true, businessSubmissionId: true, status: true, paidAt: true, refundRequestedAt: true, refundStatus: true, partnerDisputes: { select: { holdActive: true } } } },
      businessSubmission: { select: { userId: true } },
      business: { select: { membership: { select: { originatingPartnerUserId: true } } } },
    } }),
  ]);
  const creditsSafe = await Promise.all(rows.filter((row) => row.type === "ADJUSTMENT").map((row) => bankReturnCreditSafe(tx, row)));
  if (debtCount || !rows.length || creditsSafe.some((safe) => !safe) ||
      rows.reduce((sum, row) => sum + row.amountCents, 0) !== request.amountCents ||
      request.payout.amountCents !== request.amountCents || request.payout.partnerUserId !== request.partnerUserId ||
      request.payout.payoutMethod !== request.payoutMethod || rows.some((row) =>
        row.partnerUserId !== request.partnerUserId || row.status !== "RESERVED" ||
        (row.type === "COMMISSION" ?
          !hasValidPartnerCommissionAttribution(row, request.partnerUserId) || row.payment?.status !== "PAID" ||
          !row.payment.paidAt || Boolean(row.payment.refundRequestedAt && row.payment.refundStatus !== "support_closed") ||
          row.payment.partnerDisputes.some((dispute) => dispute.holdActive) : row.type !== "ADJUSTMENT"))) {
    throw new PartnerWithdrawalError("withdrawal_financial_hold");
  }
  return rows.length;
}

function destination(request: Withdrawal) {
  const value = decryptPayoutDestination(request.destinationSnapshotEncrypted);
  if (request.payoutMethod === "STRIPE") {
    if (!value.startsWith("acct_") || request.payout.stripeConnectedAccountId !== value) throw new PartnerWithdrawalError("withdrawal_destination_mismatch");
  } else if (request.payoutMethod === "PAYPAL") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new PartnerWithdrawalError("withdrawal_destination_mismatch");
  } else if (!isValidItalianIban(value)) {
    throw new PartnerWithdrawalError("withdrawal_destination_mismatch");
  }
  return value;
}

function paypalEvidenceMatches(request: Withdrawal, batchId: string, evidence: PaypalPayoutBatchEvidence) {
  const amountCents = evidence.amountValue && /^\d+\.\d{2}$/.test(evidence.amountValue)
    ? Number(evidence.amountValue.replace(".", "")) : null;
  return evidence.batchId === batchId &&
    evidence.senderBatchId === `salento-${request.payoutId}`.slice(0, 36) &&
    evidence.totalItems === 1 && evidence.receiver === destination(request) &&
    evidence.senderItemId === request.payoutId && amountCents === request.amountCents &&
    evidence.currency?.toLowerCase() === request.payout.currency.toLowerCase();
}

async function audit(tx: Db, request: Withdrawal, toStatus: PartnerWithdrawalStatus, details: {
  actorUserId?: string; provider?: string; providerReference?: string; reason?: string;
}) {
  await tx.partnerWithdrawalAuditEvent.create({ data: {
    withdrawalRequestId: request.id, fromStatus: request.status, toStatus,
    actorUserId: details.actorUserId, provider: details.provider,
    providerReference: details.providerReference, reason: details.reason,
  } });
}

async function transition(tx: Db, request: Withdrawal, toStatus: PartnerWithdrawalStatus, details: {
  actorUserId?: string; provider?: string; providerReference?: string; reason?: string; verifiedSettlement?: boolean;
}) {
  assertWithdrawalTransition(request.status, toStatus, { verifiedSettlement: details.verifiedSettlement });
  const changed = await tx.partnerWithdrawalRequest.updateMany({
    where: { id: request.id, status: request.status },
    data: { status: toStatus, failureReason: details.reason ?? null },
  });
  if (changed.count !== 1) throw new PartnerWithdrawalError("withdrawal_state_changed");
  await audit(tx, request, toStatus, details);
}

async function actionRequired(id: string, reason: string, provider?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || request.status === "PAID" || request.status === "CANCELED" || request.status === "FAILED") return request?.status;
    if (request.status === "ACTION_REQUIRED") return request.status;
    await transition(tx, request, "ACTION_REQUIRED", { provider, reason });
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "ACTION_REQUIRED", actionRequiredAt: new Date(), failureMessage: reason } });
    return "ACTION_REQUIRED" as const;
  });
}

async function providerFailed(id: string, reason: string, provider: string, reference?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || request.status === "PAID" || request.status === "CANCELED" || request.status === "FAILED") return request?.status;
    if (request.status !== "PROCESSING") {
      await transition(tx, request, "PROCESSING", { provider, reason: "provider_outcome_verified" });
      const refreshed = await loadWithdrawal(tx, id);
      if (!refreshed) throw new PartnerWithdrawalError("withdrawal_missing");
      await transition(tx, refreshed, "FAILED", { provider, providerReference: reference, reason });
    } else {
      await transition(tx, request, "FAILED", { provider, providerReference: reference, reason });
    }
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "FAILED", failedAt: new Date(), failureMessage: reason } });
    // Definitive failure is recorded, but reservation release requires a
    // separate reviewed reconciliation path. No automatic reuse of funds.
    return "FAILED" as const;
  });
}

async function recordTerminalConflict(id: string, status: PartnerWithdrawalStatus, provider: string, reference: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.partnerWithdrawalRequest.updateMany({
      where: { id, status, OR: [{ failureReason: null }, { failureReason: { not: reason } }] }, data: { failureReason: reason },
    });
    if (!changed.count) return;
    await tx.partnerWithdrawalAuditEvent.create({ data: {
      withdrawalRequestId: id, fromStatus: status, toStatus: status,
      provider, providerReference: reference, reason,
    } });
    if (status === "CANCELED" && (reason === "late_stripe_paid_requires_review" || reason === "late_paypal_success_requires_review")) {
      const request = await loadWithdrawal(tx, id);
      const released = await tx.partnerWithdrawalAuditEvent.findFirst({
        where: { withdrawalRequestId: id, reason: "verified_nonpayment_released" }, select: { id: true },
      });
      if (request && released) {
        // A contradictory late settlement is an overpayment liability, not
        // permission to rewrite the released commission or settled history.
        await tx.partnerCommission.upsert({
          where: { sourceKey: `late-settlement:${id}` },
          create: { partnerUserId: request.partnerUserId, amountCents: -request.amountCents,
            currency: request.payout.currency, type: "ADJUSTMENT", status: "DEBT", sourceKey: `late-settlement:${id}`,
            sourceEventType: "LATE_PROVIDER_SETTLEMENT", sourceEventId: reference },
          update: {},
        });
      }
    }
  });
}

type NonpaymentReview = { eligible: boolean; reason: string; provider: string; reference: string | null;
  evidence: Record<string, string | number | boolean | null> };

async function inspectNonpayment(request: Withdrawal, providers: Providers): Promise<NonpaymentReview> {
  const blocked = (reason: string, provider: string, reference: string | null = null): NonpaymentReview =>
    ({ eligible: false, reason, provider, reference, evidence: {} });
  if (request.status === "PAID" || request.payout.status === "PAID" || request.settlementVerifiedAt) {
    return blocked("already_settled", request.payoutMethod);
  }
  if (!request.dispatchStartedAt && !request.manualTransferInitiatedAt &&
      !request.payout.stripeTransferId && !request.payout.stripePayoutId && !request.payout.providerBatchId) {
    if (request.status === "REQUESTED" && request.payout.status === "SCHEDULED") {
      return { eligible: true, reason: "no_provider_call", provider: request.payoutMethod, reference: null,
        evidence: { requestNeverClaimed: true } };
    }
    if (request.payoutMethod === "STRIPE" && request.status === "ACTION_REQUIRED" &&
        ["stripe_account_ineligible", "withdrawal_financial_hold"].includes(request.failureReason ?? "")) {
      return { eligible: true, reason: "no_provider_call_after_claim", provider: "STRIPE", reference: null,
        evidence: { dispatchStarted: false, recordedReason: request.failureReason } };
    }
    if (request.payoutMethod === "POSTEPAY" || request.payoutMethod === "HYPE") {
      return { eligible: true, reason: "manual_transfer_not_sent", provider: "BANK", reference: null,
        evidence: { transferInitiated: false } };
    }
    return blocked("dispatch_history_uncertain", request.payoutMethod);
  }
  if (request.payoutMethod === "POSTEPAY" || request.payoutMethod === "HYPE") {
    const returned = await prisma.partnerManualBankReturn.findUnique({ where: { withdrawalRequestId: request.id } });
    if (returned && returned.amountCents === request.amountCents && request.manualTransferInitiatedAt) {
      return { eligible: true, reason: "manual_bank_return_verified", provider: "BANK",
        reference: returned.bankReturnReference,
        evidence: { bankReturnReference: returned.bankReturnReference, amountReturned: returned.amountCents } };
    }
    return blocked("manual_transfer_outcome_requires_review", "BANK", request.manualTransferReference);
  }
  if (request.payoutMethod === "PAYPAL") {
    const batchId = request.payout.providerBatchId;
    if (!batchId) return blocked("paypal_batch_reference_missing", "PAYPAL");
    const item = await (providers.paypalLookup ?? getPaypalPayoutBatch)(batchId);
    if (!paypalEvidenceMatches(request, batchId, item)) return blocked("paypal_batch_attribution_conflict", "PAYPAL", batchId);
    if (!["FAILED", "RETURNED", "REFUNDED"].includes(item.itemStatus)) {
      return blocked("paypal_nonpayment_not_terminal", "PAYPAL", item.itemId ?? batchId);
    }
    return { eligible: true, reason: `paypal_${item.itemStatus.toLowerCase()}`, provider: "PAYPAL",
      reference: item.itemId ?? batchId, evidence: { batchId, itemId: item.itemId, itemStatus: item.itemStatus } };
  }
  const transferId = request.payout.stripeTransferId;
  if (!transferId || !request.stripeTransferRecordedAt) return blocked("stripe_transfer_unverified", "STRIPE", transferId);
  const stripe = providers.stripe ?? getStripe();
  const account = destination(request);
  const transfer = await stripe.transfers.retrieve(transferId);
  if (transfer.id !== transferId || transfer.destination !== account || transfer.transfer_group !== request.id ||
      transfer.metadata?.withdrawalRequestId !== request.id || transfer.amount !== request.amountCents ||
      transfer.currency.toLowerCase() !== request.payout.currency.toLowerCase() ||
      !transfer.reversed || transfer.amount_reversed !== transfer.amount) {
    return blocked("stripe_transfer_not_fully_reversed", "STRIPE", transferId);
  }
  const payoutId = request.payout.stripePayoutId;
  if (!payoutId) {
    if (request.payoutDispatchStartedAt) return blocked("stripe_payout_reference_missing", "STRIPE", transferId);
    const payouts = await stripe.payouts.list({ limit: 100 }, { stripeAccount: account });
    if (payouts.has_more || payouts.data.some((row) => row.metadata?.withdrawalRequestId === request.id)) {
      return blocked("stripe_payout_attribution_ambiguous", "STRIPE", transferId);
    }
    return { eligible: true, reason: "stripe_transfer_reversed_without_payout", provider: "STRIPE",
      reference: transferId, evidence: { transferId, amountReversed: transfer.amount_reversed, payoutDispatchStarted: false } };
  }
  const payout = await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: account });
  if (payout.id !== payoutId || payout.metadata?.withdrawalRequestId !== request.id ||
      payout.amount !== request.amountCents || payout.currency.toLowerCase() !== request.payout.currency.toLowerCase()) {
    return blocked("stripe_payout_attribution_conflict", "STRIPE", payoutId);
  }
  if (payout.status !== "failed" && payout.status !== "canceled") {
    return blocked("stripe_payout_nonpayment_not_terminal", "STRIPE", payoutId);
  }
  return { eligible: true, reason: `stripe_payout_${payout.status}_transfer_reversed`, provider: "STRIPE",
    reference: payoutId, evidence: { transferId, payoutId, payoutStatus: payout.status,
      amountReversed: transfer.amount_reversed } };
}

/** Read-only provider review. The mutation repeats this lookup before release. */
export async function reviewDefinitiveNonpayment(params: { actorUserId: string; requestId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  if (request.status === "CANCELED") return { eligible: false, reason: "already_resolved", provider: request.payoutMethod, reference: null };
  const review = await inspectNonpayment(request, providers);
  return { eligible: review.eligible, reason: review.reason, provider: review.provider, reference: review.reference };
}

/** Release only the original reservation after authoritative nonpayment. */
export async function resolveDefinitiveNonpayment(params: { actorUserId: string; requestId: string; note: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const note = params.note.trim();
  if (note.length < 20 || note.length > 2000) throw new PartnerWithdrawalError("nonpayment_note_required");
  const attemptResolution = async () => {
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  if (request.status === "CANCELED") {
    const prior = await prisma.partnerWithdrawalAuditEvent.findFirst({ where: { withdrawalRequestId: request.id, reason: "verified_nonpayment_released" } });
    if (prior) return { id: request.id, status: "CANCELED" as const, alreadyResolved: true };
    throw new PartnerWithdrawalError("withdrawal_state_conflict");
  }
  const review = await inspectNonpayment(request, providers);
  if (!review.eligible) throw new PartnerWithdrawalError(review.reason);
  return prisma.$transaction(async (tx) => {
    const current = await loadWithdrawal(tx, request.id);
    if (!current || current.status !== request.status || current.payout.status !== request.payout.status ||
        current.payout.stripeTransferId !== request.payout.stripeTransferId ||
        current.payout.stripePayoutId !== request.payout.stripePayoutId ||
        current.payout.providerBatchId !== request.payout.providerBatchId ||
        current.payoutDispatchStartedAt?.getTime() !== request.payoutDispatchStartedAt?.getTime()) {
      throw new PartnerWithdrawalError("withdrawal_state_changed");
    }
    const count = await assertReservedAndSafe(tx, current);
    assertWithdrawalTransition(current.status, "CANCELED", { confirmedNoTransfer: true });
    const changed = await tx.partnerWithdrawalRequest.updateMany({ where: { id: current.id, status: current.status },
      data: { status: "CANCELED", failureReason: "verified_nonpayment_released" } });
    if (changed.count !== 1) throw new PartnerWithdrawalError("withdrawal_state_changed");
    await tx.partnerPayout.update({ where: { id: current.payoutId }, data: { status: "CANCELED", canceledAt: new Date(), failureMessage: "verified_nonpayment_released" } });
    const released = await tx.partnerCommission.updateMany({ where: { payoutId: current.payoutId, status: "RESERVED" },
      data: { payoutId: null, status: "AVAILABLE" } });
    if (released.count !== count) throw new PartnerWithdrawalError("withdrawal_reservation_changed");
    await tx.partnerPayoutRun.update({ where: { id: current.payout.payoutRunId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: current.id, fromStatus: current.status,
      toStatus: "CANCELED", actorUserId: params.actorUserId, provider: review.provider,
      providerReference: review.reference, reason: "verified_nonpayment_released",
      evidenceEncrypted: encryptPayoutDestination(JSON.stringify({ note, classification: review.reason, evidence: review.evidence })) } });
    return { id: current.id, status: "CANCELED" as const, alreadyResolved: false };
  });
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await attemptResolution(); }
    catch (error) {
      const concurrent = error instanceof PartnerWithdrawalError && error.code === "withdrawal_state_changed" ||
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034" || error.message.includes("SQLITE_BUSY"));
      if (!concurrent || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new PartnerWithdrawalError("withdrawal_state_changed");
}

async function verifiedPaid(id: string, provider: string, reference: string, actorUserId?: string, evidence?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
    if (request.status === "PAID") return "PAID" as const;
    if (request.status !== "PROCESSING" && request.status !== "ACTION_REQUIRED") throw new PartnerWithdrawalError("withdrawal_state_conflict");
    // Settlement can arrive after a refund or dispute. Preserve the external
    // truth, but never settle a mismatched or partly released reservation.
    const reserved = await tx.partnerCommission.findMany({ where: { payoutId: request.payoutId,
      type: { in: ["COMMISSION", "ADJUSTMENT"] }, amountCents: { gt: 0 } }, select: { amountCents: true, partnerUserId: true, status: true } });
    if (!reserved.length || reserved.some((row) => row.partnerUserId !== request.partnerUserId || row.status !== "RESERVED") ||
        reserved.reduce((sum, row) => sum + row.amountCents, 0) !== request.amountCents) throw new PartnerWithdrawalError("withdrawal_reservation_mismatch");
    await transition(tx, request, "PAID", { provider, providerReference: reference, actorUserId, verifiedSettlement: true });
    const now = new Date();
    await tx.partnerWithdrawalRequest.update({ where: { id }, data: { settlementVerifiedAt: now, settlementVerifiedByUserId: actorUserId, settlementEvidenceEncrypted: evidence ? encryptPayoutDestination(evidence) : null } });
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "PAID", paidAt: now, ...(provider === "BANK" ? {} : { providerPayoutId: reference }) } });
    const updated = await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId,
      type: { in: ["COMMISSION", "ADJUSTMENT"] }, status: "RESERVED" }, data: { status: "PAID", paidAt: now } });
    if (updated.count !== reserved.length) throw new PartnerWithdrawalError("withdrawal_reservation_changed");
    await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId, type: "REVERSAL", status: "REVERSED", amountCents: { lt: 0 } }, data: { status: "DEBT" } });
    await tx.partnerPayoutRun.update({ where: { id: request.payout.payoutRunId }, data: { status: "COMPLETED", completedAt: now } });
    return "PAID" as const;
  });
}

async function saveProviderReference(id: string, provider: "STRIPE" | "PAYPAL", data: { transferId?: string; payoutId?: string; batchId?: string; senderBatchId?: string; confirmedDuringDispatch?: boolean }) {
  await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || !["PROCESSING", "ACTION_REQUIRED"].includes(request.status)) throw new PartnerWithdrawalError("withdrawal_state_conflict");
    if (data.transferId && request.payout.stripeTransferId && request.payout.stripeTransferId !== data.transferId ||
        data.payoutId && request.payout.stripePayoutId && request.payout.stripePayoutId !== data.payoutId ||
        data.batchId && request.payout.providerBatchId && request.payout.providerBatchId !== data.batchId ||
        data.senderBatchId && request.payout.providerReference && request.payout.providerReference !== data.senderBatchId) {
      throw new PartnerWithdrawalError("provider_reference_conflict");
    }
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: {
      ...(data.transferId ? { stripeTransferId: data.transferId } : {}),
      ...(data.payoutId ? { stripePayoutId: data.payoutId } : {}),
      ...(data.batchId ? { providerBatchId: data.batchId } : {}),
      ...(data.senderBatchId ? { providerReference: data.senderBatchId } : {}),
    } });
    if (data.transferId && data.confirmedDuringDispatch) {
      await tx.partnerWithdrawalRequest.update({ where: { id }, data: { stripeTransferRecordedAt: new Date() } });
    }
    await audit(tx, request, request.status, { provider, providerReference: data.payoutId ?? data.batchId ?? data.transferId, reason: "provider_reference_recorded" });
  });
}

async function markStripePayoutDispatchStarted(id: string) {
  await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || request.status !== "PROCESSING" || request.payoutMethod !== "STRIPE" ||
        !request.payout.stripeTransferId || !request.stripeTransferRecordedAt ||
        request.payout.stripePayoutId || request.payoutDispatchStartedAt) {
      throw new PartnerWithdrawalError("stripe_payout_dispatch_conflict");
    }
    await assertReservedAndSafe(tx, request);
    const changed = await tx.partnerWithdrawalRequest.updateMany({
      where: { id, status: "PROCESSING", payoutDispatchStartedAt: null },
      data: { payoutDispatchStartedAt: new Date() },
    });
    if (changed.count !== 1) throw new PartnerWithdrawalError("withdrawal_state_changed");
    await audit(tx, request, "PROCESSING", { provider: "STRIPE", reason: "stripe_payout_dispatch_started" });
  });
}

async function assertStillSafe(id: string) {
  await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || request.status !== "PROCESSING" || request.payout.status !== "PROCESSING") throw new PartnerWithdrawalError("withdrawal_state_conflict");
    await assertReservedAndSafe(tx, request);
  });
}

async function markProviderDispatchStarted(id: string, provider: "STRIPE" | "PAYPAL") {
  await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || request.status !== "PROCESSING" || request.dispatchStartedAt ||
        request.payout.status !== "PROCESSING" || request.payoutMethod !== provider) {
      throw new PartnerWithdrawalError("withdrawal_state_conflict");
    }
    destination(request);
    await assertReservedAndSafe(tx, request);
    const changed = await tx.partnerWithdrawalRequest.updateMany({ where: { id, status: "PROCESSING", dispatchStartedAt: null }, data: { dispatchStartedAt: new Date() } });
    if (changed.count !== 1) throw new PartnerWithdrawalError("withdrawal_state_changed");
    const senderBatchId = provider === "PAYPAL" ? `salento-${request.payoutId}`.slice(0, 36) : undefined;
    if (senderBatchId) await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { providerReference: senderBatchId } });
    await audit(tx, request, "PROCESSING", { provider, providerReference: senderBatchId, reason: "provider_dispatch_started" });
  });
}

export async function processPartnerWithdrawal(params: { actorUserId: string; requestId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireProcessingEnabled();
  const claim = await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, params.requestId);
    if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
    const safePreDispatchRetry = request.status === "ACTION_REQUIRED" && !request.dispatchStartedAt &&
      !request.manualTransferInitiatedAt && !request.payout.stripeTransferId && !request.payout.stripePayoutId && !request.payout.providerBatchId;
    if (request.status !== "REQUESTED" && !safePreDispatchRetry) return { claimed: false, shouldReconcile: true, method: request.payoutMethod, status: request.status };
    if (!(request.payout.status === "SCHEDULED" || safePreDispatchRetry && request.payout.status === "ACTION_REQUIRED") ||
        request.payout.stripeTransferId || request.payout.stripePayoutId || request.payout.providerBatchId) {
      throw new PartnerWithdrawalError("withdrawal_state_conflict");
    }
    destination(request);
    try { await assertReservedAndSafe(tx, request); }
    catch (error) {
      if (!(error instanceof PartnerWithdrawalError) || error.code !== "withdrawal_financial_hold") throw error;
      await transition(tx, request, "ACTION_REQUIRED", { actorUserId: params.actorUserId, reason: error.code });
      await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "ACTION_REQUIRED", actionRequiredAt: new Date(), failureMessage: error.code } });
      return { claimed: false, shouldReconcile: false, method: request.payoutMethod, status: "ACTION_REQUIRED" as const };
    }
    if (request.payoutMethod === "PAYPAL" && !isPaypalPayoutConfigured()) throw new PartnerWithdrawalError("paypal_not_configured");
    await transition(tx, request, "PROCESSING", { actorUserId: params.actorUserId, reason: "admin_processing_claim" });
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "PROCESSING", initiatedAt: new Date(), attemptCount: 1 } });
    return { claimed: true, method: request.payoutMethod, status: "PROCESSING" as const };
  });
  if (!claim.claimed) {
    if (claim.shouldReconcile && (claim.status === "PROCESSING" || claim.status === "ACTION_REQUIRED")) return reconcilePartnerWithdrawal({ actorUserId: params.actorUserId, requestId: params.requestId }, providers);
    return { id: params.requestId, status: claim.status };
  }
  if (claim.method === "POSTEPAY" || claim.method === "HYPE") return { id: params.requestId, status: "PROCESSING" as const };
  const request = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: params.requestId }, include: { payout: true } });
  const value = destination(request);
  if (claim.method === "STRIPE") {
    const stripe = providers.stripe ?? getStripe();
    try {
      const account = await stripe.accounts.retrieve(value);
      if (!account.payouts_enabled) throw new PartnerWithdrawalError("stripe_account_ineligible");
      await markProviderDispatchStarted(request.id, "STRIPE");
      const transfer = await stripe.transfers.create({ amount: request.amountCents, currency: request.payout.currency,
        destination: value, transfer_group: request.id,
        metadata: { partnerPayoutId: request.payoutId, withdrawalRequestId: request.id } },
      { idempotencyKey: `withdrawal-transfer-${request.id}` });
      await saveProviderReference(request.id, "STRIPE", { transferId: transfer.id, confirmedDuringDispatch: true });
      await assertStillSafe(request.id);
      await markStripePayoutDispatchStarted(request.id);
      const payout = await stripe.payouts.create({ amount: request.amountCents, currency: request.payout.currency,
        metadata: { partnerPayoutId: request.payoutId, withdrawalRequestId: request.id } },
      { idempotencyKey: `withdrawal-payout-${request.id}`, stripeAccount: value });
      await saveProviderReference(request.id, "STRIPE", { payoutId: payout.id });
      return { id: request.id, status: "PROCESSING" as const };
    } catch (error) {
      const reason = error instanceof PartnerWithdrawalError &&
        ["stripe_account_ineligible", "withdrawal_financial_hold"].includes(error.code)
        ? error.code : "stripe_outcome_requires_reconciliation";
      const status = await actionRequired(request.id, reason, "STRIPE");
      return { id: request.id, status };
    }
  }
  try {
    await markProviderDispatchStarted(request.id, "PAYPAL");
    const payout = await (providers.paypalCreate ?? createPaypalPayout)({ amountCents: request.amountCents, payoutId: request.payoutId, recipientEmail: value });
    await saveProviderReference(request.id, "PAYPAL", { batchId: payout.batchId, senderBatchId: payout.providerReference });
    return { id: request.id, status: "PROCESSING" as const };
  } catch {
    const status = await actionRequired(request.id, "paypal_outcome_requires_reconciliation", "PAYPAL");
    return { id: request.id, status };
  }
}

/** Complete only a newly recorded transfer for which this version of the
 * dispatcher has durable proof that no payout call was started. Legacy rows
 * deliberately remain in manual reconciliation. */
export async function continueStripeWithdrawalPayout(params: { actorUserId: string; requestId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireProcessingEnabled();
  requireReconciliationEnabled();
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request || request.payoutMethod !== "STRIPE" || request.status !== "ACTION_REQUIRED" ||
      !request.payout.stripeTransferId || !request.stripeTransferRecordedAt ||
      request.payout.stripePayoutId || request.payoutDispatchStartedAt) {
    throw new PartnerWithdrawalError("stripe_continuation_not_safe");
  }
  const account = destination(request);
  const stripe = providers.stripe ?? getStripe();
  const [transfer, payouts, connectedAccount] = await Promise.all([
    stripe.transfers.retrieve(request.payout.stripeTransferId),
    stripe.payouts.list({ limit: 100 }, { stripeAccount: account }),
    stripe.accounts.retrieve(account),
  ]);
  if (!connectedAccount.payouts_enabled || transfer.id !== request.payout.stripeTransferId ||
      transfer.destination !== account || transfer.transfer_group !== request.id ||
      transfer.amount !== request.amountCents || transfer.currency.toLowerCase() !== request.payout.currency.toLowerCase() ||
      transfer.metadata?.withdrawalRequestId !== request.id || transfer.reversed || transfer.amount_reversed !== 0 ||
      payouts.has_more || payouts.data.some((row) => row.metadata?.withdrawalRequestId === request.id)) {
    throw new PartnerWithdrawalError("stripe_continuation_not_safe");
  }
  await prisma.$transaction(async (tx) => {
    const current = await loadWithdrawal(tx, request.id);
    if (!current || current.status !== "ACTION_REQUIRED" || current.payoutMethod !== "STRIPE" ||
        current.payout.stripeTransferId !== transfer.id || !current.stripeTransferRecordedAt ||
        current.payout.stripePayoutId || current.payoutDispatchStartedAt) {
      throw new PartnerWithdrawalError("stripe_continuation_not_safe");
    }
    await assertReservedAndSafe(tx, current);
    await transition(tx, current, "PROCESSING", { actorUserId: params.actorUserId, provider: "STRIPE", providerReference: transfer.id, reason: "existing_transfer_payout_continuation" });
    await tx.partnerWithdrawalRequest.update({ where: { id: current.id }, data: { payoutDispatchStartedAt: new Date() } });
    await tx.partnerPayout.update({ where: { id: current.payoutId }, data: { status: "PROCESSING", failureMessage: null } });
  });
  try {
    const payout = await stripe.payouts.create({ amount: request.amountCents, currency: request.payout.currency,
      metadata: { partnerPayoutId: request.payoutId, withdrawalRequestId: request.id } },
    { idempotencyKey: `withdrawal-payout-${request.id}`, stripeAccount: account });
    await saveProviderReference(request.id, "STRIPE", { payoutId: payout.id });
    return { id: request.id, status: "PROCESSING" as const };
  } catch {
    return { id: request.id, status: await actionRequired(request.id, "stripe_payout_outcome_requires_reconciliation", "STRIPE") };
  }
}

/** Recover a PayPal batch ID found through provider records after a timeout.
 * This only attaches a fully matched existing batch; it never sends a payout. */
export async function attachVerifiedPaypalBatch(params: { actorUserId: string; requestId: string; batchId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const batchId = params.batchId.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(batchId)) throw new PartnerWithdrawalError("paypal_batch_reference_invalid");
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request || request.payoutMethod !== "PAYPAL" || !["PROCESSING", "ACTION_REQUIRED"].includes(request.status) ||
      !request.dispatchStartedAt || request.payout.providerBatchId) throw new PartnerWithdrawalError("paypal_batch_attach_conflict");
  const evidence = await (providers.paypalLookup ?? getPaypalPayoutBatch)(batchId);
  if (!paypalEvidenceMatches(request, batchId, evidence)) {
    throw new PartnerWithdrawalError("paypal_batch_attribution_conflict");
  }
  await saveProviderReference(request.id, "PAYPAL", { batchId, senderBatchId: `salento-${request.payoutId}`.slice(0, 36) });
  return { id: request.id, status: request.status, batchAttached: true };
}

export async function reconcilePartnerWithdrawal(params: { actorUserId: string; requestId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  if (request.status === "REQUESTED") return { id: request.id, status: request.status };
  if (request.status === "PAID" || request.status === "FAILED" || request.status === "CANCELED") {
    if (request.payoutMethod === "STRIPE" && request.payout.stripePayoutId) {
      await reconcileStripeProviderEvent(request.id, providers.stripe);
    } else if (request.payoutMethod === "PAYPAL" && request.payout.providerBatchId) {
      const item = await (providers.paypalLookup ?? getPaypalPayoutBatch)(request.payout.providerBatchId);
      if (!paypalEvidenceMatches(request, request.payout.providerBatchId, item)) {
        await recordTerminalConflict(request.id, request.status, "PAYPAL", request.payout.providerBatchId,
          "paypal_batch_attribution_requires_review");
        return { id: request.id, status: request.status };
      }
      const conflict = (request.status === "FAILED" || request.status === "CANCELED") && item.itemStatus === "SUCCESS" ||
        request.status === "PAID" && ["FAILED", "RETURNED", "REFUNDED", "DENIED", "BLOCKED"].includes(item.itemStatus);
      if (conflict) await recordTerminalConflict(request.id, request.status, "PAYPAL", item.itemId ?? request.payout.providerBatchId,
        `late_paypal_${item.itemStatus.toLowerCase()}_requires_review`);
    }
    return { id: request.id, status: request.status };
  }
  if (request.payoutMethod === "POSTEPAY" || request.payoutMethod === "HYPE") return { id: request.id, status: request.status };
  if (request.payoutMethod === "PAYPAL") {
    if (!request.payout.providerBatchId) return { id: request.id, status: await actionRequired(request.id, "paypal_batch_reference_missing", "PAYPAL") };
    const item = await (providers.paypalLookup ?? getPaypalPayoutBatch)(request.payout.providerBatchId);
    if (!paypalEvidenceMatches(request, request.payout.providerBatchId, item)) {
      return { id: request.id, status: await actionRequired(request.id, "paypal_batch_attribution_requires_review", "PAYPAL") };
    }
    if (item.itemStatus === "SUCCESS") return { id: request.id, status: await verifiedPaid(request.id, "PAYPAL", item.itemId ?? request.payout.providerBatchId) };
    if (["FAILED", "RETURNED", "REFUNDED", "DENIED", "BLOCKED"].includes(item.itemStatus)) return { id: request.id, status: await providerFailed(request.id, `paypal_${item.itemStatus.toLowerCase()}`, "PAYPAL", item.itemId ?? request.payout.providerBatchId) };
    return { id: request.id, status: request.status };
  }
  const stripe = providers.stripe ?? getStripe();
  const account = destination(request);
  let payoutId = request.payout.stripePayoutId;
  if (!payoutId) {
    const list = await stripe.payouts.list({ limit: 100 }, { stripeAccount: account });
    const matches = list.data.filter((row) => row.metadata?.withdrawalRequestId === request.id);
    if (list.has_more || matches.length > 1) return { id: request.id, status: await actionRequired(request.id, "stripe_payout_attribution_ambiguous", "STRIPE") };
    payoutId = matches[0]?.id ?? null;
    if (payoutId) await saveProviderReference(request.id, "STRIPE", { payoutId });
  }
  if (!payoutId) {
    if (!request.payout.stripeTransferId) {
      const transfers = await stripe.transfers.list({ transfer_group: request.id, limit: 100 });
      const matches = transfers.data.filter((row) => row.metadata?.withdrawalRequestId === request.id);
      if (!transfers.has_more && matches.length === 1) await saveProviderReference(request.id, "STRIPE", { transferId: matches[0].id });
    }
    return { id: request.id, status: await actionRequired(request.id, "stripe_payout_not_verified", "STRIPE") };
  }
  const payout = await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: account });
  if (payout.metadata?.withdrawalRequestId !== request.id || payout.amount !== request.amountCents ||
      payout.currency.toLowerCase() !== request.payout.currency.toLowerCase()) {
    throw new PartnerWithdrawalError("stripe_payout_attribution_conflict");
  }
  if (payout.status === "paid") return { id: request.id, status: await verifiedPaid(request.id, "STRIPE", payout.id) };
  if (payout.status === "failed" || payout.status === "canceled") return { id: request.id, status: await providerFailed(request.id, `stripe_${payout.status}`, "STRIPE", payout.id) };
  return { id: request.id, status: request.status };
}

/** Signed Connect webhooks use the same current-provider reconciliation. */
export async function reconcileWithdrawalStripePayoutEvent(payoutId: string, stripe?: Stripe, eventType?: string, stripeAccountId?: string | null) {
  const request = await prisma.partnerWithdrawalRequest.findFirst({ where: { payout: { stripePayoutId: payoutId } }, include: { payout: true } });
  if (!request) return false;
  if (stripeAccountId && stripeAccountId !== request.payout.stripeConnectedAccountId) throw new PartnerWithdrawalError("stripe_account_attribution_conflict");
  // No actor is needed for a verified, signed provider event. Use an internal
  // provider path rather than impersonating an Admin.
  await reconcileStripeProviderEvent(request.id, stripe, eventType);
  return true;
}

async function reconcileStripeProviderEvent(id: string, providedStripe?: Stripe, eventType?: string) {
  const request = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id }, include: { payout: true } });
  const terminal = request.status === "PAID" || request.status === "CANCELED" || request.status === "FAILED";
  if (terminal && (request.status === "PAID" && eventType === "payout.paid" ||
      request.status === "FAILED" && eventType === "payout.failed")) return request.status;
  if (!request.payout.stripePayoutId) throw new PartnerWithdrawalError("stripe_payout_reference_missing");
  const stripe = providedStripe ?? getStripe();
  const payout = await stripe.payouts.retrieve(request.payout.stripePayoutId, {}, { stripeAccount: destination(request) });
  if (payout.metadata?.withdrawalRequestId !== request.id || payout.amount !== request.amountCents || payout.currency.toLowerCase() !== request.payout.currency.toLowerCase()) throw new PartnerWithdrawalError("stripe_payout_attribution_conflict");
  if (terminal) {
    const conflicting = request.status === "PAID" && payout.status !== "paid" ||
      request.status === "FAILED" && payout.status === "paid" || request.status === "CANCELED" && payout.status === "paid";
    if (conflicting) await recordTerminalConflict(id, request.status, "STRIPE", payout.id, `late_stripe_${payout.status}_requires_review`);
    return request.status;
  }
  if (payout.status === "paid") return verifiedPaid(id, "STRIPE", payout.id);
  if (payout.status === "failed" || payout.status === "canceled") return providerFailed(id, `stripe_${payout.status}`, "STRIPE", payout.id);
  return request.status;
}

export async function getWithdrawalAdminReview(actorUserId: string, id: string) {
  await requireAdmin(actorUserId);
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id }, include: { payout: true,
    manualBankReturn: { select: { id: true, bankReturnReference: true, amountCents: true, verifiedAt: true } } } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  const value = destination(request);
  const approvedCredit = request.manualBankReturn && await prisma.partnerCommission.findUnique({
    where: { sourceKey: bankReturnCreditSourceKey(request.manualBankReturn.id) }, select: { id: true },
  });
  return { id: request.id, status: request.status, amountCents: request.amountCents,
    method: request.payoutMethod, destinationMasked: request.payoutMethod === "STRIPE" ? `••••${value.slice(-4)}` :
      request.payoutMethod === "PAYPAL" ? `${value.slice(0, 2)}••••@${value.split("@")[1]}` : `••••${value.slice(-4)}`,
    manualTransferInitiatedAt: request.manualTransferInitiatedAt,
    manualTransferReference: request.manualTransferReference,
    bankReturn: request.manualBankReturn ? { ...request.manualBankReturn, creditApproved: Boolean(approvedCredit) } : null,
  };
}

export async function revealManualWithdrawalDestination(actorUserId: string, id: string) {
  await requireAdmin(actorUserId);
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id }, include: { payout: true } });
  if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod)) throw new PartnerWithdrawalError("manual_withdrawal_required");
  const iban = destination(request);
  await prisma.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: id, fromStatus: request.status, toStatus: request.status, actorUserId, reason: "destination_revealed" } });
  return { iban, method: request.payoutMethod };
}

export async function recordManualTransferInitiated(params: { actorUserId: string; requestId: string; reference: string; bankName: string }) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  if (params.reference.trim().length < 6 || params.reference.length > 160 || params.bankName.trim().length < 2 || params.bankName.length > 120) throw new PartnerWithdrawalError("manual_reference_required");
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, params.requestId);
    if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) || request.status !== "PROCESSING" || request.payout.status !== "PROCESSING" || request.manualTransferInitiatedAt) throw new PartnerWithdrawalError("manual_transfer_state_conflict");
    await assertReservedAndSafe(tx, request);
    destination(request);
    const now = new Date();
    await tx.partnerWithdrawalRequest.update({ where: { id: request.id }, data: { manualTransferInitiatedAt: now, manualTransferReference: params.reference.trim(), manualBankName: params.bankName.trim(), manualInitiatedByUserId: params.actorUserId } });
    await audit(tx, request, "PROCESSING", { actorUserId: params.actorUserId, provider: "BANK", providerReference: params.reference.trim(), reason: "manual_transfer_initiated_outside_site" });
    return { id: request.id, status: "PROCESSING" as const };
  });
}

export async function confirmManualWithdrawalSettlement(params: { actorUserId: string; requestId: string; evidence: string; confirmedReceived: boolean }) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  if (!params.confirmedReceived || params.evidence.trim().length < 20 || params.evidence.length > 2000) throw new PartnerWithdrawalError("settlement_evidence_required");
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId } });
  if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) || !request.manualTransferInitiatedAt || !request.manualTransferReference) throw new PartnerWithdrawalError("manual_transfer_state_conflict");
  return { id: request.id, status: await verifiedPaid(request.id, "BANK", request.manualTransferReference, params.actorUserId, params.evidence.trim()) };
}

export async function recordManualWithdrawalException(params: { actorUserId: string; requestId: string; outcome: "FAILED" | "RETURNED" | "UNCERTAIN"; evidence: string }) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  if (params.evidence.trim().length < 20 || params.evidence.length > 2000) throw new PartnerWithdrawalError("manual_exception_evidence_required");
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId } });
  if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) || !request.manualTransferInitiatedAt) throw new PartnerWithdrawalError("manual_transfer_state_conflict");
  const reason = `manual_${params.outcome.toLowerCase()}`;
  if (request.status === "PAID") {
    throw new PartnerWithdrawalError(params.outcome === "RETURNED" ? "verified_bank_return_required" : "manual_transfer_state_conflict");
  }
  const status = params.outcome === "UNCERTAIN"
    ? await actionRequired(request.id, reason, "BANK")
    : await providerFailed(request.id, reason, "BANK", request.manualTransferReference ?? undefined);
  await prisma.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, fromStatus: status, toStatus: status ?? request.status, actorUserId: params.actorUserId, provider: "BANK", providerReference: request.manualTransferReference, reason, evidenceEncrypted: encryptPayoutDestination(params.evidence.trim()) } });
  return { id: request.id, status };
}

/** Record one verified full or partial bank return, without changing PAID. */
export async function recordVerifiedManualBankReturn(params: {
  actorUserId: string; requestId: string; bankReturnReference: string;
  amountCents: number; evidence: string; verifiedReturned: boolean;
}) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const reference = params.bankReturnReference.trim();
  const evidence = params.evidence.trim();
  if (!params.verifiedReturned || reference.length < 6 || reference.length > 160 ||
      evidence.length < 20 || evidence.length > 2000 || !Number.isSafeInteger(params.amountCents) || params.amountCents <= 0) {
    throw new PartnerWithdrawalError("bank_return_evidence_required");
  }
  try { return await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, params.requestId);
    const settled = request?.status === "PAID" && request.payout.status === "PAID";
    const sentButUnsettled = request && ["PROCESSING", "ACTION_REQUIRED", "FAILED"].includes(request.status) &&
      request.payout.status !== "PAID" && Boolean(request.manualTransferInitiatedAt);
    if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) ||
        (!settled && !sentButUnsettled) || !request.manualTransferReference ||
        params.amountCents > request.amountCents) {
      throw new PartnerWithdrawalError("bank_return_state_conflict");
    }
    const prior = await tx.partnerManualBankReturn.findUnique({ where: { withdrawalRequestId: request.id } });
    if (prior) {
      if (prior.bankReturnReference !== reference || prior.amountCents !== params.amountCents) throw new PartnerWithdrawalError("bank_return_conflict");
      return { id: request.id, status: request.status, reviewRequired: true, alreadyRecorded: true };
    }
    const other = await tx.partnerManualBankReturn.findFirst({ where: { bankReturnReference: reference }, select: { id: true } });
    if (other) throw new PartnerWithdrawalError("bank_return_conflict");
    await tx.partnerManualBankReturn.create({ data: {
      withdrawalRequestId: request.id, bankReturnReference: reference,
      amountCents: params.amountCents, evidenceEncrypted: encryptPayoutDestination(evidence),
      verifiedByUserId: params.actorUserId,
    } });
    await tx.partnerWithdrawalAuditEvent.create({ data: {
      withdrawalRequestId: request.id, fromStatus: request.status, toStatus: request.status,
      actorUserId: params.actorUserId, provider: "BANK", providerReference: reference,
      reason: "verified_bank_return_pending_accounting", evidenceEncrypted: encryptPayoutDestination(evidence),
    } });
    return { id: request.id, status: request.status, reviewRequired: true, alreadyRecorded: false };
  }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const prior = await prisma.partnerManualBankReturn.findUnique({ where: { withdrawalRequestId: params.requestId } });
      if (prior?.bankReturnReference === reference && prior.amountCents === params.amountCents) {
        const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, select: { status: true } });
        return { id: params.requestId, status: request?.status ?? "ACTION_REQUIRED", reviewRequired: true, alreadyRecorded: true };
      }
      throw new PartnerWithdrawalError("bank_return_conflict");
    }
    throw error;
  }
}

/** Approves only the verified returned amount as a recovery adjustment.
 * The original paid commissions and payout are never reclassified. */
export async function approveVerifiedBankReturnCredit(params: { actorUserId: string; requestId: string; note: string }) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  const note = params.note.trim();
  if (note.length < 20 || note.length > 2000) throw new PartnerWithdrawalError("bank_return_approval_note_required");
  const approve = () => prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, params.requestId);
    const returned = await tx.partnerManualBankReturn.findUnique({ where: { withdrawalRequestId: params.requestId } });
    if (!request || !returned || request.status !== "PAID" || request.payout.status !== "PAID") {
      throw new PartnerWithdrawalError("bank_return_state_conflict");
    }
    const sourceKey = bankReturnCreditSourceKey(returned.id);
    const prior = await tx.partnerCommission.findUnique({ where: { sourceKey } });
    if (prior) {
      if (prior.partnerUserId !== request.partnerUserId || prior.amountCents !== returned.amountCents ||
          prior.type !== "ADJUSTMENT" || prior.sourceEventId !== returned.id) throw new PartnerWithdrawalError("bank_return_credit_conflict");
      return { id: request.id, creditId: prior.id, amountCents: prior.amountCents, alreadyApproved: true };
    }
    const credit = { partnerUserId: request.partnerUserId, amountCents: returned.amountCents,
      sourceEventType: "VERIFIED_BANK_RETURN", sourceEventId: returned.id, sourceKey };
    if (!await bankReturnCreditSafe(tx, credit)) throw new PartnerWithdrawalError("bank_return_credit_hold");
    const created = await tx.partnerCommission.create({ data: { ...credit, currency: request.payout.currency,
      type: "ADJUSTMENT", status: "AVAILABLE", eligibleAt: new Date() } });
    await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, fromStatus: "PAID", toStatus: "PAID",
      actorUserId: params.actorUserId, provider: "BANK", providerReference: returned.bankReturnReference,
      reason: "bank_return_credit_approved", evidenceEncrypted: encryptPayoutDestination(note) } });
    return { id: request.id, creditId: created.id, amountCents: created.amountCents, alreadyApproved: false };
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await approve(); }
    catch (error) {
      const concurrent = error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034" || error.message.includes("SQLITE_BUSY"));
      if (!concurrent) throw error;
      const returned = await prisma.partnerManualBankReturn.findUnique({ where: { withdrawalRequestId: params.requestId } });
      const prior = returned && await prisma.partnerCommission.findUnique({ where: { sourceKey: bankReturnCreditSourceKey(returned.id) } });
      if (prior && prior.sourceEventId === returned?.id && prior.amountCents === returned.amountCents) {
        return { id: params.requestId, creditId: prior.id, amountCents: prior.amountCents, alreadyApproved: true };
      }
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new PartnerWithdrawalError("bank_return_credit_conflict");
}

export async function cancelUnsentManualWithdrawal(params: { actorUserId: string; requestId: string; confirmation: string }) {
  await requireAdmin(params.actorUserId);
  requireReconciliationEnabled();
  if (params.confirmation.trim().length < 20 || params.confirmation.length > 2000) throw new PartnerWithdrawalError("no_transfer_evidence_required");
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, params.requestId);
    if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) ||
        !["REQUESTED", "PROCESSING", "ACTION_REQUIRED"].includes(request.status) ||
        request.manualTransferInitiatedAt || request.payout.stripeTransferId || request.payout.stripePayoutId || request.payout.providerBatchId) {
      throw new PartnerWithdrawalError("withdrawal_not_cancelable");
    }
    assertWithdrawalTransition(request.status, "CANCELED", { confirmedNoTransfer: true });
    const reserved = await tx.partnerCommission.findMany({ where: { payoutId: request.payoutId, type: "COMMISSION" }, select: { status: true, amountCents: true } });
    if (!reserved.length || reserved.some((row) => row.status !== "RESERVED") ||
        reserved.reduce((sum, row) => sum + row.amountCents, 0) !== request.amountCents) throw new PartnerWithdrawalError("withdrawal_reservation_mismatch");
    await tx.partnerWithdrawalRequest.update({ where: { id: request.id }, data: { status: "CANCELED", failureReason: "manual_transfer_not_sent" } });
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "CANCELED", canceledAt: new Date(), failureMessage: "manual_transfer_not_sent" } });
    await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId, status: "RESERVED" }, data: { payoutId: null, status: "AVAILABLE" } });
    await tx.partnerPayoutRun.update({ where: { id: request.payout.payoutRunId }, data: { status: "COMPLETED", completedAt: new Date() } });
    await audit(tx, request, "CANCELED", { actorUserId: params.actorUserId, provider: "BANK", reason: "manual_transfer_not_sent" });
    await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, fromStatus: "CANCELED", toStatus: "CANCELED", actorUserId: params.actorUserId, provider: "BANK", reason: "no_transfer_evidence_recorded", evidenceEncrypted: encryptPayoutDestination(params.confirmation.trim()) } });
    return { id: request.id, status: "CANCELED" as const };
  });
}
