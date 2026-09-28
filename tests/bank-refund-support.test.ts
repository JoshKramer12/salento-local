import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type Stripe from "stripe";
import { createElement } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { prisma } from "@/lib/prisma";
import { createRefundFixture } from "./helpers/refund-fixture";
import { addUtcDays, isBusinessMembershipPublic } from "@/lib/business-membership";
import { requestBankRefundSupport, reconcileBankRefundFromStripe, closeBankRefundSupportRequest } from "@/lib/bank-refund-support";
import { findInitialRefundForBusiness, requestInitialRefund, reconcileInitialRefund } from "@/lib/self-service-refunds";
import { sendBankRefundRequestNotifications } from "@/lib/bank-refund-notifications";
import { sendInitialRefundNotifications } from "@/lib/refund-notifications";
import { payableCommissionWhere, getPartnerBalanceSummary, ensurePartnerRefundRepurchaseCommissionForPayment } from "@/lib/partner-ledger";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { BankRefundRequest } from "@/components/account/bank-refund-request";
import { getSupportContactEmail } from "@/lib/support-contact";

const directory = mkdtempSync(join(tmpdir(), "salento-bank-refund-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_bank_refund";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
async function fixture(paidAt = new Date()) {
  const f = await createRefundFixture(prisma, `bank-${++sequence}`, paidAt);
  const payment = await prisma.payment.update({ where: { id: f.payment.id }, data: { method: "BANK_TRANSFER" } });
  const operator = await prisma.user.create({ data: { id: `operator-bank-${sequence}`, username: `operator-bank-${sequence}`, role: "ADMIN", profileCompleted: true } });
  return { ...f, payment, operator };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function harness(f: Fixture, status: Stripe.Refund.Status = "succeeded") {
  let creates = 0;
  const refund = { id: `re_bank_${sequence}`, status, amount: 10000, currency: "eur", payment_intent: f.payment.stripePaymentIntentId, metadata: {}, created: Math.floor(Date.now() / 1000), charge: `ch_${sequence}` } as Stripe.Refund;
  const charge = { paid: true, amount: 10000, amount_refunded: 0, payment_method_details: { type: "customer_balance" } };
  const refunds: Stripe.Refund[] = [];
  const stripe = {
    paymentIntents: { retrieve: async () => ({ status: "succeeded", amount_received: 10000, currency: "eur", latest_charge: refund.charge }) },
    charges: { retrieve: async () => charge },
    refunds: { create: async () => { creates++; throw new Error("owner_must_not_create_bank_refund"); }, retrieve: async () => refund, list: async () => ({ data: refunds, has_more: false }) },
  } as unknown as Stripe;
  const reconcile = (value = refund) => reconcileInitialRefund(value, value.id, { stripe, revalidatePaths: false, notify: async () => {} });
  return { stripe, refund, charge, refunds, reconcile, get creates() { return creates; } };
}
const request = (f: Fixture, h: ReturnType<typeof harness>, now?: Date) => requestBankRefundSupport({ businessId: f.business.id, userId: f.owner.id, locale: "en" }, { stripe: h.stripe, now, revalidatePaths: false, notify: async () => {} });
const operatorParams = (f: Fixture) => ({ userId: f.operator.id, paymentId: f.payment.id, businessId: f.business.id });

test("eligible bank payment retains refund eligibility and shows the support confirmation in EN/IT", async () => {
  const f = await fixture();
  assert.equal((await findInitialRefundForBusiness(f.business.id)).state, "AVAILABLE");
  for (const locale of ["en", "it"] as const) {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} } as never }, createElement(BankRefundRequest, { businessId: f.business.id, businessName: f.business.name, paymentId: f.payment.id, amount: "€100.00", requestedAt: null, state: "AVAILABLE", locale, ownerEmail: f.owner.email })));
    assert.match(html, locale === "en" ? /Submit refund request/ : /Invia richiesta di rimborso/);
    assert.match(html, locale === "en" ? /remain active until/ : /resterà attiva fino/);
    assert.doesNotMatch(html, /Stripe’s bank-refund instructions|instructions_email/);
  }
});

