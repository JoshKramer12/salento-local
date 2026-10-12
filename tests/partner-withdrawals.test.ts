import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { addUtcDays } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import { getPartnerBalanceSummary, runWeeklyPartnerPayouts } from "@/lib/partner-ledger";
import { decryptPayoutDestination, encryptPayoutDestination } from "@/lib/partner-payout-methods";
import { assertWithdrawalTransition, cancelRequestedPartnerWithdrawal, createPartnerWithdrawalRequest, PartnerWithdrawalError } from "@/lib/partner-withdrawals";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-withdrawals-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.PAYOUT_DATA_ENCRYPTION_KEY = "synthetic-withdrawal-test-key";
process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
process.env.PARTNER_PAYOUT_MODE = "cashout";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
execFileSync("sqlite3", [join(directory, "isolated.db"), 'CREATE UNIQUE INDEX "PartnerWithdrawalRequest_one_unresolved_per_partner_key" ON "PartnerWithdrawalRequest"("partnerUserId") WHERE "status" NOT IN (\'PAID\', \'CANCELED\')']);
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
async function fixture(amountCents = 5000, paidAt = addUtcDays(new Date(), -20)) {
  const f = await createRefundFixture(prisma, `withdrawal-${++sequence}`, paidAt);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { amountCents } });
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", payoutSetupStatus: "READY", stripeAccountStatus: "READY",
    stripePayoutsEnabled: true, stripeConnectedAccountId: `acct_${f.partner.id}`,
  } });
  return f;
}
const key = (value: string) => `synthetic-request-${value.padEnd(16, "x")}`;
async function expectCode(operation: () => Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof PartnerWithdrawalError && error.code === code);
}
async function renewal(f: Awaited<ReturnType<typeof fixture>>, suffix: string, amountCents = 1500) {
  const payment = await prisma.payment.create({ data: {
    businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id,
    amountCents: 10000, method: "STRIPE_CHECKOUT", purpose: "ANNUAL_RENEWAL", status: "PAID", paidAt: new Date(),
  } });
  return prisma.partnerCommission.create({ data: {
    partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id,
    paymentId: payment.id, amountCents, type: "COMMISSION", status: "PENDING",
    sourceKey: `withdrawal:renewal:${payment.id}:${suffix}`, eligibleAt: payment.paidAt,
  } });
}

test("full eligible balance is reserved atomically; pending and unpaid rows stay out", async () => {
  const f = await fixture();
  const extra = await renewal(f, "extra");
  const recentPayment = await prisma.payment.create({ data: {
    businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id,
    amountCents: 10000, method: "STRIPE_CHECKOUT", purpose: "INITIAL_MEMBERSHIP", status: "PAID", paidAt: new Date(),
  } });
  const pending = await prisma.partnerCommission.create({ data: {
    partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id,
    paymentId: recentPayment.id, amountCents: 5000, type: "COMMISSION", status: "PENDING",
    sourceKey: `withdrawal:pending:${recentPayment.id}`, eligibleAt: addUtcDays(new Date(), 14),
  } });
  const placeholder = await prisma.partnerCommission.create({ data: {
    partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id,
    amountCents: 5000, type: "COMMISSION", status: "PENDING", sourceKey: `withdrawal:placeholder:${f.partner.id}`,
  } });
  const before = await getPartnerBalanceSummary(f.partner.id);
  assert.equal(before.available, 6500);
  assert.equal(before.pending, 5000);
  const result = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("full") });
  assert.equal(result.status, "REQUESTED");
  const request = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: result.id }, include: { payout: true, auditEvents: true } });
  assert.equal(request.amountCents, 6500);
  assert.equal(request.payout.amountCents, 6500);
  assert.equal(request.payout.status, "SCHEDULED");
  assert.equal(request.auditEvents.length, 1);
  assert.equal(decryptPayoutDestination(request.destinationSnapshotEncrypted), `acct_${f.partner.id}`);
  assert.equal(await prisma.partnerCommission.count({ where: { payoutId: request.payoutId, status: "RESERVED" } }), 2);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: extra.id } })).payoutId, request.payoutId);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: pending.id } })).payoutId, null);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: placeholder.id } })).payoutId, null);
  const afterBalance = await getPartnerBalanceSummary(f.partner.id);
  assert.equal(afterBalance.available, 0);
  assert.equal(afterBalance.processing, 6500);
  assert.equal(afterBalance.pending, 5000);
  assert.equal((await runWeeklyPartnerPayouts({ force: true })).status, "skipped");
});

