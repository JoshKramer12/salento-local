import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { reversePartnerCommissionForPayment, runWeeklyPartnerPayouts } from "@/lib/partner-ledger";
import { requestPartnerWithdrawal } from "@/lib/partner-withdrawals";
import {
  handleWithdrawalPayoutEvent, processPartnerWithdrawal,
  reconcilePartnerWithdrawal, requestPartnerPayoutRetry, requestPartnerTransferReversal, runPartnerWithdrawalWorker,
} from "@/lib/partner-withdrawal-processing";
import type {
  AccountEvidence, PayoutEvidence, TransferEvidence, WithdrawalProvider,
} from "@/lib/partner-withdrawal-provider";
import {
  inspectAdminWithdrawal, recordAdminWithdrawalInvestigation, reverseAdminWithdrawalTransfer,
  retryAdminWithdrawalPayout,
} from "@/lib/partner-withdrawal-admin";
import { POST as workerRoute } from "@/app/api/internal/partner-withdrawals/run/route";
import { workerSecretAuthorized } from "@/lib/partner-withdrawal-worker-auth";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-stage2-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.RAILWAY_ENVIRONMENT_NAME = "stage2-isolated-test";
process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "true";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
  env: process.env, stdio: "pipe",
});
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const now = new Date();
const old = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000);
function key() { return `stage2-key-${String(++sequence).padStart(16, "0")}`; }
function auth(partnerId: string) {
  return { authenticate: async () => ({ id: partnerId, role: "GETTER", profileCompleted: true }), now };
}
async function fixture() {
  const f = await createRefundFixture(prisma, key(), old);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: `acct_synthetic_${f.partner.id}`,
    stripeAccountStatus: "READY", stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true, stripeOnboardingComplete: true,
    stripePayoutAccountLast4: "4242", stripeLastSyncedAt: now,
  } });
  const withdrawal = await requestPartnerWithdrawal(key(), auth(f.partner.id));
  return { ...f, withdrawal };
}
async function extraCredit(partnerId: string) {
  const f = await createRefundFixture(prisma, key(), old);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { userId: partnerId } });
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { originatingPartnerUserId: partnerId } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { userId: partnerId, partnerUserId: partnerId } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { partnerUserId: partnerId } });
  return f;
}
async function refund(paymentId: string) {
  await reversePartnerCommissionForPayment({
    eventType: "charge.refunded", reason: "synthetic_stage2_refund", sourceEventId: key(), paymentId,
  }, { revalidatePaths: () => {} });
}

