import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type Stripe from "stripe";
import { addUtcDays } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import { payableCommissionWhere, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { encryptPayoutDestination } from "@/lib/partner-payout-methods";
import { createPartnerWithdrawalRequest, PartnerWithdrawalError } from "@/lib/partner-withdrawals";
import {
  attachVerifiedPaypalBatch, cancelUnsentManualWithdrawal, confirmManualWithdrawalSettlement, continueStripeWithdrawalPayout, getWithdrawalAdminReview,
  processPartnerWithdrawal, reconcilePartnerWithdrawal, reconcileWithdrawalStripePayoutEvent,
  recordManualTransferInitiated, recordManualWithdrawalException, recordVerifiedManualBankReturn, revealManualWithdrawalDestination,
} from "@/lib/partner-withdrawal-processing";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-withdrawal-processing-"));
const dbPath = join(directory, "isolated.db");
writeFileSync(dbPath, "");
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PAYOUT_DATA_ENCRYPTION_KEY = "synthetic-processing-key";
process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
process.env.PARTNER_CASHOUT_PROCESSING_ENABLED = "true";
process.env.PARTNER_CASHOUT_RECONCILIATION_ENABLED = "true";
process.env.PARTNER_PAYOUT_MODE = "cashout";
process.env.PAYPAL_CLIENT_ID = "synthetic-client";
process.env.PAYPAL_CLIENT_SECRET = "synthetic-secret";
process.env.PAYPAL_PAYOUTS_ENABLED = "true";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
execFileSync("sqlite3", [dbPath, 'CREATE UNIQUE INDEX "PartnerWithdrawalRequest_one_unresolved_per_partner_key" ON "PartnerWithdrawalRequest"("partnerUserId") WHERE "status" NOT IN (\'PAID\', \'CANCELED\')']);
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

const admin = { id: "processing-admin" };
before(async () => { await prisma.user.create({ data: { id: admin.id, username: admin.id, email: "processing-admin@example.test", role: "ADMIN" } }); });
let sequence = 0;
async function requested(method: "STRIPE" | "PAYPAL" | "POSTEPAY" = "STRIPE") {
  const f = await createRefundFixture(prisma, `processing-${++sequence}`, addUtcDays(new Date(), -20));
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: method, payoutSetupStatus: "READY", stripeAccountStatus: "READY",
    stripePayoutsEnabled: true, stripeConnectedAccountId: `acct_${f.partner.id}`,
    paypalPayoutEmail: "original@example.test",
    bankPayoutIbanEncrypted: encryptPayoutDestination("IT60X0542811101000000123456"), bankPayoutAccountLast4: "3456",
  } });
  const withdrawal = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: `processing-key-${f.partner.id}` });
  return { ...f, withdrawal };
}

async function paypalEvidence(requestId: string, itemStatus: string, itemId: string | null = null) {
  const payout = await prisma.partnerPayout.findFirstOrThrow({ where: { withdrawalRequest: { id: requestId } } });
  return { batchId: payout.providerBatchId, senderBatchId: `salento-${payout.id}`.slice(0, 36),
    totalItems: 1, receiver: "original@example.test", senderItemId: payout.id,
    amountValue: "50.00", currency: "EUR", batchStatus: "SUCCESS", itemId, itemStatus };
}

