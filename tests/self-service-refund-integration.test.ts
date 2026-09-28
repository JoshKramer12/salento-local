import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { createRefundFixture } from "./helpers/refund-fixture";
import { addUtcDays, isBusinessMembershipPublic } from "@/lib/business-membership";
import { findInitialRefundForBusiness, initialRefundState, reconcileInitialRefund, requestInitialRefund } from "@/lib/self-service-refunds";
import { requestBankRefundSupport } from "@/lib/bank-refund-support";
import { sendInitialRefundNotifications } from "@/lib/refund-notifications";
import { ensurePartnerRefundRepurchaseCommissionForPayment, ensurePartnerRenewalCommissionForPayment, getPartnerBalanceSummary, payableCommissionWhere } from "@/lib/partner-ledger";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";

const directory = mkdtempSync(join(tmpdir(), "salento-refund-integration-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
const fixture = () => createRefundFixture(prisma, `integration-${++sequence}`);
function stripeHarness(payment: { id: string; businessId: string | null; amountCents: number; stripePaymentIntentId: string | null }, status = "succeeded") {
  let created = 0;
  let params: Stripe.RefundCreateParams | undefined;
  const refund = { id: `re_${payment.id}`, status, amount: payment.amountCents, currency: "eur", payment_intent: payment.stripePaymentIntentId, charge: `ch_${payment.id}`, created: Math.floor(Date.now() / 1000), metadata: { salentoRefundType: "initial_membership_14_day", salentoPaymentId: payment.id, salentoBusinessId: payment.businessId } } as Stripe.Refund;
  const stripe = {
    paymentIntents: { retrieve: async () => ({ status: "succeeded", amount_received: payment.amountCents, currency: "eur", latest_charge: `ch_${payment.id}` }) },
    charges: { retrieve: async () => ({ payment_method_details: { type: "card" }, paid: true, amount_refunded: created ? payment.amountCents : 0, amount: payment.amountCents }) },
    refunds: { retrieve: async () => refund, create: async (args: Stripe.RefundCreateParams) => { params = args; created = 1; return refund; } },
  } as unknown as Stripe;
  const reconcile = (value: Stripe.Refund) => reconcileInitialRefund(value, value.id, { stripe, revalidatePaths: false, notify: async () => {} });
  return { stripe, refund, reconcile, get created() { return created; }, get params() { return params; } };
}

test("SQLite refund converges once and retains Business, Owner, Partner, photos, hours and signed evidence", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment);
  const before = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: f.submission.id } });
  await requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, reconcile: h.reconcile, sandbox: true });
  await h.reconcile(h.refund); await h.reconcile(h.refund);
  assert.equal(h.created, 1);
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "REFUNDED"); assert.equal(p.refundedAmountCents, 10000); assert.ok(p.refundedAt);
  const b = await prisma.business.findUniqueOrThrow({ where: { id: f.business.id }, include: { membership: true, images: true, hours: true, submissions: true } });
  assert.equal(b.ownerUserId, f.owner.id); assert.equal(b.membership?.originatingPartnerUserId, f.partner.id);
  assert.equal(b.images.length, 1); assert.equal(b.hours.length, 1); assert.equal(b.description, f.business.description);
  assert.equal(isBusinessMembershipPublic({ ...b.membership!, now: new Date() }), false);
  assert.equal(b.submissions[0].agreementSignature, before.agreementSignature); assert.equal(b.submissions[0].businessTermsVersion, before.businessTermsVersion);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: p.id, type: "REVERSAL" } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { partnerUserId: f.partner.id, status: "DEBT" } }), 0);
  assert.equal((await findInitialRefundForBusiness(f.business.id)).state, "REFUNDED");
});

test("authorization changes cannot refund another Owner's exact Business or a Partner-owned payment", async () => {
  const f = await fixture(); const other = await fixture(); const h = stripeHarness(f.payment);
  for (const userId of [other.owner.id, f.partner.id]) await assert.rejects(requestInitialRefund({ businessId: f.business.id, userId }, { stripe: h.stripe, sandbox: true }), /refund_not_authorized/);
  assert.equal(h.created, 0);
});

test("simultaneous tabs converge through durable refund state and one exact reversal", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment);
  const results = await Promise.allSettled([1, 2].map(() => requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, reconcile: h.reconcile, sandbox: true })));
  assert.ok(results.some((r) => r.status === "fulfilled"));
  await h.reconcile(h.refund);
  assert.equal(await prisma.payment.count({ where: { stripeRefundId: h.refund.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
});

test("processing survives interruption, holds payout and converges from a later Stripe webhook", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment, "pending");
  await requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, reconcile: h.reconcile, sandbox: true });
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  assert.equal((await findInitialRefundForBusiness(f.business.id)).state, "PROCESSING");
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 15)), partnerUserId: f.partner.id } }), 0);
  h.refund.status = "succeeded";
  await h.reconcile(h.refund);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "REFUNDED");
});

test("an old succeeded webhook cannot override current requires_action bank status", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment, "requires_action");
  await h.reconcile({ ...h.refund, status: "succeeded" });
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "PAID"); assert.equal(p.refundStatus, "requires_action");
  assert.equal(initialRefundState(p), "ACTION_REQUIRED");
});