test("Owner action dispatches bank rail to durable support without any refunds.create", async () => {
  const f = await fixture(); const h = harness(f);
  const bankSupport: typeof requestBankRefundSupport = (params, dependencies) => requestBankRefundSupport(params, { ...dependencies, revalidatePaths: false, notify: async () => {} });
  const result = await requestInitialRefund({ businessId: f.business.id, userId: f.owner.id }, { stripe: h.stripe, sandbox: true, bankSupport });
  assert.equal(result.status, "support_required"); assert.equal(h.creates, 0);
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "PAID"); assert.equal(p.refundRequestAmountCents, 10000); assert.equal(p.refundRequestedByUserId, f.owner.id);
  assert.ok(p.refundRequestedAt); assert.equal(p.stripeRefundId, null); assert.equal(p.refundedAt, null);
});

test("request preserves entitlement and payout hold after Day 14 without changing its timestamp", async () => {
  const f = await fixture(addUtcDays(new Date(), -13)); const h = harness(f);
  await request(f, h); const original = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  await request(f, h, addUtcDays(f.payment.paidAt!, 30));
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.deepEqual(p.refundRequestedAt, original.refundRequestedAt);
  assert.equal((await findInitialRefundForBusiness(f.business.id, addUtcDays(f.payment.paidAt!, 30))).state, "SUPPORT_REQUIRED");
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 30)), partnerUserId: f.partner.id } }), 0);
  assert.equal((await getPartnerBalanceSummary(f.partner.id)).available, 0);
  assert.equal(isBusinessMembershipPublic({ ...f.membership, now: new Date() }), true);
});

test("simultaneous bank submissions produce one durable request and hold", async () => {
  const f = await fixture(); const h = harness(f);
  const results = await Promise.allSettled([request(f, h), request(f, h)]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  assert.equal(await prisma.payment.count({ where: { id: f.payment.id, refundStatus: "support_required" } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 0);
  assert.equal(h.creates, 0);
});

test("cross-Owner and Partner authorization is rejected before recording a bank request", async () => {
  const f = await fixture(); const other = await fixture(); const h = harness(f);
  for (const userId of [other.owner.id, f.partner.id]) await assert.rejects(requestBankRefundSupport({ businessId: f.business.id, userId }, { stripe: h.stripe }), /refund_not_authorized/);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).refundRequestedAt, null);
});

test("wrong Business/submission association is rejected", async () => {
  const f = await fixture(); const other = await fixture(); const h = harness(f);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { createdBusinessId: other.business.id } });
  await assert.rejects(request(f, h), /refund_not_eligible/);
});

test("exact fourteen-day deadline and requests after it are rejected by the server", async () => {
  for (const days of [14, 15]) { const f = await fixture(); const h = harness(f); await assert.rejects(request(f, h, addUtcDays(f.payment.paidAt!, days)), /refund_not_eligible/); }
});

test("annual renewals, unpaid and already refunded payments cannot request bank support", async () => {
  for (const data of [{ purpose: "ANNUAL_RENEWAL" as const }, { status: "PENDING_PAYMENT" as const }, { status: "REFUNDED" as const }]) {
    const f = await fixture(); const h = harness(f); await prisma.payment.update({ where: { id: f.payment.id }, data });
    await assert.rejects(request(f, h), /refund_not_eligible/);
  }
});

test("client rail, amount and Payment ID cannot change the server-selected bank request", async () => {
  const f = await fixture(); const h = harness(f);
  const forged = { businessId: f.business.id, userId: f.owner.id, amountCents: 1, method: "STRIPE_CHECKOUT", paymentId: "some-other-payment" };
  await requestBankRefundSupport(forged, { stripe: h.stripe, revalidatePaths: false, notify: async () => {} });
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.refundRequestAmountCents, 10000); assert.equal(p.method, "BANK_TRANSFER"); assert.equal(h.creates, 0);
});

