import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { reserveAvailablePartnerCommissions, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import {
  cancelPartnerWithdrawal, getPartnerWithdrawableBalance,
  recoverEligiblePartnerDebt, requestPartnerWithdrawal,
} from "@/lib/partner-withdrawals";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-cashout-stage1-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.RAILWAY_ENVIRONMENT_NAME = "stage1-isolated-test";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
  env: process.env, stdio: "pipe",
});
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const now = new Date();
const old = new Date(now.getTime() - 16 * 24 * 60 * 60 * 1000);
function key() { return `stage1-key-${String(++sequence).padStart(16, "0")}`; }
function auth(partnerId: string, role = "GETTER") {
  return { authenticate: async () => ({ id: partnerId, role, profileCompleted: true }), now };
}
async function readyPartner() {
  const f = await createRefundFixture(prisma, key(), old);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: `acct_synthetic_${f.partner.id}`,
    stripeAccountStatus: "READY", stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true, stripeOnboardingComplete: true, stripeLastSyncedAt: now,
  } });
  return f;
}
async function extraCredit(partnerId: string, amountCents = 5000, eligibleAt = old) {
  const f = await createRefundFixture(prisma, key(), old);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { userId: partnerId } });
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { originatingPartnerUserId: partnerId } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { partnerUserId: partnerId, userId: partnerId } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { partnerUserId: partnerId, amountCents, eligibleAt } });
  return f;
}
async function markHistoricallyPaid(commissionId: string, partnerId: string, amountCents = 5000) {
  const run = await prisma.partnerPayoutRun.create({ data: {
    runKey: key(), scheduledFor: old, status: "COMPLETED",
  } });
  const payout = await prisma.partnerPayout.create({ data: {
    payoutRunId: run.id, partnerUserId: partnerId, amountCents, status: "PAID", paidAt: old,
  } });
  await prisma.partnerCommission.update({ where: { id: commissionId }, data: {
    payoutId: payout.id, status: "PAID", paidAt: old,
  } });
  return payout;
}
async function reverse(paymentId: string, eventId = key()) {
  return reversePartnerCommissionForPayment({
    eventType: "charge.refunded", reason: "synthetic_test_refund", sourceEventId: eventId, paymentId,
  }, { revalidatePaths: () => {} });
}

test("minimum, whole-balance reservation, idempotency, cancellation, and authorization", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { eligibleAt: new Date(now.getTime() + 1000) } });
  assert.equal((await getPartnerWithdrawableBalance(deps)).withdrawableCents, 0);
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /below_minimum/);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { eligibleAt: old } });
  assert.equal((await getPartnerWithdrawableBalance(deps)).withdrawableCents, 5000);
  const requestKey = key();
  const request = await requestPartnerWithdrawal(requestKey, deps);
  assert.equal(request.requestedAmountCents, 5000);
  assert.equal(request.status, "REQUESTED");
  assert.equal((await requestPartnerWithdrawal(requestKey, deps)).id, request.id);
  assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: f.partner.id } }), 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /already_active/);
  const stranger = await readyPartner();
  await assert.rejects(cancelPartnerWithdrawal(request.id, auth(stranger.partner.id)), /not_authorized/);
  await assert.rejects(requestPartnerWithdrawal(key(), auth(f.partner.id, "USER")), /not_authorized/);
  assert.equal((await cancelPartnerWithdrawal(request.id, deps)).status, "CANCELED");
  assert.equal((await cancelPartnerWithdrawal(request.id, deps)).status, "CANCELED");
  assert.equal((await requestPartnerWithdrawal(requestKey, deps)).status, "CANCELED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "AVAILABLE");
  assert.equal((await prisma.partnerWithdrawalCommission.findFirstOrThrow({ where: { withdrawalId: request.id } })).releasedAt !== null, true);
  const again = await requestPartnerWithdrawal(key(), deps);
  assert.equal(again.requestedAmountCents, 5000);
});