class MockProvider implements WithdrawalProvider {
  transfers = new Map<string, TransferEvidence>();
  payouts = new Map<string, PayoutEvidence>();
  transferCalls = 0;
  payoutCalls = 0;
  reversalCalls = 0;
  reversalFails = false;
  accountCalls = 0;
  transferAcceptedThenTimeout = false;
  transferRejectBeforeAccept = false;
  payoutAcceptedThenTimeout = false;
  payoutRejectBeforeAccept = false;
  payoutInitialStatus = "pending";
  beforeTransferReturn?: () => Promise<void>;
  beforePayoutReturn?: () => Promise<void>;
  lastTransferKey = "";
  lastPayoutKey = "";
  accountOverride?: Partial<AccountEvidence>;
  async account(connectedAccountId: string) {
    this.accountCalls++;
    return { id: connectedAccountId, payoutsEnabled: true, detailsSubmitted: true,
      livemode: true, externalAccountId: "ba_synthetic_4242", externalAccountLast4: "4242",
      ...this.accountOverride };
  }
  async createTransfer(input: Parameters<WithdrawalProvider["createTransfer"]>[0]) {
    this.transferCalls++;
    this.lastTransferKey = input.idempotencyKey;
    if (this.transferRejectBeforeAccept) throw new Error("synthetic_transfer_rejected");
    const result: TransferEvidence = { id: `tr_synthetic_${input.withdrawalId}`,
      withdrawalId: input.withdrawalId, payoutId: input.payoutId,
      amountCents: input.amountCents, currency: input.currency, destination: input.connectedAccountId,
      livemode: true, amountReversedCents: 0 };
    this.transfers.set(result.id, result);
    await this.beforeTransferReturn?.();
    if (this.transferAcceptedThenTimeout) throw new Error("synthetic_transfer_timeout");
    return result;
  }
  async createPayout(input: Parameters<WithdrawalProvider["createPayout"]>[0]) {
    this.payoutCalls++;
    this.lastPayoutKey = input.idempotencyKey;
    if (this.payoutRejectBeforeAccept) throw new Error("synthetic_payout_rejected");
    const result: PayoutEvidence = { id: this.payoutCalls === 1
      ? `po_synthetic_${input.withdrawalId}` : `po_synthetic_${input.withdrawalId}_retry${this.payoutCalls}`,
      withdrawalId: input.withdrawalId, payoutId: input.payoutId, attemptId: input.attemptId,
      amountCents: input.amountCents, currency: input.currency,
      connectedAccountId: input.connectedAccountId, livemode: true,
      status: this.payoutInitialStatus, destinationExternalAccountId: input.externalAccountId,
      failureBalanceTransactionId: this.payoutInitialStatus === "failed" ? "txn_synthetic_return" : null };
    this.payouts.set(result.id, result);
    await this.beforePayoutReturn?.();
    if (this.payoutAcceptedThenTimeout) throw new Error("synthetic_payout_timeout");
    return result;
  }
  async findTransfers(withdrawalId: string) {
    return [...this.transfers.values()].filter((item) => item.withdrawalId === withdrawalId);
  }
  async findPayouts(connectedAccountId: string, _since: Date, withdrawalId: string, attemptId: string) {
    return [...this.payouts.values()].filter((item) =>
      item.connectedAccountId === connectedAccountId && item.withdrawalId === withdrawalId &&
      item.attemptId === attemptId);
  }
  async retrieveTransfer(id: string) {
    const item = this.transfers.get(id);
    if (!item) throw new Error("synthetic_transfer_missing");
    return item;
  }
  async retrievePayout(_connectedAccountId: string, id: string) {
    const item = this.payouts.get(id);
    if (!item) throw new Error("synthetic_payout_missing");
    return item;
  }
  async reverseTransfer(input: Parameters<WithdrawalProvider["reverseTransfer"]>[0]) {
    this.reversalCalls++;
    if (this.reversalFails) throw new Error("synthetic_reversal_failure");
    const current = this.transfers.get(input.transferId)!;
    const transfer = { ...current, amountReversedCents: input.amountCents };
    this.transfers.set(input.transferId, transfer);
    return { reversalId: `trr_synthetic_${input.transferId}`, transfer };
  }
  paid(withdrawalId: string) {
    const id = `po_synthetic_${withdrawalId}`;
    const item = this.payouts.get(id)!;
    const next = { ...item, status: "paid" };
    this.payouts.set(id, next);
    return next;
  }
}

test("automatic worker creates one transfer and payout, then verified settlement pays exact allocations", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  assert.deepEqual(await runPartnerWithdrawalWorker({ provider, now, limit: 1 }), { status: "ran", processed: 1 });
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  assert.equal(provider.lastTransferKey, `cashout-transfer-v1-${f.withdrawal.id}`);
  assert.equal(provider.lastPayoutKey, `cashout-payout-v1-${f.withdrawal.id}-1`);
  const processing = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } });
  assert.equal(processing.status, "PROCESSING");
  assert.equal(processing.destinationExternalAccountId, "ba_synthetic_4242");
  assert.ok(processing.payoutId);
  assert.equal(await prisma.partnerWithdrawalAttempt.count({ where: { withdrawalId: processing.id } }), 2);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal(await processPartnerWithdrawal(processing.id, { provider, now }), "reconcile");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  const paid = provider.paid(processing.id);
  await handleWithdrawalPayoutEvent(paid, { provider, now });
  await handleWithdrawalPayoutEvent(paid, { provider, now });
  const finished = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: processing.id } });
  assert.equal(finished.status, "PAID");
  assert.equal(finished.activePartnerUserId, null);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: processing.payoutId! } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PAID");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
});

test("accepted transfer with lost response is found by group and never sent twice", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.transferAcceptedThenTimeout = true;
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "reconcile");
  assert.equal(provider.transferCalls, 1);
  assert.equal(await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now }), "transfer_confirmed");
  provider.transferAcceptedThenTimeout = false;
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "processing");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
});