function stripeHarness(requestId: string, payoutId: string) {
  let payoutStatus = "pending";
  let failPayoutCreate = false;
  let failTransferCreate = false;
  let accountEligible = true;
  let listedPayout = false;
  let transferCount = 0;
  let payoutCount = 0;
  let onTransfer: (() => Promise<unknown>) | null = null;
  const transfer = { id: `tr_${requestId}`, destination: "", transfer_group: requestId, amount: 5000, currency: "eur", reversed: false, amount_reversed: 0, metadata: { withdrawalRequestId: requestId } };
  const payout = { id: `po_${requestId}`, amount: 5000, currency: "eur", status: payoutStatus, metadata: { withdrawalRequestId: requestId } };
  const stripe = {
    accounts: { retrieve: async () => ({ payouts_enabled: accountEligible }) },
    transfers: {
      create: async (params: { destination: string; amount: number; currency: string }) => { transferCount++; transfer.destination = params.destination; transfer.amount = params.amount; transfer.currency = params.currency; if (failTransferCreate) throw new Error("synthetic_transfer_timeout"); if (onTransfer) await onTransfer(); return transfer; },
      retrieve: async () => transfer,
      list: async () => ({ data: transferCount ? [transfer] : [], has_more: false }),
    },
    payouts: {
      create: async () => { payoutCount++; if (failPayoutCreate) throw new Error("synthetic_payout_timeout"); return { ...payout, status: payoutStatus }; },
      retrieve: async () => ({ ...payout, status: payoutStatus }),
      list: async () => ({ data: listedPayout ? [{ ...payout, status: payoutStatus }] : [], has_more: false }),
    },
  } as unknown as Stripe;
  return { stripe, setStatus(value: string) { payoutStatus = value; }, setPayoutFailure(value: boolean) { failPayoutCreate = value; },
    setOnTransfer(value: () => Promise<unknown>) { onTransfer = value; },
    setTransferFailure(value: boolean) { failTransferCreate = value; }, setAccountEligible(value: boolean) { accountEligible = value; },
    setListedPayout(value: boolean) { listedPayout = value; }, counts() { return { transferCount, payoutCount }; }, payoutId };
}

test("Stripe transfer and payout remain processing until verified paid; duplicate and late webhook are safe", async () => {
  const f = await requested();
  const payout = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } });
  const h = stripeHarness(f.withdrawal.id, payout.payoutId);
  assert.deepEqual(await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), { id: f.withdrawal.id, status: "PROCESSING" });
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PROCESSING");
  h.setStatus("paid");
  assert.equal(await reconcileWithdrawalStripePayoutEvent(`po_${f.withdrawal.id}`, h.stripe), true);
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PAID");
  const count = await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: f.withdrawal.id } });
  await reconcileWithdrawalStripePayoutEvent(`po_${f.withdrawal.id}`, h.stripe);
  h.setStatus("failed");
  await reconcileWithdrawalStripePayoutEvent(`po_${f.withdrawal.id}`, h.stripe, "payout.failed");
  assert.equal(await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: f.withdrawal.id } }), count + 1);
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
  assert.equal(h.counts().transferCount, 1);
});

test("a recorded Stripe transfer can continue once after a pre-payout hold, without a second transfer", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  h.setOnTransfer(() => prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } }));
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  const held = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } });
  assert.ok(held.stripeTransferRecordedAt);
  assert.equal(held.payoutDispatchStartedAt, null);
  assert.deepEqual(h.counts(), { transferCount: 1, payoutCount: 0 });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundStatus: "support_closed" } });
  assert.equal((await continueStripeWithdrawalPayout({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PROCESSING");
  assert.deepEqual(h.counts(), { transferCount: 1, payoutCount: 1 });
  await assert.rejects(() => continueStripeWithdrawalPayout({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "stripe_continuation_not_safe");
  h.setStatus("paid");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PAID");
});

test("legacy transfer records without dispatch evidence cannot be auto-continued", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  h.setOnTransfer(() => prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } }));
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe });
  await prisma.partnerWithdrawalRequest.update({ where: { id: f.withdrawal.id }, data: { stripeTransferRecordedAt: null } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundStatus: "support_closed" } });
  await assert.rejects(() => continueStripeWithdrawalPayout({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "stripe_continuation_not_safe");
  assert.deepEqual(h.counts(), { transferCount: 1, payoutCount: 0 });
});

test("Stripe transfer success with payout timeout keeps reservation and reconciles late payout", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  h.setPayoutFailure(true);
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  const payout = await prisma.partnerPayout.findFirstOrThrow({ where: { withdrawalRequest: { id: f.withdrawal.id } } });
  assert.equal(payout.stripeTransferId, `tr_${f.withdrawal.id}`);
  assert.equal(payout.stripePayoutId, null);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  assert.equal(h.counts().transferCount, 1);
  h.setListedPayout(true);
  h.setStatus("paid");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PAID");
});