test("€49 is rejected and exactly €50 is accepted", async () => {
  const low = await fixture(4900);
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: low.partner.id, idempotencyKey: key("low") }), "below_minimum_payout");
  assert.equal(await prisma.partnerWithdrawalRequest.count({ where: { partnerUserId: low.partner.id } }), 0);
  const exact = await fixture();
  assert.equal((await createPartnerWithdrawalRequest({ partnerUserId: exact.partner.id, idempotencyKey: key("exact") })).status, "REQUESTED");
});

test("feature flag, payout mode, role, and destination are checked server side", async () => {
  const f = await fixture();
  process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "false";
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("disabled") }), "cashout_disabled");
  process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
  process.env.PARTNER_PAYOUT_MODE = "weekly";
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("mode") }), "cashout_disabled");
  process.env.PARTNER_PAYOUT_MODE = "cashout";
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.owner.id, idempotencyKey: key("role") }), "partner_required");
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { stripePayoutsEnabled: false } });
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("destination") }), "payout_destination_unavailable");
});

test("debt, open dispute, and refund request each block the selected commission", async () => {
  const debt = await fixture();
  await prisma.partnerCommission.create({ data: {
    partnerUserId: debt.partner.id, businessId: debt.business.id, businessSubmissionId: debt.submission.id,
    paymentId: debt.payment.id, amountCents: -5000, type: "REVERSAL", status: "DEBT", sourceKey: `withdrawal:debt:${debt.payment.id}`,
  } });
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: debt.partner.id, idempotencyKey: key("debt") }), "below_minimum_payout");
  const dispute = await fixture();
  await prisma.partnerPaymentDispute.create({ data: { paymentId: dispute.payment.id, stripeDisputeId: `dp_${dispute.payment.id}`, stripeChargeId: `ch_${dispute.payment.id}`, status: "needs_response", holdActive: true } });
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: dispute.partner.id, idempotencyKey: key("dispute") }), "below_minimum_payout");
  const refund = await fixture();
  await prisma.payment.update({ where: { id: refund.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } });
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: refund.partner.id, idempotencyKey: key("refund") }), "below_minimum_payout");
});

test("a weekly reservation is excluded from a new withdrawal", async () => {
  const f = await fixture();
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: `weekly-reserved:${f.partner.id}`, scheduledFor: new Date(), status: "RUNNING" } });
  const payout = await prisma.partnerPayout.create({ data: { payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 5000, payoutMethod: "STRIPE", status: "SCHEDULED" } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { payoutId: payout.id, status: "RESERVED" } });
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("weekly-reserved") }), "below_minimum_payout");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).payoutId, payout.id);
});

test("existing reservations cannot be reused; historical paid payout is preserved", async () => {
  const f = await fixture();
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: `historical:${f.partner.id}`, scheduledFor: new Date(), status: "COMPLETED" } });
  const oldPayout = await prisma.partnerPayout.create({ data: { payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 5000, payoutMethod: "STRIPE", status: "PAID", paidAt: new Date() } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PAID", payoutId: oldPayout.id, paidAt: new Date() } });
  for (let index = 0; index < 4; index++) await renewal(f, `historical-${index}`);
  const result = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("historical") });
  const request = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(request.amountCents, 6000);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: oldPayout.id } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).payoutId, oldPayout.id);
});

test("same key retries return the same request; another key cannot open a second", async () => {
  const f = await fixture();
  const first = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("retry") });
  assert.deepEqual(await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("retry") }), first);
  await expectCode(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("second") }), "withdrawal_already_open");
  assert.equal(await prisma.partnerWithdrawalRequest.count({ where: { partnerUserId: f.partner.id } }), 1);
});

test("concurrent duplicate requests converge and different keys cannot double reserve", async () => {
  const same = await fixture();
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => createPartnerWithdrawalRequest({ partnerUserId: same.partner.id, idempotencyKey: key("parallel") })));
  assert.equal(new Set(duplicates.map((row) => row.id)).size, 1);
  const different = await fixture();
  const attempts = await Promise.allSettled(["a", "b"].map((suffix) => createPartnerWithdrawalRequest({ partnerUserId: different.partner.id, idempotencyKey: key(`race-${suffix}`) })));
  assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(await prisma.partnerWithdrawalRequest.count({ where: { partnerUserId: different.partner.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: different.partner.id, status: "RESERVED" } }), 1);
});