test("accepted payout with lost response is found without another transfer or bank payout", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.payoutAcceptedThenTimeout = true;
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  provider.payoutAcceptedThenTimeout = false;
  assert.equal(await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now }), "pending");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  const paid = provider.paid(f.withdrawal.id);
  assert.equal(await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now }), "paid");
  await handleWithdrawalPayoutEvent(paid, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
});

test("duplicate workers and an expired lease cannot start a second transfer", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  const results = await Promise.allSettled([
    processPartnerWithdrawal(f.withdrawal.id, { provider, now }),
    processPartnerWithdrawal(f.withdrawal.id, { provider, now }),
  ]);
  assert.ok(results.some((item) => item.status === "fulfilled"));
  assert.equal(provider.transferCalls, 1);
  const transfer = await prisma.partnerWithdrawalAttempt.findFirstOrThrow({
    where: { withdrawalId: f.withdrawal.id, operation: "TRANSFER" },
  });
  await prisma.partnerWithdrawalAttempt.update({ where: { id: transfer.id }, data: { status: "OUTCOME_UNKNOWN" } });
  await prisma.partnerWithdrawal.update({ where: { id: f.withdrawal.id }, data: {
    status: "OUTCOME_UNKNOWN", leaseOwner: "expired-worker", leaseExpiresAt: old,
  } });
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "reconcile");
  assert.equal(provider.transferCalls, 1);
});

test("refund during transfer blocks the payout leg and retains uncertain funds", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.beforeTransferReturn = async () => refund(f.payment.id);
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "reconcile");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 0);
  const withdrawal = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } });
  assert.equal(withdrawal.status, "OUTCOME_UNKNOWN");
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: withdrawal.id, releasedAt: null } }), 1);
});

test("refund after transfer and payout creates debt only if bank payout is paid", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  await refund(f.payment.id);
  const before = await prisma.partnerCommission.findFirstOrThrow({ where: { paymentId: f.payment.id, type: "REVERSAL" } });
  assert.equal(before.status, "REVERSED");
  await handleWithdrawalPayoutEvent(provider.paid(f.withdrawal.id), { provider, now });
  const after = await prisma.partnerCommission.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.status, "DEBT");
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
});

test("failed bank payout keeps the transfer and reservations; late failure freezes paid history", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const payoutId = `po_synthetic_${f.withdrawal.id}`;
  const pending = provider.payouts.get(payoutId)!;
  provider.payouts.set(payoutId, { ...pending, status: "failed", failureBalanceTransactionId: "txn_synthetic_return" });
  await handleWithdrawalPayoutEvent({ ...pending, status: "failed" }, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "ACTION_REQUIRED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "reconcile");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  provider.payouts.set(payoutId, { ...pending, status: "paid" });
  await handleWithdrawalPayoutEvent({ ...pending, status: "paid" }, { provider, now });
  provider.payouts.set(payoutId, { ...pending, status: "failed", failureBalanceTransactionId: "txn_synthetic_return" });
  await handleWithdrawalPayoutEvent({ ...pending, status: "failed" }, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "ACTION_REQUIRED");
});

test("wrong account, amount, and currency cannot settle a withdrawal", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const paid = provider.paid(f.withdrawal.id);
  for (const bad of [
    { ...paid, connectedAccountId: "acct_wrong" },
    { ...paid, amountCents: 1 },
    { ...paid, currency: "usd" },
  ]) {
    await assert.rejects(handleWithdrawalPayoutEvent(bad, { provider, now }), /evidence_mismatch/);
  }
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PROCESSING");
});

test("mismatched destination and paused execution fail closed without provider sends", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.accountOverride = { externalAccountLast4: "9999" };
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(provider.transferCalls, 0);
  process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "false";
  try {
    await assert.rejects(processPartnerWithdrawal(f.withdrawal.id, { provider, now }), /processing_paused/);
    assert.deepEqual(await runPartnerWithdrawalWorker({ provider, now }), { status: "paused", processed: 0 });
  } finally {
    process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "true";
  }
});

