import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPartnerRecentTransactions } from "@/lib/partner-recent-transactions";
import { prisma } from "@/lib/prisma";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-transactions-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("transaction loader reads only matching payment provenance and withdrawal allocations", async () => {
  const fixture = await createRefundFixture(prisma, "recent-transactions", new Date("2026-11-07T12:00:00Z"));
  const withdrawal = await prisma.partnerWithdrawal.create({ data: {
    partnerUserId: fixture.partner.id, requestKey: "recent-transactions-test-key",
    grossEligibleCents: 5000, requestedAmountCents: 5000, currency: "eur", status: "PAID",
    stripeConnectedAccountId: "acct_synthetic", destinationVerifiedAt: new Date("2026-11-22T12:00:00Z"),
    createdAt: new Date("2026-11-22T12:00:00Z"), completedAt: new Date("2026-11-23T12:00:00Z"),
    commissions: { create: { commissionId: fixture.commission.id, amountCents: 5000 } },
  } });
  await prisma.partnerWithdrawalEvent.create({ data: {
    withdrawalId: withdrawal.id, toStatus: "PAID", reason: "synthetic_completion",
    createdAt: new Date("2026-11-23T12:00:00Z"),
  } });
  const commissions = await prisma.partnerCommission.findMany({ where: { partnerUserId: fixture.partner.id },
    include: { business: true, businessSubmission: true, payment: true } });
  const before = await prisma.partnerWithdrawal.count({ where: { partnerUserId: fixture.partner.id } });
  const options = { partnerUserId: fixture.partner.id, commissions, payableIds: new Set([fixture.commission.id]),
    locale: "en" as const };
  const live = await getPartnerRecentTransactions({ ...options, paymentLivemode: true });
  assert.deepEqual(live.map((row) => row.kind), ["completed", "request", "commission"]);
  assert.equal(live[0].withdrawalId, live[1].withdrawalId);
  assert.deepEqual(await getPartnerRecentTransactions({ ...options, paymentLivemode: false }), []);

  await prisma.payment.update({ where: { id: fixture.payment.id }, data: { stripeLivemode: false } });
  const changedCommissions = await prisma.partnerCommission.findMany({ where: { partnerUserId: fixture.partner.id },
    include: { business: true, businessSubmission: true, payment: true } });
  assert.deepEqual(await getPartnerRecentTransactions({ ...options, commissions: changedCommissions,
    paymentLivemode: true }), []);
  const simulated = await getPartnerRecentTransactions({ ...options, commissions: changedCommissions,
    paymentLivemode: false });
  assert.deepEqual(simulated.map((row) => row.kind), ["completed", "request", "commission"]);
  assert.equal(await prisma.partnerWithdrawal.count({ where: { partnerUserId: fixture.partner.id } }), before);
});