test("Stripe transfer timeout is reconciled without a second transfer", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  h.setTransferFailure(true);
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  assert.equal(h.counts().transferCount, 1);
  assert.equal((await prisma.partnerPayout.findFirstOrThrow({ where: { withdrawalRequest: { id: f.withdrawal.id } } })).stripeTransferId, `tr_${f.withdrawal.id}`);
});

test("Stripe ineligible account blocks provider dispatch", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  h.setAccountEligible(false);
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
  assert.equal(h.counts().transferCount, 0);
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).dispatchStartedAt, null);
  h.setAccountEligible(true);
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PROCESSING");
  assert.equal(h.counts().transferCount, 1);
});

test("verified Stripe payout failure keeps funds reserved for review", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe });
  h.setStatus("failed");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "FAILED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  h.setStatus("paid");
  await reconcileWithdrawalStripePayoutEvent(`po_${f.withdrawal.id}`, h.stripe, "payout.paid");
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "FAILED");
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).failureReason, "late_stripe_paid_requires_review");
});

test("PayPal uses immutable recipient, stays pending, and settles only after lookup", async () => {
  const f = await requested("PAYPAL");
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { paypalPayoutEmail: "changed@example.test" } });
  let recipient = "";
  let calls = 0;
  const paypalCreate = async (params: { amountCents: number; payoutId: string; recipientEmail: string }) => {
    calls++; recipient = params.recipientEmail;
    return { batchId: `batch_${f.withdrawal.id}`, providerReference: `salento-${params.payoutId}`.slice(0, 36), status: "PENDING" };
  };
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalCreate })).status, "PROCESSING");
  assert.equal(recipient, "original@example.test");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalLookup: async () => paypalEvidence(f.withdrawal.id, "PENDING") })).status, "PROCESSING");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalLookup: async () => paypalEvidence(f.withdrawal.id, "SUCCESS", `item_${f.withdrawal.id}`) })).status, "PAID");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalLookup: async () => paypalEvidence(f.withdrawal.id, "SUCCESS", `item_${f.withdrawal.id}`) })).status, "PAID");
  assert.equal(calls, 1);
});

test("PayPal reconciliation holds mismatched recipient and preserves reservations", async () => {
  const f = await requested("PAYPAL");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalCreate: async (params) => ({
    batchId: `batch_${f.withdrawal.id}`, providerReference: `salento-${params.payoutId}`.slice(0, 36), status: "PENDING",
  }) });
  const result = await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, {
    paypalLookup: async () => ({ ...await paypalEvidence(f.withdrawal.id, "SUCCESS", "item-wrong"), receiver: "wrong@example.test" }),
  });
  assert.equal(result.status, "ACTION_REQUIRED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
});

test("PayPal timeout and later provider failure retain reservations", async () => {
  const timeout = await requested("PAYPAL");
  let calls = 0;
  const paypalCreate = async () => { calls++; throw new Error("synthetic_timeout_after_acceptance"); };
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: timeout.withdrawal.id }, { paypalCreate })).status, "ACTION_REQUIRED");
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: timeout.withdrawal.id }, { paypalCreate })).status, "ACTION_REQUIRED");
  assert.equal(calls, 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: timeout.commission.id } })).status, "RESERVED");
  const timeoutPayout = await prisma.partnerPayout.findFirstOrThrow({ where: { withdrawalRequest: { id: timeout.withdrawal.id } } });
  assert.equal(timeoutPayout.providerReference, `salento-${timeoutPayout.id}`.slice(0, 36));
  const failed = await requested("PAYPAL");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: failed.withdrawal.id }, { paypalCreate: async (params) => ({ batchId: `batch_${failed.withdrawal.id}`, providerReference: `salento-${params.payoutId}`.slice(0, 36), status: "PENDING" }) });
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: failed.withdrawal.id }, { paypalLookup: async () => paypalEvidence(failed.withdrawal.id, "RETURNED", "item_failed") })).status, "FAILED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: failed.commission.id } })).status, "RESERVED");
  const beforeConflict = await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: failed.withdrawal.id } });
  const late = { paypalLookup: async () => paypalEvidence(failed.withdrawal.id, "SUCCESS", "item_failed") };
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: failed.withdrawal.id }, late)).status, "FAILED");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: failed.withdrawal.id }, late)).status, "FAILED");
  assert.equal((await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: failed.withdrawal.id } })), beforeConflict + 1);
});