test("worker secret, admin role, and legacy execution gate remain separate", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  const admin = await prisma.user.create({ data: {
    email: `admin-${key()}@example.test`, username: key(), role: "ADMIN", profileCompleted: true,
  } });
  await assert.rejects(inspectAdminWithdrawal(f.withdrawal.id, {
    authenticate: async () => ({ id: f.partner.id, role: "GETTER" }),
  }), /not_authorized/);
  const deps = { authenticate: async () => ({ id: admin.id, role: "ADMIN" }), provider };
  assert.equal((await inspectAdminWithdrawal(f.withdrawal.id, deps))?.id, f.withdrawal.id);
  await recordAdminWithdrawalInvestigation(f.withdrawal.id, "Synthetic operator review", deps);
  const request = new Request("https://example.test/api/internal/partner-withdrawals/run", {
    method: "POST", headers: { authorization: "Bearer expected-secret" },
  });
  assert.equal(workerSecretAuthorized(request, "expected-secret"), true);
  assert.equal(workerSecretAuthorized(request, "wrong-secret"), false);
  process.env.PARTNER_WITHDRAWAL_WORKER_SECRET = "";
  assert.equal((await workerRoute(request)).status, 503);
  process.env.PARTNER_WITHDRAWAL_WORKER_SECRET = "different-secret";
  assert.equal((await workerRoute(request)).status, 401);
  process.env.PARTNER_WITHDRAWAL_WORKER_SECRET = "expected-secret";
  process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "false";
  try {
    const authorized = await workerRoute(request);
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { status: "paused", processed: 0 });
  } finally {
    process.env.PARTNER_WITHDRAWAL_PROCESSING_ENABLED = "true";
  }
  process.env.PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED = "false";
  assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped-payouts-disabled");
});

test("webhook before API response and out-of-order event converge on retrieved provider state", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.payoutInitialStatus = "paid";
  provider.beforePayoutReturn = async () => {
    const evidence = provider.payouts.get(`po_synthetic_${f.withdrawal.id}`)!;
    await handleWithdrawalPayoutEvent(evidence, { provider, now });
  };
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
  const evidence = provider.payouts.get(`po_synthetic_${f.withdrawal.id}`)!;
  await handleWithdrawalPayoutEvent({ ...evidence, status: "failed" }, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
});

test("transfer rejection without an object stays held until evidence-backed review", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.transferRejectBeforeAccept = true;
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 0);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
});

test("externally reversed transfer is held for investigation without another transfer", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.transferAcceptedThenTimeout = true;
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const id = `tr_synthetic_${f.withdrawal.id}`;
  const transfer = provider.transfers.get(id)!;
  provider.transfers.set(id, { ...transfer, amountReversedCents: transfer.amountCents });
  await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "ACTION_REQUIRED");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 0);
});

test("admin-authorized full transfer reversal releases only after provider evidence", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.beforeTransferReturn = async () => refund(f.payment.id);
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const admin = await prisma.user.create({ data: {
    email: `admin-${key()}@example.test`, username: key(), role: "ADMIN", profileCompleted: true,
  } });
  const deps = { authenticate: async () => ({ id: admin.id, role: "ADMIN" }), provider };
  process.env.PARTNER_WITHDRAWAL_REVERSAL_ENABLED = "true";
  try {
    assert.equal(await reverseAdminWithdrawalTransfer(f.withdrawal.id, "Refunded before bank payout", deps), "transfer_reversed");
    assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "FAILED_CONFIRMED");
    assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: f.withdrawal.id, releasedAt: null } }), 0);
    assert.equal(provider.reversalCalls, 1);
    assert.equal(provider.payoutCalls, 0);
  } finally {
    process.env.PARTNER_WITHDRAWAL_REVERSAL_ENABLED = "false";
  }
});

test("failed transfer reversal remains held and cannot be sent again blindly", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.beforeTransferReturn = async () => refund(f.payment.id);
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  provider.reversalFails = true;
  process.env.PARTNER_WITHDRAWAL_REVERSAL_ENABLED = "true";
  try {
    assert.equal(await requestPartnerTransferReversal(f.withdrawal.id, { provider, now }), "outcome_unknown");
    assert.equal(await requestPartnerTransferReversal(f.withdrawal.id, { provider, now }), "reconcile");
    assert.equal(provider.reversalCalls, 1);
    assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: f.withdrawal.id, releasedAt: null } }), 1);
  } finally {
    process.env.PARTNER_WITHDRAWAL_REVERSAL_ENABLED = "false";
  }
});

