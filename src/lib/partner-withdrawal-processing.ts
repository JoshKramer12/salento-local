import type Stripe from "stripe";
import type { PartnerWithdrawalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { createPaypalPayout, decryptPayoutDestination, encryptPayoutDestination, getPaypalPayoutBatch, isPaypalPayoutConfigured, isValidItalianIban } from "@/lib/partner-payout-methods";
import { hasValidPartnerCommissionAttribution } from "@/lib/partner-ledger";
import { partnerCashoutRequestsEnabled } from "@/lib/partner-payout-mode";
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

async function assertReservedAndSafe(tx: Db, request: Withdrawal) {
  const [debtCount, rows] = await Promise.all([
    tx.partnerCommission.count({ where: { partnerUserId: request.partnerUserId, amountCents: { lt: 0 }, OR: [
      { status: "DEBT" }, { type: "REVERSAL", status: "REVERSED", payoutId: { not: null } },
    ] } }),
    tx.partnerCommission.findMany({ where: { payoutId: request.payoutId }, select: {
      partnerUserId: true, amountCents: true, status: true, businessId: true, businessSubmissionId: true,
      payment: { select: { businessId: true, businessSubmissionId: true, status: true, paidAt: true, refundRequestedAt: true, refundStatus: true, partnerDisputes: { select: { holdActive: true } } } },
      businessSubmission: { select: { userId: true } },
      business: { select: { membership: { select: { originatingPartnerUserId: true } } } },
    } }),
  ]);
  if (debtCount || !rows.length || rows.reduce((sum, row) => sum + row.amountCents, 0) !== request.amountCents ||
      request.payout.amountCents !== request.amountCents || request.payout.partnerUserId !== request.partnerUserId ||
      request.payout.payoutMethod !== request.payoutMethod || rows.some((row) =>
        row.partnerUserId !== request.partnerUserId || row.status !== "RESERVED" ||
        !hasValidPartnerCommissionAttribution(row, request.partnerUserId) || row.payment?.status !== "PAID" ||
        !row.payment.paidAt || (row.payment.refundRequestedAt && row.payment.refundStatus !== "support_closed") ||
        row.payment.partnerDisputes.some((dispute) => dispute.holdActive))) {
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

async function verifiedPaid(id: string, provider: string, reference: string, actorUserId?: string, evidence?: string) {
  return prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
    if (request.status === "PAID") return "PAID" as const;
    if (request.status !== "PROCESSING" && request.status !== "ACTION_REQUIRED") throw new PartnerWithdrawalError("withdrawal_state_conflict");
    // Settlement can arrive after a refund or dispute. Preserve the external
    // truth, but never settle a mismatched or partly released reservation.
    const reserved = await tx.partnerCommission.findMany({ where: { payoutId: request.payoutId, type: "COMMISSION" }, select: { amountCents: true, partnerUserId: true, status: true } });
    if (!reserved.length || reserved.some((row) => row.partnerUserId !== request.partnerUserId || row.status !== "RESERVED") ||
        reserved.reduce((sum, row) => sum + row.amountCents, 0) !== request.amountCents) throw new PartnerWithdrawalError("withdrawal_reservation_mismatch");
    await transition(tx, request, "PAID", { provider, providerReference: reference, actorUserId, verifiedSettlement: true });
    const now = new Date();
    await tx.partnerWithdrawalRequest.update({ where: { id }, data: { settlementVerifiedAt: now, settlementVerifiedByUserId: actorUserId, settlementEvidenceEncrypted: evidence ? encryptPayoutDestination(evidence) : null } });
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "PAID", paidAt: now, ...(provider === "BANK" ? {} : { providerPayoutId: reference }) } });
    const updated = await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId, type: "COMMISSION", status: "RESERVED" }, data: { status: "PAID", paidAt: now } });
    if (updated.count !== reserved.length) throw new PartnerWithdrawalError("withdrawal_reservation_changed");
    await tx.partnerCommission.updateMany({ where: { payoutId: request.payoutId, type: "REVERSAL", status: "REVERSED", amountCents: { lt: 0 } }, data: { status: "DEBT" } });
    await tx.partnerPayoutRun.update({ where: { id: request.payout.payoutRunId }, data: { status: "COMPLETED", completedAt: now } });
    return "PAID" as const;
  });
}