test("PayPal timeout can attach only a fully matched existing batch without dispatching again", async () => {
  const f = await requested("PAYPAL");
  let createCalls = 0;
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { paypalCreate: async () => { createCalls++; throw new Error("synthetic_timeout"); } });
  const payout = await prisma.partnerPayout.findFirstOrThrow({ where: { withdrawalRequest: { id: f.withdrawal.id } } });
  const batchId = `batch_${f.withdrawal.id}`;
  const evidence = { batchId, senderBatchId: `salento-${payout.id}`.slice(0, 36), totalItems: 1,
    receiver: "original@example.test", senderItemId: payout.id, amountValue: "50.00", currency: "EUR",
    batchStatus: "PENDING", itemId: null, itemStatus: "PENDING" };
  await assert.rejects(() => attachVerifiedPaypalBatch({ actorUserId: admin.id, requestId: f.withdrawal.id, batchId },
    { paypalLookup: async () => ({ ...evidence, receiver: "other@example.test" }) }),
  (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "paypal_batch_attribution_conflict");
  assert.equal((await attachVerifiedPaypalBatch({ actorUserId: admin.id, requestId: f.withdrawal.id, batchId },
    { paypalLookup: async () => evidence })).batchAttached, true);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).providerBatchId, batchId);
  assert.equal(createCalls, 1);
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id },
    { paypalLookup: async () => paypalEvidence(f.withdrawal.id, "SUCCESS", "item-recovered") })).status, "PAID");
});

test("manual IBAN review masks by default, reveal is audited, and verified settlement pays", async () => {
  const f = await requested("POSTEPAY");
  const review = await getWithdrawalAdminReview(admin.id, f.withdrawal.id);
  assert.equal(review.destinationMasked, "••••3456");
  assert.equal(JSON.stringify(review).includes("IT60"), false);
  await assert.rejects(() => revealManualWithdrawalDestination(f.partner.id, f.withdrawal.id), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "admin_required");
  assert.equal((await revealManualWithdrawalDestination(admin.id, f.withdrawal.id)).iban, "IT60X0542811101000000123456");
  assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id })).status, "PROCESSING");
  await assert.rejects(() => confirmManualWithdrawalSettlement({ actorUserId: admin.id, requestId: f.withdrawal.id, evidence: "Too short", confirmedReceived: true }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "settlement_evidence_required");
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: f.withdrawal.id, reference: "bank-ref-123456", bankName: "Test Bank" });
  await assert.rejects(() => confirmManualWithdrawalSettlement({ actorUserId: admin.id, requestId: f.withdrawal.id, evidence: "Bank statement confirms receipt on test date", confirmedReceived: false }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "settlement_evidence_required");
  assert.equal((await confirmManualWithdrawalSettlement({ actorUserId: admin.id, requestId: f.withdrawal.id, evidence: "Bank statement confirms receipt on test date", confirmedReceived: true })).status, "PAID");
  const settled = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } });
  assert.equal(settled.settlementEvidenceEncrypted?.startsWith("v1."), true);
  assert.equal(settled.settlementEvidenceEncrypted?.includes("Bank statement"), false);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PAID");
  assert.equal((await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: f.withdrawal.id } })) >= 5, true);
});