test("bank transfer records a support contact without creating an automatic Stripe refund", async () => {
  const f = await fixture(); await prisma.payment.update({ where: { id: f.payment.id }, data: { method: "BANK_TRANSFER" } });
  await prisma.user.update({ where: { id: f.owner.id }, data: { email: null } });
  const h = stripeHarness(f.payment, "requires_action");
  h.stripe.charges.retrieve = (async () => ({ paid: true, amount: 10000, amount_refunded: 0, payment_method_details: { type: "customer_balance" } })) as never;
  const bankSupport: typeof requestBankRefundSupport = (params, dependencies) => requestBankRefundSupport(params, { ...dependencies, revalidatePaths: false, notify: async () => {} });
  await assert.rejects(requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, sandbox: true, bankSupport }), /refund_contact_email_required/);
  await requestInitialRefund({ businessId: f.business.id, userId: f.owner.id, instructionsEmail: "instructions@example.test" }, { stripe: h.stripe, sandbox: true, bankSupport });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(payment.refundInstructionsEmail, "instructions@example.test");
  assert.equal(h.created, 0);
  assert.equal((await findInitialRefundForBusiness(f.business.id)).state, "SUPPORT_REQUIRED");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { businessId: f.business.id } })).entitlementRevokedAt, null);
});

test("paid/reserved historical commission fails safely before refund creation", async () => {
  for (const status of ["PAID", "RESERVED"] as const) {
    const f = await fixture(); const h = stripeHarness(f.payment);
    await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status } });
    await assert.rejects(requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, sandbox: true }), /operator_review/);
    assert.equal(h.created, 0);
  }
});

test("initial payout query returns zero before day 14 and €50 at the exact elapsed boundary", async () => {
  const f = await fixture();
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 13)), partnerUserId: f.partner.id } }), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 14)), partnerUserId: f.partner.id } }), 1);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 0);
});

test("refund repurchase reactivates the same Business with one new €50 and a new 14-day hold", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment);
  await h.reconcile(h.refund);
  const paidAt = addUtcDays(f.payment.paidAt!, 60);
  const params = { amountPaidCents: 10000, businessId: f.business.id, db: prisma, method: "STRIPE_CHECKOUT" as const, paidAt, paymentIntentId: `pi_repurchase_${f.payment.id}` };
  const result = await finalizeMembershipRenewalPayment(params);
  assert.equal(result?.purpose, "INITIAL_MEMBERSHIP");
  await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result!.paymentId! }, { revalidatePaths: () => {} });
  const duplicate = await finalizeMembershipRenewalPayment(params);
  await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: duplicate!.paymentId! }, { revalidatePaths: () => {} });
  const rows = await prisma.partnerCommission.findMany({ where: { businessId: f.business.id, status: "PENDING", type: "COMMISSION" } });
  assert.equal(rows.length, 1); assert.equal(rows[0].amountCents, 5000); assert.equal(rows[0].partnerUserId, f.partner.id);
  assert.deepEqual(rows[0].eligibleAt, addUtcDays(paidAt, 14));
  assert.equal(await prisma.business.count({ where: { id: f.business.id } }), 1);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { businessId: f.business.id } })).entitlementRevokedAt, null);
  // A late original refund replay must preserve the newly paid term.
  await h.reconcile(h.refund);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { businessId: f.business.id } })).entitlementRevokedAt, null);
});

test("ordinary expired reactivation pays only the existing €15 and retains the initial €50", async () => {
  const f = await fixture();
  const result = await finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: f.business.id, db: prisma, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(f.payment.paidAt!, 400), paymentIntentId: `pi_expired_${f.payment.id}` });
  assert.equal(result?.purpose, "REACTIVATION");
  await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result!.paymentId! }, { revalidatePaths: () => {} });
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result!.paymentId! }, { revalidatePaths: () => {} });
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result!.paymentId! }, { revalidatePaths: () => {} });
  assert.equal(await prisma.partnerCommission.count({ where: { businessId: f.business.id, amountCents: 5000 } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { businessId: f.business.id, amountCents: 1500 } }), 1);
});

test("Owner and Partner refund notifications claim once with separate stable keys and EN/IT", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment); await h.reconcile(h.refund);
  const sends: Array<{ to: string; subject: string; idempotencyKey?: string }> = [];
  const send = async (args: { to: string; subject: string; idempotencyKey?: string }) => { sends.push(args); return { success: true as const, provider: "smtp" as const, messageId: "synthetic" }; };
  await sendInitialRefundNotifications(f.payment.id, { send });
  await sendInitialRefundNotifications(f.payment.id, { send });
  assert.equal(sends.length, 2); assert.ok(sends.some((s) => s.subject.includes("rimborso"))); assert.ok(sends.some((s) => s.subject.includes("Refund")));
  assert.equal(new Set(sends.map((s) => s.idempotencyKey)).size, 2);
});

test("notification failure is recorded and never rolls back the refund or resends blindly", async () => {
  const f = await fixture(); const h = stripeHarness(f.payment); await h.reconcile(h.refund);
  let sends = 0;
  const send = async () => { sends++; throw new Error("synthetic_delivery_failure"); };
  await sendInitialRefundNotifications(f.payment.id, { send });
  await sendInitialRefundNotifications(f.payment.id, { send });
  assert.equal(sends, 2);
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "REFUNDED"); assert.equal(p.ownerRefundEmailError, "synthetic_delivery_failure"); assert.equal(p.partnerRefundEmailError, "synthetic_delivery_failure");
});