async function saveProviderReference(id: string, provider: "STRIPE" | "PAYPAL", data: { transferId?: string; payoutId?: string; batchId?: string; senderBatchId?: string }) {
  await prisma.$transaction(async (tx) => {
    const request = await loadWithdrawal(tx, id);
    if (!request || !["PROCESSING", "ACTION_REQUIRED"].includes(request.status)) throw new PartnerWithdrawalError("withdrawal_state_conflict");
    await tx.partnerPayout.update({ where: { id: request.payoutId }, data: {
      ...(data.transferId ? { stripeTransferId: data.transferId } : {}),
      ...(data.payoutId ? { stripePayoutId: data.payoutId } : {}),
      ...(data.batchId ? { providerBatchId: data.batchId } : {}),
      ...(data.senderBatchId ? { providerReference: data.senderBatchId } : {}),
    } });
    await audit(tx, request, request.status, { provider, providerReference: data.payoutId ?? data.batchId ?? data.transferId, reason: "provider_reference_recorded" });
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
    await audit(tx, request, "PROCESSING", { provider, reason: "provider_dispatch_started" });
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
      await saveProviderReference(request.id, "STRIPE", { transferId: transfer.id });
      await assertStillSafe(request.id);
      const payout = await stripe.payouts.create({ amount: request.amountCents, currency: request.payout.currency,
        metadata: { partnerPayoutId: request.payoutId, withdrawalRequestId: request.id } },
      { idempotencyKey: `withdrawal-payout-${request.id}`, stripeAccount: value });
      await saveProviderReference(request.id, "STRIPE", { payoutId: payout.id });
      return { id: request.id, status: "PROCESSING" as const };
    } catch {
      const status = await actionRequired(request.id, "stripe_outcome_requires_reconciliation", "STRIPE");
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

export async function reconcilePartnerWithdrawal(params: { actorUserId: string; requestId: string }, providers: Providers = {}) {
  await requireAdmin(params.actorUserId);
  requireProcessingEnabled();
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId }, include: { payout: true } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  if (request.status === "PAID" || request.status === "CANCELED" || request.status === "FAILED") return { id: request.id, status: request.status };
  if (request.payoutMethod === "POSTEPAY" || request.payoutMethod === "HYPE") return { id: request.id, status: request.status };
  if (request.payoutMethod === "PAYPAL") {
    if (!request.payout.providerBatchId) return { id: request.id, status: await actionRequired(request.id, "paypal_batch_reference_missing", "PAYPAL") };
    const item = await (providers.paypalLookup ?? getPaypalPayoutBatch)(request.payout.providerBatchId);
    if (item.itemStatus === "SUCCESS") return { id: request.id, status: await verifiedPaid(request.id, "PAYPAL", item.itemId ?? request.payout.providerBatchId) };
    if (["FAILED", "RETURNED", "DENIED", "BLOCKED"].includes(item.itemStatus)) return { id: request.id, status: await providerFailed(request.id, `paypal_${item.itemStatus.toLowerCase()}`, "PAYPAL", item.itemId ?? request.payout.providerBatchId) };
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
      request.status === "FAILED" && payout.status === "paid" || request.status === "CANCELED";
    if (conflicting) await prisma.$transaction(async (tx) => {
      await tx.partnerWithdrawalRequest.update({ where: { id }, data: { failureReason: `late_stripe_${payout.status}_requires_review` } });
      await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: id, fromStatus: request.status, toStatus: request.status, provider: "STRIPE", providerReference: payout.id, reason: `late_stripe_${payout.status}_requires_review` } });
    });
    return request.status;
  }
  if (payout.status === "paid") return verifiedPaid(id, "STRIPE", payout.id);
  if (payout.status === "failed" || payout.status === "canceled") return providerFailed(id, `stripe_${payout.status}`, "STRIPE", payout.id);
  return request.status;
}

export async function getWithdrawalAdminReview(actorUserId: string, id: string) {
  await requireAdmin(actorUserId);
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id }, include: { payout: true } });
  if (!request) throw new PartnerWithdrawalError("withdrawal_missing");
  const value = destination(request);
  return { id: request.id, status: request.status, amountCents: request.amountCents,
    method: request.payoutMethod, destinationMasked: request.payoutMethod === "STRIPE" ? `••••${value.slice(-4)}` :
      request.payoutMethod === "PAYPAL" ? `${value.slice(0, 2)}••••@${value.split("@")[1]}` : `••••${value.slice(-4)}`,
    manualTransferInitiatedAt: request.manualTransferInitiatedAt,
    manualTransferReference: request.manualTransferReference,
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
  requireProcessingEnabled();
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
  requireProcessingEnabled();
  if (!params.confirmedReceived || params.evidence.trim().length < 20 || params.evidence.length > 2000) throw new PartnerWithdrawalError("settlement_evidence_required");
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId } });
  if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) || !request.manualTransferInitiatedAt || !request.manualTransferReference) throw new PartnerWithdrawalError("manual_transfer_state_conflict");
  return { id: request.id, status: await verifiedPaid(request.id, "BANK", request.manualTransferReference, params.actorUserId, params.evidence.trim()) };
}

export async function recordManualWithdrawalException(params: { actorUserId: string; requestId: string; outcome: "FAILED" | "RETURNED" | "UNCERTAIN"; evidence: string }) {
  await requireAdmin(params.actorUserId);
  requireProcessingEnabled();
  if (params.evidence.trim().length < 20 || params.evidence.length > 2000) throw new PartnerWithdrawalError("manual_exception_evidence_required");
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id: params.requestId } });
  if (!request || !["POSTEPAY", "HYPE"].includes(request.payoutMethod) || !request.manualTransferInitiatedAt) throw new PartnerWithdrawalError("manual_transfer_state_conflict");
  const reason = `manual_${params.outcome.toLowerCase()}`;
  if (request.status === "PAID") {
    // A bank return after confirmed settlement is a new financial incident.
    // Keep paid history intact and require an explicit reconciliation.
    await prisma.$transaction(async (tx) => {
      await tx.partnerWithdrawalRequest.update({ where: { id: request.id }, data: { failureReason: `${reason}_after_settlement` } });
      await tx.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, fromStatus: "PAID", toStatus: "PAID", actorUserId: params.actorUserId, provider: "BANK", providerReference: request.manualTransferReference, reason: `${reason}_after_settlement`, evidenceEncrypted: encryptPayoutDestination(params.evidence.trim()) } });
    });
    return { id: request.id, status: "PAID" as const, reviewRequired: true };
  }
  const status = params.outcome === "UNCERTAIN"
    ? await actionRequired(request.id, reason, "BANK")
    : await providerFailed(request.id, reason, "BANK", request.manualTransferReference ?? undefined);
  await prisma.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, fromStatus: status, toStatus: status ?? request.status, actorUserId: params.actorUserId, provider: "BANK", providerReference: request.manualTransferReference, reason, evidenceEncrypted: encryptPayoutDestination(params.evidence.trim()) } });
  return { id: request.id, status };
}

export async function cancelUnsentManualWithdrawal(params: { actorUserId: string; requestId: string; confirmation: string }) {
  await requireAdmin(params.actorUserId);
  requireProcessingEnabled();
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