test("manual uncertainty, definitive return, and post-settlement return preserve audit and funds", async () => {
  const uncertain = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: uncertain.withdrawal.id });
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: uncertain.withdrawal.id, reference: "bank-ref-uncertain", bankName: "Test Bank" });
  assert.equal((await recordManualWithdrawalException({ actorUserId: admin.id, requestId: uncertain.withdrawal.id, outcome: "UNCERTAIN", evidence: "Bank trace has no conclusive settlement result" })).status, "ACTION_REQUIRED");
  assert.equal(await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: uncertain.withdrawal.id, evidenceEncrypted: { startsWith: "v1." } } }), 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: uncertain.commission.id } })).status, "RESERVED");
  const returned = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: returned.withdrawal.id });
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: returned.withdrawal.id, reference: "bank-ref-returned", bankName: "Test Bank" });
  assert.equal((await recordManualWithdrawalException({ actorUserId: admin.id, requestId: returned.withdrawal.id, outcome: "RETURNED", evidence: "Bank statement shows definitive returned transfer" })).status, "FAILED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: returned.commission.id } })).status, "RESERVED");
  const failed = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: failed.withdrawal.id });
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: failed.withdrawal.id, reference: "bank-ref-failed", bankName: "Test Bank" });
  assert.equal((await recordManualWithdrawalException({ actorUserId: admin.id, requestId: failed.withdrawal.id, outcome: "FAILED", evidence: "Bank confirms transfer definitively failed" })).status, "FAILED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: failed.commission.id } })).status, "RESERVED");
  const settled = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: settled.withdrawal.id });
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: settled.withdrawal.id, reference: "bank-ref-settled", bankName: "Test Bank" });
  await confirmManualWithdrawalSettlement({ actorUserId: admin.id, requestId: settled.withdrawal.id, evidence: "Bank statement confirms completed settlement", confirmedReceived: true });
  await assert.rejects(() => recordManualWithdrawalException({ actorUserId: admin.id, requestId: settled.withdrawal.id, outcome: "RETURNED", evidence: "Later bank return notice requires investigation" }),
    (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "verified_bank_return_required");
  const returnInput = { actorUserId: admin.id, requestId: settled.withdrawal.id, bankReturnReference: "return-ref-123456", amountCents: 5000,
    evidence: "Bank statement verifies the complete returned amount", verifiedReturned: true };
  assert.equal((await recordVerifiedManualBankReturn(returnInput)).alreadyRecorded, false);
  assert.equal((await recordVerifiedManualBankReturn(returnInput)).alreadyRecorded, true);
  assert.equal(await prisma.partnerManualBankReturn.count({ where: { withdrawalRequestId: settled.withdrawal.id } }), 1);
  await assert.rejects(() => recordVerifiedManualBankReturn({ ...returnInput, bankReturnReference: "different-return-reference" }),
    (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "bank_return_conflict");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: settled.commission.id } })).status, "PAID");
});

test("manual cancellation is allowed only with evidence that no transfer was sent", async () => {
  const f = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id });
  assert.equal((await cancelUnsentManualWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id, confirmation: "Bank transfer was not initiated or submitted" })).status, "CANCELED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).payoutId, null);
  const sent = await requested("POSTEPAY");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: sent.withdrawal.id });
  await recordManualTransferInitiated({ actorUserId: admin.id, requestId: sent.withdrawal.id, reference: "bank-ref-sent", bankName: "Test Bank" });
  await assert.rejects(() => cancelUnsentManualWithdrawal({ actorUserId: admin.id, requestId: sent.withdrawal.id, confirmation: "Bank transfer was definitely not initiated" }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_not_cancelable");
});

