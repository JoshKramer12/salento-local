import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { cashoutPreviewFixture, cashoutPreviewScenarios } from "@/lib/partner-cashout-fixtures";
import { cashoutBlockReason } from "@/lib/partner-cashout-presenter";
import { getPartnerCashoutView } from "@/lib/partner-cashout-view";
import { prisma } from "@/lib/prisma";
import { reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { cancelPartnerWithdrawal, requestPartnerWithdrawal } from "@/lib/partner-withdrawals";
import { createRefundFixture } from "./helpers/refund-fixture";
import { proxy } from "@/proxy";

const directory = mkdtempSync(join(tmpdir(), "salento-cashout-stage3-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.RAILWAY_ENVIRONMENT_NAME = "stage3-isolated-test";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
  env: process.env, stdio: "pipe",
});
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
const now = new Date();
const old = new Date(now.getTime() - 16 * 86_400_000);
let sequence = 0;
function key() { return `stage3-key-${String(++sequence).padStart(16, "0")}`; }
async function readyPartner(amountCents = 5000) {
  const f = await createRefundFixture(prisma, key(), old);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: `acct_stage3_${f.partner.id}`,
    stripeAccountStatus: "READY", stripePayoutsEnabled: true, stripeDetailsSubmitted: true,
    stripeOnboardingComplete: true, stripeLastSyncedAt: now, stripePayoutAccountLast4: "4821",
  } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { amountCents } });
  const dependencies = { authenticate: async () => ({ id: f.partner.id, role: "GETTER", profileCompleted: true }), now };
  return { f, dependencies };
}

test("all synthetic preview scenarios are isolated and have truthful eligibility", () => {
  assert.equal(cashoutPreviewScenarios.length, 12);
  const expected = {
    zero: "minimum", forty: "minimum", fifty: null, "one-seventy-five": null,
    pending: "pending", debt: "debt", "missing-account": "destination", active: "active",
    processing: "active", paid: "minimum", canceled: null, unknown: "active",
  } as const;
  for (const scenario of cashoutPreviewScenarios) {
    const view = cashoutPreviewFixture(scenario);
    assert.equal(cashoutBlockReason(view), expected[scenario], scenario);
    assert.equal(view.testCents, 5000);
    assert.equal(view.unverifiedCents, 1500);
    assert.equal(view.destinationLast4?.length ?? 0, scenario === "missing-account" ? 0 : 4);
  }
});

test("synthetic preview is denied unless explicitly enabled outside production", () => {
  const oldFlag = process.env.PARTNER_CASHOUT_PREVIEW_ENABLED;
  const oldMode = process.env.NODE_ENV;
  try {
    delete process.env.PARTNER_CASHOUT_PREVIEW_ENABLED;
    assert.equal(proxy(new NextRequest("http://localhost/dev/cashout-preview")).status, 404);
    process.env.PARTNER_CASHOUT_PREVIEW_ENABLED = "true";
    process.env.NODE_ENV = "production";
    assert.equal(proxy(new NextRequest("http://localhost/dev/cashout-preview")).status, 404);
    process.env.NODE_ENV = "test";
    assert.equal(proxy(new NextRequest("http://localhost/dev/cashout-preview")).status, 200);
  } finally {
    if (oldFlag === undefined) delete process.env.PARTNER_CASHOUT_PREVIEW_ENABLED;
    else process.env.PARTNER_CASHOUT_PREVIEW_ENABLED = oldFlag;
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
  }
});

test("feature pause, debt, active request, and minimum cannot be bypassed by a positive balance", () => {
  const view = cashoutPreviewFixture("one-seventy-five");
  assert.equal(cashoutBlockReason({ ...view, requestEnabled: false }), "paused");
  assert.equal(cashoutBlockReason({ ...view, disbursementsAllowed: false }), "paused");
  assert.equal(cashoutBlockReason({ ...view, debtCents: 3000 }), "debt");
  assert.equal(cashoutBlockReason({ ...view, activeWithdrawalId: "active" }), "active");
  assert.equal(cashoutBlockReason({ ...view, availableCents: 4999 }), "minimum");
  assert.equal(cashoutBlockReason({ ...view, availableCents: 5000 }), null);
});