test("admin retry of a confirmed failed bank payout uses a new payout key and no new transfer", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const firstId = `po_synthetic_${f.withdrawal.id}`;
  const first = { ...provider.payouts.get(firstId)!, status: "failed", failureBalanceTransactionId: "txn_synthetic_return" };
  provider.payouts.set(firstId, first);
  await handleWithdrawalPayoutEvent(first, { provider, now });
  const admin = await prisma.user.create({ data: {
    email: `admin-${key()}@example.test`, username: key(), role: "ADMIN", profileCompleted: true,
  } });
  const deps = { authenticate: async () => ({ id: admin.id, role: "ADMIN" }), provider };
  process.env.PARTNER_WITHDRAWAL_RETRY_ENABLED = "true";
  try {
    assert.equal(await retryAdminWithdrawalPayout(f.withdrawal.id, "Bank failure balance return confirmed", deps), "processing");
    assert.equal(provider.transferCalls, 1);
    assert.equal(provider.payoutCalls, 2);
    assert.equal(provider.lastPayoutKey, `cashout-payout-v1-${f.withdrawal.id}-2`);
    const latest = [...provider.payouts.values()].find((item) => item.id.endsWith("_retry2"))!;
    provider.payouts.set(latest.id, { ...latest, status: "paid" });
    await handleWithdrawalPayoutEvent({ ...latest, status: "paid" }, { provider, now });
    await handleWithdrawalPayoutEvent(first, { provider, now });
    assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "PAID");
    assert.equal(provider.transferCalls, 1);
  } finally {
    process.env.PARTNER_WITHDRAWAL_RETRY_ENABLED = "false";
  }
});

test("bank payout retry requires returned-funds evidence", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  const firstId = `po_synthetic_${f.withdrawal.id}`;
  const first = { ...provider.payouts.get(firstId)!, status: "failed", failureBalanceTransactionId: null };
  provider.payouts.set(firstId, first);
  await handleWithdrawalPayoutEvent(first, { provider, now });
  process.env.PARTNER_WITHDRAWAL_RETRY_ENABLED = "true";
  try {
    await assert.rejects(requestPartnerPayoutRetry(f.withdrawal.id, { provider, now }), /failure_not_confirmed/);
    assert.equal(provider.payoutCalls, 1);
    assert.equal(provider.transferCalls, 1);
  } finally {
    process.env.PARTNER_WITHDRAWAL_RETRY_ENABLED = "false";
  }
});

test("late bank failure invalidates a newer unprocessed withdrawal", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await processPartnerWithdrawal(f.withdrawal.id, { provider, now });
  await handleWithdrawalPayoutEvent(provider.paid(f.withdrawal.id), { provider, now });
  await extraCredit(f.partner.id);
  const newer = await requestPartnerWithdrawal(key(), auth(f.partner.id));
  const oldPayout = provider.payouts.get(`po_synthetic_${f.withdrawal.id}`)!;
  const failed = { ...oldPayout, status: "failed", failureBalanceTransactionId: "txn_synthetic_late_return" };
  provider.payouts.set(failed.id, failed);
  await handleWithdrawalPayoutEvent(failed, { provider, now });
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: newer.id } })).status, "INVALIDATED");
  assert.equal((await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: f.withdrawal.id } })).status, "ACTION_REQUIRED");
});

test("refund before provider claim invalidates the request without a Stripe operation", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  await refund(f.payment.id);
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "terminal");
  assert.equal(provider.transferCalls, 0);
  assert.equal(provider.payoutCalls, 0);
});

test("bank payout creation rejection remains reserved and never repeats automatically", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  provider.payoutRejectBeforeAccept = true;
  assert.equal(await processPartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(await reconcilePartnerWithdrawal(f.withdrawal.id, { provider, now }), "outcome_unknown");
  assert.equal(provider.transferCalls, 1);
  assert.equal(provider.payoutCalls, 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
});

test("production test-key gate blocks execution even if withdrawal flag is set", async () => {
  const f = await fixture();
  const provider = new MockProvider();
  const previous = {
    railway: process.env.RAILWAY_ENVIRONMENT_NAME,
    secret: process.env.STRIPE_SECRET_KEY,
    publishable: process.env.STRIPE_PUBLISHABLE_KEY,
  };
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_only";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_only";
  try {
    await assert.rejects(processPartnerWithdrawal(f.withdrawal.id, { provider, now }), /processing_paused/);
    assert.equal(provider.transferCalls, 0);
  } finally {
    if (previous.railway === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = previous.railway;
    if (previous.secret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous.secret;
    if (previous.publishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = previous.publishable;
  }
});