test("non-Admin and disabled processing cannot call providers", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  await assert.rejects(() => processPartnerWithdrawal({ actorUserId: f.partner.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "admin_required");
  process.env.PARTNER_CASHOUT_PROCESSING_ENABLED = "false";
  await assert.rejects(() => processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_processing_disabled");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "REQUESTED");
  process.env.PARTNER_CASHOUT_RECONCILIATION_ENABLED = "false";
  await assert.rejects(() => reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_reconciliation_disabled");
  await assert.rejects(() => cancelUnsentManualWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id, confirmation: "No bank transfer was sent or initiated" }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_reconciliation_disabled");
  await assert.rejects(() => confirmManualWithdrawalSettlement({ actorUserId: admin.id, requestId: f.withdrawal.id, evidence: "Bank statement confirms receipt on test date", confirmedReceived: true }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_reconciliation_disabled");
  await assert.rejects(() => recordManualWithdrawalException({ actorUserId: admin.id, requestId: f.withdrawal.id, outcome: "UNCERTAIN", evidence: "Bank trace does not confirm settlement" }), (error: unknown) => error instanceof PartnerWithdrawalError && error.code === "withdrawal_reconciliation_disabled");
  process.env.PARTNER_CASHOUT_RECONCILIATION_ENABLED = "true";
  process.env.PARTNER_CASHOUT_PROCESSING_ENABLED = "true";
  assert.equal(h.counts().transferCount, 0);
});

test("debt, refund, and dispute arising after reservation block dispatch", async () => {
  for (const kind of ["debt", "refund", "dispute"] as const) {
    const f = await requested();
    if (kind === "debt") await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessId: f.business.id, businessSubmissionId: f.submission.id, paymentId: f.payment.id, amountCents: -5000, type: "REVERSAL", status: "DEBT", sourceKey: `processing-debt:${f.partner.id}` } });
    if (kind === "refund") await prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } });
    if (kind === "dispute") await prisma.partnerPaymentDispute.create({ data: { paymentId: f.payment.id, stripeDisputeId: `dp_${f.partner.id}`, stripeChargeId: `ch_${f.partner.id}`, status: "needs_response", holdActive: true } });
    const h = stripeHarness(f.withdrawal.id, "unused");
    assert.equal((await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "ACTION_REQUIRED");
    assert.equal(h.counts().transferCount, 0);
    assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
    if (kind === "refund") {
      await prisma.payment.update({ where: { id: f.payment.id }, data: { refundStatus: "support_closed" } });
      const resumed = await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe });
      assert.equal(resumed.status, "PROCESSING");
      assert.equal(h.counts().transferCount, 1);
    }
  }
});

test("a dispute after provider dispatch keeps the reservation until settlement reconciliation", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe });
  await prisma.partnerPaymentDispute.create({ data: { paymentId: f.payment.id, stripeDisputeId: `dp_late_${f.partner.id}`, stripeChargeId: `ch_late_${f.partner.id}`, status: "needs_response", holdActive: true } });
  await reversePartnerCommissionForPayment({ eventType: "charge.dispute.closed", reason: "payment_dispute_lost", sourceEventId: `evt_late_${f.partner.id}`, paymentId: f.payment.id }, { revalidatePaths: () => {} });
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, type: "REVERSAL", status: "REVERSED", payoutId: f.withdrawal.payoutId } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 0);
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "ACTION_REQUIRED");
  h.setStatus("paid");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "PAID");
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 1);
});

test("an in-flight reversal remains contingent if the provider fails and blocks weekly eligibility", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  await processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe });
  await reversePartnerCommissionForPayment({ eventType: "charge.refunded", reason: "payment_refunded", sourceEventId: `evt_failed_${f.partner.id}`, paymentId: f.payment.id }, { revalidatePaths: () => {} });
  await prisma.partnerCommission.create({ data: {
    partnerUserId: f.partner.id, businessId: f.business.id, businessSubmissionId: f.submission.id,
    paymentId: f.payment.id, amountCents: 1000, type: "COMMISSION", status: "AVAILABLE",
    eligibleAt: addUtcDays(new Date(), -1), sourceKey: `additional-eligible:${f.partner.id}`,
  } });
  h.setStatus("failed");
  assert.equal((await reconcilePartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })).status, "FAILED");
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, type: "REVERSAL", status: "REVERSED", payoutId: f.withdrawal.payoutId } }), 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date()), partnerUserId: f.partner.id } }), 0);
});

test("concurrent Admin actions claim at most one provider dispatch", async () => {
  const f = await requested();
  const h = stripeHarness(f.withdrawal.id, "unused");
  await Promise.allSettled([1, 2].map(() => processPartnerWithdrawal({ actorUserId: admin.id, requestId: f.withdrawal.id }, { stripe: h.stripe })));
  assert.equal(h.counts().transferCount <= 1, true);
  assert.equal(await prisma.partnerWithdrawalRequest.count({ where: { id: f.withdrawal.id } }), 1);
});