test("provider card rail masquerading as bank and provider amount mismatch are rejected", async () => {
  for (const mutate of [(h: ReturnType<typeof harness>) => { h.charge.payment_method_details.type = "card"; }, (h: ReturnType<typeof harness>) => { h.charge.amount = 9999; }]) {
    const f = await fixture(); const h = harness(f); mutate(h); await assert.rejects(request(f, h), /refund_bank_payment_mismatch/);
  }
});

test("already AVAILABLE commission becomes PENDING and cannot enter the weekly selector", async () => {
  const f = await fixture(); const h = harness(f);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "AVAILABLE" } });
  await request(f, h);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 90)), paymentId: f.payment.id } }), 0);
  const ledger = readFileSync("src/lib/partner-ledger.ts", "utf8");
  assert.ok((ledger.match(/\.\.\.payableCommissionWhere\(new Date\(\)\)/g) ?? []).length >= 4);
});

test("paid/reserved commission and incorrect Partner attribution block bank requests safely", async () => {
  for (const data of [{ status: "PAID" as const }, { status: "RESERVED" as const }, { partnerUserId: "wrong" }]) {
    const f = await fixture(); const h = harness(f);
    if ("partnerUserId" in data) await prisma.user.create({ data: { id: "wrong", username: "wrong-bank", role: "GETTER" } });
    await prisma.partnerCommission.update({ where: { id: f.commission.id }, data });
    await assert.rejects(request(f, h), /operator_review/);
  }
});

test("support, Owner and Partner receive one request email each with accurate pending wording", async () => {
  const f = await fixture(); const h = harness(f); await request(f, h);
  const sends: Array<{ to: string; subject: string; text: string; idempotencyKey?: string }> = [];
  const send = async (args: typeof sends[number]) => { sends.push(args); return { success: true as const, provider: "smtp" as const, messageId: "synthetic" }; };
  await sendBankRefundRequestNotifications(f.payment.id, { send, supportEmail: "support@example.test" });
  await sendBankRefundRequestNotifications(f.payment.id, { send, supportEmail: "support@example.test" });
  assert.equal(sends.length, 3); assert.equal(new Set(sends.map((s) => s.idempotencyKey)).size, 3);
  const support = sends.find((s) => s.to === "support@example.test")!;
  for (const value of [f.business.id, f.submission.id, f.owner.id, f.payment.id, f.partner.id, f.commission.id, f.payment.stripePaymentIntentId!]) assert.ok(support.text.includes(value));
  const owner = sends.find((s) => s.to === f.owner.email)!; assert.match(owner.text, /eligibility is preserved/); assert.match(owner.text, /has not been completed/);
  const partner = sends.find((s) => s.to === f.partner.email)!; assert.match(partner.text, /temporarily on hold/); assert.doesNotMatch(partner.text, /has been canceled/);
});

test("Italian request confirmation and hold notification are localized", async () => {
  const f = await fixture(); const h = harness(f);
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { preferredLanguage: "it" } });
  await requestBankRefundSupport({ businessId: f.business.id, userId: f.owner.id, locale: "it" }, { stripe: h.stripe, revalidatePaths: false, notify: async () => {} });
  const subjects: string[] = [];
  await sendBankRefundRequestNotifications(f.payment.id, { supportEmail: "support@example.test", send: async (args) => { subjects.push(args.subject); return { success: true, provider: "smtp", messageId: "test" }; } });
  assert.ok(subjects.includes("Abbiamo ricevuto la tua richiesta di rimborso")); assert.ok(subjects.some((s) => s.startsWith("Commissione in sospeso")));
});

test("request email failure is recorded without undoing the request or retrying ambiguously", async () => {
  const f = await fixture(); const h = harness(f); await request(f, h); let sends = 0;
  const dependencies = { supportEmail: "support@example.test", send: async () => { sends++; throw new Error("synthetic_mail_failure"); } };
  await sendBankRefundRequestNotifications(f.payment.id, dependencies); await sendBankRefundRequestNotifications(f.payment.id, dependencies);
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(sends, 3); assert.equal(p.refundStatus, "support_required"); assert.equal(p.ownerRefundRequestEmailError, "synthetic_mail_failure");
});