test("refund and unresolved payment never release an initial commission at the hold boundary", async () => {
  for (const deltaMs of [-1000, 0, 1000]) {
    const f = await readyPartner();
    const boundary = new Date(f.payment.paidAt!.getTime() + 14 * 86_400_000 + deltaMs);
    const deps = { ...auth(f.partner.id), now: boundary };
    assert.equal((await getPartnerWithdrawableBalance(deps)).netEligibleCents,
      deltaMs < 0 ? 0 : 5000);
    await reverse(f.payment.id);
    assert.equal((await getPartnerWithdrawableBalance(deps)).netEligibleCents, 0);
    assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "REVERSED");
  }
  const unresolved = await readyPartner();
  await prisma.payment.update({ where: { id: unresolved.payment.id }, data: { status: "PENDING_PAYMENT" } });
  const pastBoundary = new Date(unresolved.payment.paidAt!.getTime() + 15 * 86_400_000);
  assert.equal((await getPartnerWithdrawableBalance({ ...auth(unresolved.partner.id), now: pastBoundary })).netEligibleCents, 0);
});

test("reviewed amount must match the transactional full balance; a lost response reuses its request key", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const requestKey = key();
  await assert.rejects(
    requestPartnerWithdrawal(requestKey, { ...deps, expectedAmountCents: 10000 }),
    /withdrawal_balance_changed/,
  );
  assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: f.partner.id } }), 0);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
  const submitted = await requestPartnerWithdrawal(requestKey, { ...deps, expectedAmountCents: 5000 });
  const repeated = await requestPartnerWithdrawal(requestKey, { ...deps, expectedAmountCents: 5000 });
  assert.equal(repeated.id, submitted.id);
  assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: f.partner.id } }), 1);
});

test("unpaid refund reverses once and reduces a larger eligible balance", async () => {
  const f = await readyPartner();
  await extraCredit(f.partner.id);
  await extraCredit(f.partner.id);
  const deps = auth(f.partner.id);
  assert.equal((await getPartnerWithdrawableBalance(deps)).netEligibleCents, 15000);
  await reverse(f.payment.id);
  await reverse(f.payment.id);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
  assert.equal((await getPartnerWithdrawableBalance(deps)).withdrawableCents, 10000);
  const request = await requestPartnerWithdrawal(key(), deps);
  assert.equal(request.requestedAmountCents, 10000);
});

test("paid refund creates durable debt; held and partial credits recover it exactly once", async () => {
  const f = await readyPartner();
  await markHistoricallyPaid(f.commission.id, f.partner.id);
  await reverse(f.payment.id);
  await reverse(f.payment.id);
  const deps = auth(f.partner.id);
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 1);
  assert.equal((await getPartnerWithdrawableBalance(deps)).outstandingDebtCents, 5000);
  const held = await extraCredit(f.partner.id, 3000, new Date(now.getTime() + 1000));
  assert.equal((await recoverEligiblePartnerDebt(deps)).recoveredCents, 0);
  await prisma.partnerCommission.update({ where: { id: held.commission.id }, data: { eligibleAt: old } });
  assert.deepEqual(await recoverEligiblePartnerDebt(deps), { recoveredCents: 3000, outstandingDebtCents: 2000 });
  assert.deepEqual(await recoverEligiblePartnerDebt(deps), { recoveredCents: 0, outstandingDebtCents: 2000 });
  const more = await extraCredit(f.partner.id, 5000);
  assert.deepEqual(await recoverEligiblePartnerDebt(deps), { recoveredCents: 2000, outstandingDebtCents: 0 });
  const balance = await getPartnerWithdrawableBalance(deps);
  assert.equal(balance.netEligibleCents, 3000);
  assert.equal(balance.withdrawableCents, 0);
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /below_minimum/);
  const recoveries = await prisma.partnerDebtRecovery.findMany({ where: { partnerUserId: f.partner.id, voidedAt: null } });
  assert.equal(recoveries.length, 2);
  assert.equal(recoveries.reduce((total, row) => total + row.amountCents, 0), 5000);
  assert.ok(recoveries.some((row) => row.creditCommissionId === more.commission.id && row.amountCents === 2000));
  await extraCredit(f.partner.id, 5000);
  assert.equal((await requestPartnerWithdrawal(key(), deps)).requestedAmountCents, 8000);
});

test("refund invalidates an unprocessed request and requires a new amount confirmation", async () => {
  const f = await readyPartner();
  await extraCredit(f.partner.id);
  const deps = auth(f.partner.id);
  const request = await requestPartnerWithdrawal(key(), deps);
  assert.equal(request.requestedAmountCents, 10000);
  await reverse(f.payment.id);
  const invalidated = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(invalidated.status, "INVALIDATED");
  assert.equal(invalidated.activePartnerUserId, null);
  assert.equal((await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: request.id, releasedAt: null } })), 0);
  assert.equal((await getPartnerWithdrawableBalance(deps)).withdrawableCents, 5000);
  const replacement = await requestPartnerWithdrawal(key(), deps);
  assert.equal(replacement.requestedAmountCents, 5000);
  await assert.rejects(cancelPartnerWithdrawal(request.id, deps), /cannot_cancel/);
});