test("reservation write failure rolls the entire request and payout run back", async () => {
  const f = await fixture();
  const runCount = await prisma.partnerPayoutRun.count({ where: { runKey: { startsWith: "cashout:" } } });
  await prisma.$executeRawUnsafe('CREATE TRIGGER withdrawal_test_fail BEFORE UPDATE ON "PartnerCommission" WHEN NEW."status" = \'RESERVED\' BEGIN SELECT RAISE(ABORT, \'synthetic reservation failure\'); END');
  await assert.rejects(() => createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("rollback") }));
  await prisma.$executeRawUnsafe("DROP TRIGGER withdrawal_test_fail");
  assert.equal(await prisma.partnerWithdrawalRequest.count({ where: { partnerUserId: f.partner.id } }), 0);
  assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
  assert.equal(await prisma.partnerPayoutRun.count({ where: { runKey: { startsWith: "cashout:" } } }), runCount);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
});

test("destination is immutable after profile edit and cancellation is audited", async () => {
  const f = await fixture();
  const result = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("snapshot") });
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { stripeConnectedAccountId: `acct_changed_${f.partner.id}` } });
  const stored = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: result.id }, include: { payout: true } });
  assert.equal(decryptPayoutDestination(stored.destinationSnapshotEncrypted), `acct_${f.partner.id}`);
  assert.equal(stored.payout.stripeConnectedAccountId, `acct_${f.partner.id}`);
  assert.deepEqual(await cancelRequestedPartnerWithdrawal(result.id, "test cancellation"), { id: result.id, status: "CANCELED" });
  assert.equal(await prisma.partnerWithdrawalAuditEvent.count({ where: { withdrawalRequestId: result.id } }), 2);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 5000);
  assert.deepEqual(await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key("snapshot") }), { id: result.id, status: "CANCELED" });
  await expectCode(() => cancelRequestedPartnerWithdrawal(result.id, "again"), "withdrawal_not_cancelable");
});

test("PayPal and IBAN destinations are snapshotted without plaintext IBAN", async () => {
  const paypal = await fixture();
  process.env.PAYPAL_CLIENT_ID = "synthetic-client";
  process.env.PAYPAL_CLIENT_SECRET = "synthetic-secret";
  process.env.PAYPAL_PAYOUTS_ENABLED = "true";
  await prisma.localPartnerProfile.update({ where: { userId: paypal.partner.id }, data: { preferredPayoutMethod: "PAYPAL", payoutSetupStatus: "READY", paypalPayoutEmail: "synthetic@example.test" } });
  const payRequest = await createPartnerWithdrawalRequest({ partnerUserId: paypal.partner.id, idempotencyKey: key("paypal") });
  assert.equal(decryptPayoutDestination((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: payRequest.id } })).destinationSnapshotEncrypted), "synthetic@example.test");
  const iban = await fixture();
  const encryptedIban = encryptPayoutDestination("IT60X0542811101000000123456");
  await prisma.localPartnerProfile.update({ where: { userId: iban.partner.id }, data: { preferredPayoutMethod: "POSTEPAY", payoutSetupStatus: "READY", bankPayoutIbanEncrypted: encryptedIban, bankPayoutAccountLast4: "3456" } });
  const ibanRequest = await createPartnerWithdrawalRequest({ partnerUserId: iban.partner.id, idempotencyKey: key("iban") });
  assert.equal((await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: ibanRequest.id } })).destinationSnapshotEncrypted, encryptedIban);
});

test("state machine rejects illegal or unverified paid transitions", () => {
  assert.throws(() => assertWithdrawalTransition("REQUESTED", "PAID"));
  assert.throws(() => assertWithdrawalTransition("PROCESSING", "PAID"));
  assert.throws(() => assertWithdrawalTransition("PAID", "CANCELED"));
  assert.throws(() => assertWithdrawalTransition("FAILED", "CANCELED"));
  assert.doesNotThrow(() => assertWithdrawalTransition("FAILED", "CANCELED", { confirmedNoTransfer: true }));
  assert.doesNotThrow(() => assertWithdrawalTransition("PROCESSING", "PAID", { verifiedSettlement: true }));
});