test("support address reuses configured contact and never needs a hardcoded personal email", () => {
  assert.equal(getSupportContactEmail({ SMTP_REPLY_TO: "support@example.test" }), "support@example.test");
  assert.equal(getSupportContactEmail({ RESEND_FROM: "Salento Local <business@example.test>" }), "business@example.test");
  assert.equal(getSupportContactEmail({ SUPPORT_EMAIL: "help@example.test", RESEND_FROM: "other@example.test" }), "help@example.test");
});

test("successful untagged bank refund completes via shared reconciliation after the request deadline", async () => {
  const f = await fixture(addUtcDays(new Date(), -13)); const h = harness(f); await request(f, h);
  h.refund.created = Math.floor(addUtcDays(f.payment.paidAt!, 20).getTime() / 1000);
  await h.reconcile(); await h.reconcile();
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "REFUNDED"); assert.equal(p.refundedAmountCents, 10000); assert.ok(p.selfServiceRefundedAt);
  const b = await prisma.business.findUniqueOrThrow({ where: { id: f.business.id }, include: { membership: true, images: true, hours: true } });
  assert.equal(isBusinessMembershipPublic({ ...b.membership!, now: new Date() }), false); assert.equal(b.images.length, 1); assert.equal(b.hours.length, 1);
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "REVERSED");
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
});

test("Admin verifies exact Stripe completion; Owner cannot invoke the operator workflow", async () => {
  const f = await fixture(); const h = harness(f); await request(f, h);
  await assert.rejects(reconcileBankRefundFromStripe({ ...operatorParams(f), userId: f.owner.id, refundId: h.refund.id }, { stripe: h.stripe }), /refund_not_authorized/);
  await reconcileBankRefundFromStripe({ ...operatorParams(f), refundId: h.refund.id }, { stripe: h.stripe, revalidatePaths: false, notify: async () => {} });
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "REFUNDED");
});

test("Admin rejects cross-Business, cross-Payment, partial and wrong-currency provider refunds", async () => {
  for (const variant of ["business", "intent", "amount", "currency"]) {
    const f = await fixture(); const h = harness(f); await request(f, h);
    if (variant === "intent") h.refund.payment_intent = "pi_other";
    if (variant === "amount") h.refund.amount = 5000;
    if (variant === "currency") h.refund.currency = "usd";
    await assert.rejects(reconcileBankRefundFromStripe({ ...operatorParams(f), businessId: variant === "business" ? "other" : f.business.id, refundId: h.refund.id }, { stripe: h.stripe, revalidatePaths: false }), /refund_not_eligible|attribution_conflict/);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  }
});

test("pending, action-required, failed and canceled returns leave paid membership and commission intact", async () => {
  for (const status of ["pending", "requires_action", "failed", "canceled"] as const) {
    const f = await fixture(); const h = harness(f, status); await request(f, h); await h.reconcile();
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
    assert.equal(p.status, "PAID"); assert.equal(p.refundStatus, status); assert.ok(p.refundRequestedAt);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).entitlementRevokedAt, null);
    assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
    assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 40)), paymentId: p.id } }), 0);
  }
});

test("final bank Owner and Partner emails remain independent and exactly once", async () => {
  const f = await fixture(); const h = harness(f); await request(f, h); await h.reconcile(); let sends = 0;
  const send = async () => { sends++; return { success: true as const, provider: "smtp" as const, messageId: "final" }; };
  await sendInitialRefundNotifications(f.payment.id, { send }); await sendInitialRefundNotifications(f.payment.id, { send });
  assert.equal(sends, 2); const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } }); assert.ok(p.ownerRefundEmailSentAt); assert.ok(p.partnerRefundEmailSentAt);
});

