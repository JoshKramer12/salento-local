import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { addUtcDays } from "@/lib/business-membership";
import { getPartnerBalanceSummary, payableCommissionWhere, recheckReservedPayoutBeforeDispatch, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { reconcilePartnerPaymentDispute } from "@/lib/partner-dispute-holds";
import { getPartnerFinancialReconciliationReport } from "@/lib/partner-financial-reconciliation";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-partner-integrity-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const fixture = (paidAt: Date) => createRefundFixture(prisma, `integrity-${++sequence}`, paidAt);
async function payoutFor(f: Awaited<ReturnType<typeof fixture>>, status: "SCHEDULED" | "PAID" = "SCHEDULED") {
  const run = await prisma.partnerPayoutRun.create({ data: { runKey: `integrity-run-${f.partner.id}`, scheduledFor: new Date(), status: "RUNNING" } });
  return prisma.partnerPayout.create({ data: { payoutRunId: run.id, partnerUserId: f.partner.id, amountCents: 5000, status, payoutMethod: "STRIPE" } });
}
function stripeDisputeHarness(paymentIntentId: string) {
  let status: Stripe.Dispute.Status = "needs_response";
  const stripe = {
    disputes: { retrieve: async () => ({ id: `dp_${paymentIntentId}`, charge: `ch_${paymentIntentId}`, status }) },
    charges: { retrieve: async () => ({ id: `ch_${paymentIntentId}`, payment_intent: paymentIntentId }) },
  } as unknown as Stripe;
  return { stripe, setStatus(next: Stripe.Dispute.Status) { status = next; } };
}

test("unpaid placeholders are excluded from every earned category", async () => {
  const f = await fixture(addUtcDays(new Date(), -2));
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { paymentId: null, eligibleAt: null } });
  const balance = await getPartnerBalanceSummary(f.partner.id);
  assert.deepEqual([balance.totalEarned, balance.pending, balance.available, balance.processing, balance.paid], [0, 0, 0, 0, 0]);
  assert.equal((await getPartnerFinancialReconciliationReport(f.partner.id)).invalidPaymentCommissionLinkIds.includes(f.commission.id), true);
});

test("initial earnings move from pending to available at day 14 without overlap", async () => {
  const day13 = await fixture(addUtcDays(new Date(), -13));
  const before = await getPartnerBalanceSummary(day13.partner.id);
  assert.equal(before.pending, 5000);
  assert.equal(before.available, 0);
  const day14 = await fixture(addUtcDays(new Date(), -14));
  const afterBoundary = await getPartnerBalanceSummary(day14.partner.id);
  assert.equal(afterBoundary.pending, 0);
  assert.equal(afterBoundary.available, 5000);
  assert.equal(afterBoundary.totalEarned, 5000);
  const report = await getPartnerFinancialReconciliationReport(day14.partner.id);
  assert.deepEqual(report.overlappingCategoryCommissionIds, []);
});

test("payment-specific renewal earns €15 immediately and an open refund request holds it", async () => {
  const f = await fixture(addUtcDays(new Date(), -2));
  const payment = await prisma.payment.create({ data: { businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id, amountCents: 10000, method: "STRIPE_CHECKOUT", purpose: "ANNUAL_RENEWAL", status: "PAID", paidAt: new Date() } });
  await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id, paymentId: payment.id, amountCents: 1500, type: "COMMISSION", status: "PENDING", sourceKey: `commission:renewal:${payment.id}`, eligibleAt: payment.paidAt } });
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 1500);
  await prisma.payment.update({ where: { id: payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } });
  const held = await getPartnerBalanceSummary(f.partner.id);
  assert.equal(held.available, 0);
  assert.equal(held.held, 1500);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date()), partnerUserId: f.partner.id } }), 0);
});

test("provider-verified open dispute holds earnings; won releases; duplicate and stale events do not regress", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  const h = stripeDisputeHarness(f.payment.stripePaymentIntentId!);
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).held, 5000);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date()), partnerUserId: f.partner.id } }), 0);
  h.setStatus("won");
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  assert.equal(await prisma.partnerPaymentDispute.count({ where: { paymentId: f.payment.id } }), 1);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 5000);
  h.setStatus("needs_response");
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 0);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).held, 5000);
});