test("simultaneous different keys never double-reserve commissions", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const results = await Promise.allSettled([requestPartnerWithdrawal(key(), deps), requestPartnerWithdrawal(key(), deps)]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: f.partner.id } }), 1);
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { commissionId: f.commission.id, releasedAt: null } }), 1);
});

test("simultaneous Partners reserve only their own commissions even with the same key", async () => {
  const first = await readyPartner();
  const second = await readyPartner();
  const sharedKey = key();
  const requests = await Promise.allSettled([
    requestPartnerWithdrawal(sharedKey, auth(first.partner.id)),
    requestPartnerWithdrawal(sharedKey, auth(second.partner.id)),
  ]);
  for (const [index, result] of requests.entries()) {
    if (result.status === "rejected") {
      await requestPartnerWithdrawal(sharedKey, auth(index === 0 ? first.partner.id : second.partner.id));
    }
  }
  const withdrawals = await prisma.partnerWithdrawal.findMany({
    where: { requestKey: sharedKey }, include: { commissions: true },
  });
  assert.equal(withdrawals.length, 2);
  for (const partner of [first.partner.id, second.partner.id]) {
    const withdrawal = withdrawals.find((item) => item.partnerUserId === partner);
    assert.ok(withdrawal);
    assert.equal(withdrawal.commissions.length, 1);
    const commission = await prisma.partnerCommission.findUniqueOrThrow({
      where: { id: withdrawal.commissions[0].commissionId },
    });
    assert.equal(commission.partnerUserId, partner);
    assert.equal(commission.status, "RESERVED");
  }
});

test("legacy unresolved payout and stale destination block new withdrawals", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { stripeLastSyncedAt: old } });
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /destination_not_ready/);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { stripeLastSyncedAt: now } });
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: key(), scheduledFor: old, status: "RUNNING" } });
  await prisma.partnerPayout.create({ data: {
    payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 5000, status: "PROCESSING",
  } });
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /legacy_payout_requires_review/);
});

test("refund and request racing converge without an active invalid withdrawal", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const results = await Promise.allSettled([requestPartnerWithdrawal(key(), deps), reverse(f.payment.id)]);
  if (results[1].status === "rejected") await reverse(f.payment.id);
  const withdrawals = await prisma.partnerWithdrawal.findMany({ where: { partnerUserId: f.partner.id } });
  assert.ok(withdrawals.every((item) => item.status === "INVALIDATED"));
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { commissionId: f.commission.id, releasedAt: null } }), 0);
  assert.equal((await getPartnerWithdrawableBalance(deps)).withdrawableCents, 0);
});

test("debt recovery and request racing cannot consume a credit twice", async () => {
  const f = await readyPartner();
  await markHistoricallyPaid(f.commission.id, f.partner.id);
  await reverse(f.payment.id);
  await extraCredit(f.partner.id, 10000);
  const deps = auth(f.partner.id);
  const requestKey = key();
  await Promise.allSettled([recoverEligiblePartnerDebt(deps), requestPartnerWithdrawal(requestKey, deps)]);
  const request = await requestPartnerWithdrawal(requestKey, deps);
  assert.equal(request.requestedAmountCents, 5000);
  assert.equal(await prisma.partnerDebtRecovery.count({ where: { partnerUserId: f.partner.id, voidedAt: null } }), 1);
  assert.equal((await prisma.partnerDebtRecovery.findFirstOrThrow({ where: { partnerUserId: f.partner.id } })).amountCents, 5000);
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: request.id, releasedAt: null } }), 1);
});

test("request transaction failure leaves no reservation or orphaned request", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  await prisma.$executeRawUnsafe('CREATE TRIGGER stage1_fail_event BEFORE INSERT ON "PartnerWithdrawalEvent" BEGIN SELECT RAISE(ABORT, "synthetic event failure"); END');
  try {
    await assert.rejects(requestPartnerWithdrawal(key(), deps));
    assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: f.partner.id } }), 0);
    assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER stage1_fail_event");
  }
});