test("qualifying completed bank refund permits one fresh €50 repurchase on the same Business", async () => {
  const f = await fixture(); const h = harness(f); await request(f, h); await h.reconcile();
  const paidAt = addUtcDays(f.payment.paidAt!, 40);
  const result = await finalizeMembershipRenewalPayment({ businessId: f.business.id, db: prisma, method: "STRIPE_CHECKOUT", paidAt, amountPaidCents: 10000, paymentIntentId: `pi_new_bank_${sequence}` });
  assert.equal(result?.purpose, "INITIAL_MEMBERSHIP");
  for (let i = 0; i < 2; i++) await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result!.paymentId! }, { revalidatePaths: () => {} });
  const commissions = await prisma.partnerCommission.findMany({ where: { businessId: f.business.id, type: "COMMISSION", status: "PENDING" } });
  assert.equal(commissions.length, 1); assert.equal(commissions[0].amountCents, 5000); assert.deepEqual(commissions[0].eligibleAt, addUtcDays(paidAt, 14));
});

test("withdrawn bank request releases hold with evidence and preserves its original request history", async () => {
  const f = await fixture(addUtcDays(new Date(), -13)); const h = harness(f); await request(f, h);
  await closeBankRefundSupportRequest({ ...operatorParams(f), note: "Owner withdrew by email, reference support-test-123; no funds returned." }, { stripe: h.stripe, revalidatePaths: false });
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "PAID"); assert.equal(p.refundStatus, "support_closed"); assert.ok(p.refundRequestedAt); assert.ok(p.bankRefundResolvedAt); assert.equal(p.bankRefundResolvedByUserId, f.operator.id);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(addUtcDays(f.payment.paidAt!, 15)), paymentId: f.payment.id } }), 1);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).entitlementRevokedAt, null);
});

test("closure rejects missing evidence, returned money, unresolved refunds and non-admins", async () => {
  for (const variant of ["note", "returned", "pending", "owner"]) {
    const f = await fixture(); const h = harness(f); await request(f, h);
    if (variant === "returned") h.charge.amount_refunded = 10000;
    if (variant === "pending") { h.refund.status = "pending"; h.refunds.push(h.refund); }
    await assert.rejects(closeBankRefundSupportRequest({ ...operatorParams(f), userId: variant === "owner" ? f.owner.id : f.operator.id, note: variant === "note" ? "short" : "Owner withdrawal verified by support email reference 123." }, { stripe: h.stripe, revalidatePaths: false }), /evidence_required|still_unresolved|not_authorized/);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).refundStatus, "support_required");
  }
});


test("a failed bank return still blocks a new membership purchase until support resolves the request", async () => {
  const f = await fixture(); const h = harness(f, "failed"); await request(f, h); await h.reconcile();
  await assert.rejects(finalizeMembershipRenewalPayment({ businessId: f.business.id, db: prisma, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(f.payment.paidAt!, 20), amountPaidCents: 10000, paymentIntentId: "pi_bank_unresolved_new" }), /renewal_during_initial_refund_processing/);
  assert.equal(await prisma.payment.count({ where: { businessId: f.business.id } }), 1);
});


test("a failed bank return can be replaced by a verified successful return without losing timely provenance", async () => {
  const f = await fixture(); const h = harness(f, "failed"); await request(f, h); await h.reconcile();
  const old = { ...h.refund }; const replacement = { ...h.refund, id: h.refund.id + "_retry", status: "succeeded" as const };
  h.stripe.refunds.retrieve = (async (id: string) => id === old.id ? old : replacement) as never;
  await reconcileBankRefundFromStripe({ ...operatorParams(f), refundId: replacement.id }, { stripe: h.stripe, revalidatePaths: false, notify: async () => {} });
  await reconcileInitialRefund(old, old.id, { stripe: h.stripe, revalidatePaths: false, notify: async () => {} });
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } });
  assert.equal(p.status, "REFUNDED"); assert.equal(p.stripeRefundId, replacement.id); assert.equal(p.refundStatus, "succeeded"); assert.ok(p.refundRequestedAt);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: p.id, type: "REVERSAL" } }), 1);
});