test("read-only dashboard projection separates eligible, pending, reserved, and paid live commissions", async () => {
  const { f, dependencies } = await readyPartner();
  const first = await getPartnerCashoutView(1, dependencies);
  assert.equal(first.availableCents, 5000);
  assert.equal(first.pendingCents, 0);
  assert.equal(first.grossEarnedCents, 5000);
  assert.equal(first.destinationLast4, "4821");
  assert.equal(first.testCents, 0);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { eligibleAt: new Date(now.getTime() + 86_400_000) } });
  const pending = await getPartnerCashoutView(1, dependencies);
  assert.equal(pending.availableCents, 0);
  assert.equal(pending.pendingCents, 5000);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { eligibleAt: old } });
  const withdrawal = await requestPartnerWithdrawal(key(), dependencies);
  const reserved = await getPartnerCashoutView(1, dependencies);
  assert.equal(reserved.availableCents, 0);
  assert.equal(reserved.reservedCents, 5000);
  assert.equal(reserved.history[0].id, withdrawal.id);
  assert.equal(reserved.history[0].canCancel, true);
  await cancelPartnerWithdrawal(withdrawal.id, dependencies);
  const canceled = await getPartnerCashoutView(1, dependencies);
  assert.equal(canceled.availableCents, 5000);
  assert.equal(canceled.history[0].status, "CANCELED");
  assert.equal(canceled.history[0].canCancel, false);
});

test("withdrawal history is owner-scoped, newest first, and paginated without legacy duplication", async () => {
  const { f, dependencies } = await readyPartner();
  for (let index = 0; index < 11; index++) {
    const item = await requestPartnerWithdrawal(key(), dependencies);
    await cancelPartnerWithdrawal(item.id, dependencies);
  }
  const first = await getPartnerCashoutView(1, dependencies);
  const second = await getPartnerCashoutView(2, dependencies);
  assert.equal(first.history.length, 10);
  assert.equal(first.hasMore, true);
  assert.equal(second.history.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(first.legacyHistory.length, 0);
  const other = await readyPartner();
  assert.equal((await getPartnerCashoutView(1, other.dependencies)).history.length, 0);
  await assert.rejects(getPartnerCashoutView(1, { authenticate: async () => ({ id: f.partner.id, role: "USER", profileCompleted: true }) }), /not_authorized/);
});

test("a paid refund adjustment reduces the projected available amount without treating it as a bank charge", async () => {
  const { f, dependencies } = await readyPartner(3000);
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: key(), scheduledFor: old, status: "COMPLETED" } });
  const payout = await prisma.partnerPayout.create({ data: {
    payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 3000, status: "PAID", paidAt: old,
  } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: {
    status: "PAID", payoutId: payout.id, paidAt: old,
  } });
  await reversePartnerCommissionForPayment({ eventType: "charge.refunded", reason: "synthetic_refund",
    sourceEventId: key(), paymentId: f.payment.id }, { revalidatePaths: () => {} });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED" } });
  const credit = await createRefundFixture(prisma, key(), old);
  await prisma.businessSubmission.update({ where: { id: credit.submission.id }, data: { userId: f.partner.id } });
  await prisma.businessMembership.update({ where: { id: credit.membership.id }, data: { originatingPartnerUserId: f.partner.id } });
  await prisma.payment.update({ where: { id: credit.payment.id }, data: { partnerUserId: f.partner.id, userId: f.partner.id } });
  await prisma.partnerCommission.update({ where: { id: credit.commission.id }, data: { partnerUserId: f.partner.id } });
  const view = await getPartnerCashoutView(1, dependencies);
  assert.equal(view.debtCents, 3000);
  assert.equal(view.availableCents, 2000);
  assert.equal(view.paidCents, 3000);
  assert.equal(view.grossEarnedCents, 8000);
  assert.equal(cashoutBlockReason({ ...view, requestEnabled: true }), "debt");
});