test("lost dispute and paid-commission reversal create debt that blocks a later weekly payout", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  const payout = await payoutFor(f, "PAID");
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PAID", payoutId: payout.id, paidAt: new Date() } });
  const h = stripeDisputeHarness(f.payment.stripePaymentIntentId!);
  h.setStatus("lost");
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  await reversePartnerCommissionForPayment({ eventType: "charge.dispute.closed", reason: "payment_dispute_lost", sourceEventId: `evt_${f.payment.id}`, paymentId: f.payment.id }, { revalidatePaths: () => {} });
  await reversePartnerCommissionForPayment({ eventType: "charge.dispute.closed", reason: "payment_dispute_lost", sourceEventId: `evt_duplicate_${f.payment.id}`, paymentId: f.payment.id }, { revalidatePaths: () => {} });
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 1);
  const renewal = await prisma.payment.create({ data: { businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id, amountCents: 10000, method: "STRIPE_CHECKOUT", purpose: "REACTIVATION", status: "PAID", paidAt: new Date() } });
  await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id, paymentId: renewal.id, amountCents: 1500, type: "COMMISSION", status: "PENDING", sourceKey: `commission:renewal:${renewal.id}`, eligibleAt: renewal.paidAt } });
  const summary = await getPartnerBalanceSummary(f.partner.id);
  assert.equal(summary.paid, 5000);
  assert.equal(summary.debt, 5000);
  assert.equal(summary.adjustments, 0);
  assert.equal(summary.available, 0);
  assert.equal(summary.held, 1500);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date()), partnerUserId: f.partner.id } }), 0);
  assert.equal((await getPartnerFinancialReconciliationReport(f.partner.id)).outstandingDebtIds.length, 1);
});

test("a dispute arriving after reservation cancels an unsent payout without provider calls", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  const payout = await payoutFor(f);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "RESERVED", payoutId: payout.id } });
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).processing, 5000);
  const h = stripeDisputeHarness(f.payment.stripePaymentIntentId!);
  await reconcilePartnerPaymentDispute(`dp_${f.payment.stripePaymentIntentId}`, { stripe: h.stripe });
  assert.equal(await recheckReservedPayoutBeforeDispatch(payout), false);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "CANCELED");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).payoutId, null);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).held, 5000);
});

test("debt created after reservation cancels the next unsent weekly payout", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  const payout = await payoutFor(f);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "RESERVED", payoutId: payout.id } });
  await prisma.partnerCommission.create({ data: {
    partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id,
    paymentId: f.payment.id, amountCents: -5000, type: "ADJUSTMENT", status: "DEBT",
    sourceKey: `debt:reservation:${f.payment.id}`,
  } });
  assert.equal(await recheckReservedPayoutBeforeDispatch(payout), false);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "CANCELED");
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).held, 5000);
});

test("a refund request after reservation cancels the unsent payout", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  const payout = await payoutFor(f);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "RESERVED", payoutId: payout.id } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: new Date(), refundStatus: "requested" } });
  assert.equal(await recheckReservedPayoutBeforeDispatch(payout), false);
  assert.equal((await prisma.partnerPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "CANCELED");
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).held, 5000);
});

test("read-only diagnostic flags paid payout mismatch and ambiguous pre-migration dispute events", async () => {
  const f = await fixture(addUtcDays(new Date(), -20));
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PAID", paidAt: new Date() } });
  await prisma.stripeWebhookEvent.create({ data: { stripeEventId: `evt_old_${f.payment.id}`, endpointType: "PLATFORM", eventType: "charge.dispute.created", stripeObjectId: `dp_old_${f.payment.id}`, status: "PROCESSED" } });
  const report = await getPartnerFinancialReconciliationReport(f.partner.id);
  assert.deepEqual(report.paidCommissionPayoutMismatchIds, [f.commission.id]);
  assert.equal(report.untrackedHistoricalDisputeEventIds.length >= 1, true);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PAID");
});