test("provider-started request cannot be canceled or release reserved funds", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const request = await requestPartnerWithdrawal(key(), deps);
  await prisma.partnerWithdrawal.update({ where: { id: request.id }, data: {
    status: "PROCESSING", providerStartedAt: now,
  } });
  await assert.rejects(cancelPartnerWithdrawal(request.id, deps), /cannot_cancel/);
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: request.id, releasedAt: null } }), 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
});

test("legacy batch reservation racing a request cannot reserve the same commission", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: key(), scheduledFor: now, status: "RUNNING" } });
  await Promise.allSettled([
    reserveAvailablePartnerCommissions({ partnerUserId: f.partner.id, payoutRunId: run.id }),
    requestPartnerWithdrawal(key(), deps),
  ]);
  let withdrawals = await prisma.partnerWithdrawal.findMany({ where: { partnerUserId: f.partner.id } });
  let payouts = await prisma.partnerPayout.findMany({ where: { partnerUserId: f.partner.id } });
  if (!withdrawals.length && !payouts.length) {
    await requestPartnerWithdrawal(key(), deps);
  }
  if (withdrawals.length) {
    assert.equal(await reserveAvailablePartnerCommissions({ partnerUserId: f.partner.id, payoutRunId: run.id }), null);
  } else if (payouts.length) {
    await assert.rejects(requestPartnerWithdrawal(key(), deps), /legacy_payout_requires_review/);
  }
  withdrawals = await prisma.partnerWithdrawal.findMany({ where: { partnerUserId: f.partner.id } });
  payouts = await prisma.partnerPayout.findMany({ where: { partnerUserId: f.partner.id } });
  assert.equal(withdrawals.length + payouts.length, 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
  const commission = await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } });
  assert.equal(Boolean(commission.payoutId), payouts.length === 1);
});

test("multiple debts recover across credits and a refunded recovery credit reopens the debt", async () => {
  const f = await readyPartner();
  const secondPaid = await extraCredit(f.partner.id);
  await markHistoricallyPaid(f.commission.id, f.partner.id);
  await markHistoricallyPaid(secondPaid.commission.id, f.partner.id);
  await reverse(f.payment.id);
  await reverse(secondPaid.payment.id);
  const deps = auth(f.partner.id);
  assert.equal((await getPartnerWithdrawableBalance(deps)).outstandingDebtCents, 10000);
  const credit = await extraCredit(f.partner.id, 8000);
  assert.deepEqual(await recoverEligiblePartnerDebt(deps), { recoveredCents: 8000, outstandingDebtCents: 2000 });
  assert.equal(await prisma.partnerDebtRecovery.count({ where: { creditCommissionId: credit.commission.id, voidedAt: null } }), 2);
  await reverse(credit.payment.id);
  assert.equal(await prisma.partnerDebtRecovery.count({ where: { creditCommissionId: credit.commission.id, voidedAt: null } }), 0);
  assert.equal(await prisma.partnerDebtRecovery.count({ where: { creditCommissionId: credit.commission.id, voidedAt: { not: null } } }), 2);
  assert.equal((await getPartnerWithdrawableBalance(deps)).outstandingDebtCents, 10000);
  await extraCredit(f.partner.id, 10000);
  assert.deepEqual(await recoverEligiblePartnerDebt(deps), { recoveredCents: 10000, outstandingDebtCents: 0 });
});

test("refund after provider start keeps the request active for reconciliation", async () => {
  const f = await readyPartner();
  const deps = auth(f.partner.id);
  const request = await requestPartnerWithdrawal(key(), deps);
  await prisma.partnerWithdrawal.update({ where: { id: request.id }, data: {
    status: "PROCESSING", providerStartedAt: now,
  } });
  await reverse(f.payment.id);
  const uncertain = await prisma.partnerWithdrawal.findUniqueOrThrow({ where: { id: request.id } });
  assert.equal(uncertain.status, "OUTCOME_UNKNOWN");
  assert.equal(uncertain.activePartnerUserId, f.partner.id);
  assert.equal(await prisma.partnerWithdrawalCommission.count({ where: { withdrawalId: request.id, releasedAt: null } }), 1);
  await assert.rejects(cancelPartnerWithdrawal(request.id, deps), /cannot_cancel/);
  await assert.rejects(requestPartnerWithdrawal(key(), deps), /already_active/);
});
