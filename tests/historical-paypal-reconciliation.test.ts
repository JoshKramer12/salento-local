import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { syncPendingPaypalPayouts } from "@/lib/partner-ledger";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-historical-paypal-"));
const path = join(directory, "isolated.db");
writeFileSync(path, "");
process.env.DATABASE_URL = `file:${path}`;
process.env.PAYPAL_CLIENT_ID = "synthetic-id";
process.env.PAYPAL_CLIENT_SECRET = "synthetic-secret";
process.env.PAYPAL_PAYOUTS_ENABLED = "true";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

async function historicalPayout(key: string) {
  const f = await createRefundFixture(prisma, key);
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: `weekly-${key}`, scheduledFor: new Date(), status: "RUNNING" } });
  const payout = await prisma.partnerPayout.create({ data: { payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 5000, payoutMethod: "PAYPAL", status: "PROCESSING", providerBatchId: `batch-${key}` } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { payoutId: payout.id, status: "RESERVED" } });
  return { f, payout };
}

test("historical PayPal polling in cash-out mode settles success and holds failed reservations", async () => {
  process.env.PARTNER_PAYOUT_MODE = "cashout";
  const success = await historicalPayout("historical-success");
  const failed = await historicalPayout("historical-failed");
  const seen: string[] = [];
  await syncPendingPaypalPayouts(async (batchId) => {
    seen.push(batchId);
    const payout = batchId === success.payout.providerBatchId ? success.payout : failed.payout;
    return batchId === success.payout.providerBatchId
      ? { batchStatus: "SUCCESS", itemId: "item-success", itemStatus: "SUCCESS",
          batchId, senderBatchId: `salento-${payout.id}`.slice(0, 36), totalItems: 1,
          senderItemId: payout.id, amountValue: "50.00", currency: "EUR" }
      : { batchStatus: "SUCCESS", itemId: "item-failed", itemStatus: "RETURNED",
          batchId, senderBatchId: `salento-${payout.id}`.slice(0, 36), totalItems: 1,
          senderItemId: payout.id, amountValue: "50.00", currency: "EUR" };
  });
  assert.equal(seen.length, 2);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: success.payout.id } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: success.f.commission.id } })).status, "PAID");
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: failed.payout.id } })).status, "ACTION_REQUIRED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: failed.f.commission.id } })).status, "RESERVED");
});

test("historical PayPal polling holds an unattributed item for review", async () => {
  process.env.PARTNER_PAYOUT_MODE = "cashout";
  const { f, payout } = await historicalPayout("historical-mismatch");
  await syncPendingPaypalPayouts(async (batchId) => ({
    batchStatus: "SUCCESS", itemId: "item-wrong", itemStatus: "SUCCESS", batchId,
    senderBatchId: `salento-${payout.id}`.slice(0, 36), totalItems: 1,
    senderItemId: payout.id, amountValue: "51.00", currency: "EUR",
  }));
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "ACTION_REQUIRED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "RESERVED");
});

test("weekly-mode historical PayPal failure retains the existing weekly release behavior", async () => {
  process.env.PARTNER_PAYOUT_MODE = "weekly";
  const { f, payout } = await historicalPayout("weekly-failed");
  await syncPendingPaypalPayouts(async () => ({ batchStatus: "SUCCESS", itemId: "item-weekly-failed", itemStatus: "FAILED" }));
  const commission = await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } });
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "ACTION_REQUIRED");
  assert.equal(commission.status, "AVAILABLE");
  assert.equal(commission.payoutId, null);
});
