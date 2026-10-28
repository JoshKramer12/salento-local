import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

import { addUtcDays } from "@/lib/business-membership";
import { sendTransactionalEmail } from "@/lib/email";
import { attemptMembershipPaymentOutcomeDelivery, retryPendingMembershipPaymentOutcomes } from "@/lib/membership-payment-outcomes";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { ensurePartnerRenewalCommissionForPayment } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-outcome-delivery-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
async function fixture() { return createRefundFixture(prisma, `outcome-${++sequence}`); }

function sentMessageStore() {
  const messages: Array<{ idempotencyKey?: string; subject: string; text: string; to: string }> = [];
  const sendEmail = async (message: { idempotencyKey?: string; subject: string; text: string; to: string }) => {
    messages.push(message);
    return { messageId: `resend-${messages.length}`, provider: "resend" as const, success: true };
  };
  return { messages, sendEmail };
}

test("Checkout renewal commits once and one English outcome is accepted", async () => {
  const f = await fixture();
  assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: f.payment.id } }), 0);
  await prisma.businessOwnerAccess.create({ data: { businessId: f.business.id, email: f.owner.email, userId: f.owner.id, activatedAt: new Date() } });
  await prisma.legalAcceptance.create({ data: { userId: f.owner.id, documentType: "BUSINESS_TERMS", documentVersion: "test-en", acceptanceContext: "BUSINESS_SIGNUP", locale: "en" } });
  const paidAt = new Date();
  const params = { amountPaidCents: 10000, businessId: f.business.id, method: "STRIPE_CHECKOUT" as const,
    paidAt, paymentIntentId: `pi_checkout_${f.business.id}`, sessionId: `cs_checkout_${f.business.id}` };
  const result = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...params, db }));
  assert.ok(result?.paymentId);
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId }, { revalidatePaths: () => {} });
  const mail = sentMessageStore();
  assert.equal(await attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: mail.sendEmail }), "accepted");
  const duplicate = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...params, db }));
  assert.equal(duplicate?.duplicate, true);
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId }, { revalidatePaths: () => {} });
  assert.equal(await attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: mail.sendEmail }), "skipped");
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0].to, f.owner.email);
  assert.match(mail.messages[0].subject, /renewed/);
  assert.match(mail.messages[0].text, /€100 was charged/);
  assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: result.paymentId } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: result.paymentId, amountCents: 1500 } }), 1);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  const delivery = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } });
  assert.ok(delivery.acceptedAt); assert.equal(delivery.provider, "resend"); assert.equal(delivery.providerMessageId, "resend-1");
});

test("recurring invoice provider failure leaves payment paid and retries with one stable provider key", async () => {
  const f = await fixture();
  const subscriptionId = `sub_${f.business.id}`;
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { stripeSubscriptionId: subscriptionId } });
  const params = { amountPaidCents: 10000, invoiceId: `in_${f.business.id}`, paymentIntentId: `pi_${f.business.id}`,
    subscriptionId, method: "STRIPE_CHECKOUT" as const, paidAt: new Date() };
  const result = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...params, db }));
  assert.ok(result?.paymentId);
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId }, { revalidatePaths: () => {} });
  const keys: string[] = [];
  const fail = async (message: { idempotencyKey?: string }) => { keys.push(message.idempotencyKey!); throw new Error("synthetic_resend_unavailable"); };
  const before = new Date();
  assert.equal(await attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: fail as never }), "pending");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).status, "PAID");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  const duplicate = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ ...params, db }));
  assert.equal(duplicate?.duplicate, true);
  await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId }, { revalidatePaths: () => {} });
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: result.paymentId, amountCents: 1500 } }), 1);
  const pending = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } });
  assert.equal(pending.acceptedAt, null); assert.equal(pending.attemptCount, 1);
  assert.equal(pending.failureMessage, "synthetic_resend_unavailable");
  assert.ok(pending.nextAttemptAt > before);
  const mail = sentMessageStore();
  const retryAt = new Date(pending.nextAttemptAt.getTime() + 1);
  assert.deepEqual(await retryPendingMembershipPaymentOutcomes({ now: retryAt, sendEmail: async (message) => {
    keys.push(message.idempotencyKey!); return mail.sendEmail(message);
  } }), { accepted: 1, due: 1 });
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  assert.equal(mail.messages.length, 1);
  assert.deepEqual(await retryPendingMembershipPaymentOutcomes({ now: addUtcDays(retryAt, 1), sendEmail: mail.sendEmail }), { accepted: 0, due: 0 });
  assert.ok((await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } })).acceptedAt);
});

test("a hung outcome send times out, preserves paid state, and a later retry uses the same key", { timeout: 2000 }, async () => {
  const f = await fixture();
  const result = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({
    db, businessId: f.business.id, amountPaidCents: 10000, method: "STRIPE_CHECKOUT",
    paidAt: new Date(), paymentIntentId: `pi_timeout_${f.business.id}`,
  }));
  assert.ok(result?.paymentId);
  let enteredSend!: () => void;
  const sendStarted = new Promise<void>((resolve) => { enteredSend = resolve; });
  let activeSignal: AbortSignal | undefined;
  let firstKey: string | undefined;
  let sendCount = 0;
  const hungSend = async (message: Parameters<typeof sendTransactionalEmail>[0]): ReturnType<typeof sendTransactionalEmail> => {
    sendCount++;
    firstKey = message.idempotencyKey;
    activeSignal = message.signal;
    enteredSend();
    return new Promise(() => {});
  };
  const startedAt = Date.now();
  const firstAttempt = attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: hungSend, sendTimeoutMs: 25 });
  await sendStarted;
  assert.equal(await attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: hungSend }), "skipped");
  assert.deepEqual(await retryPendingMembershipPaymentOutcomes({ sendEmail: hungSend }), { accepted: 0, due: 0 });
  assert.equal(sendCount, 1);
  assert.equal(await firstAttempt, "pending");
  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(activeSignal?.aborted, true);

  const pending = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } });
  assert.equal(pending.acceptedAt, null);
  assert.equal(pending.attemptCount, 1);
  assert.equal(pending.failureMessage, "membership_outcome_send_timeout");
  assert.ok(pending.nextAttemptAt > new Date());
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).status, "PAID");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());

  const mail = sentMessageStore();
  assert.deepEqual(await retryPendingMembershipPaymentOutcomes({
    now: new Date(pending.nextAttemptAt.getTime() + 1),
    sendEmail: async (message) => { assert.equal(message.idempotencyKey, firstKey); return mail.sendEmail(message); },
  }), { accepted: 1, due: 1 });
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0].idempotencyKey, firstKey);
  assert.ok((await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } })).acceptedAt);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).status, "PAID");
});

test("the shared sender passes an outcome abort signal and stable key to Resend", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  let requestKey: string | null = null;
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
  globalThis.fetch = async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    requestKey = new Headers(init?.headers).get("Idempotency-Key");
    fetchStarted();
    const signal = requestSignal;
    if (!signal) throw new Error("missing_abort_signal");
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("synthetic_abort")), { once: true });
    });
  };
  try {
    const sending = sendTransactionalEmail({
      html: "<p>test</p>", idempotencyKey: "membership-payment-outcome:local-test",
      signal: controller.signal, subject: "test", text: "test", to: "test@example.com",
    }, { RESEND_API_KEY: "re_local_test", RESEND_FROM: "Salento Local <hello@example.com>" });
    await started;
    controller.abort();
    await assert.rejects(sending, /Unable to fetch data/);
    assert.equal(requestSignal, controller.signal);
    assert.equal(requestKey, "membership-payment-outcome:local-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bank transfer reactivation without a recipient stays actionable and later sends Italian copy", async () => {
  const f = await fixture();
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: {
    currentPeriodEnd: addUtcDays(new Date(), -20), graceEndsAt: addUtcDays(new Date(), -6),
  } });
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { ownerEmail: "invalid" } });
  const result = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({ db, businessId: f.business.id,
    amountPaidCents: 10000, method: "BANK_TRANSFER", paidAt: new Date(), paymentIntentId: `pi_bank_${f.business.id}` }));
  assert.equal(result?.purpose, "REACTIVATION");
  assert.ok(result?.paymentId);
  let sends = 0;
  assert.equal(await attemptMembershipPaymentOutcomeDelivery(result.paymentId, { sendEmail: async () => { sends++; throw new Error("should_not_send"); } }), "pending");
  assert.equal(sends, 0);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).status, "PAID");
  const pending = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: result.paymentId } });
  assert.equal(pending.failureMessage, "membership_outcome_recipient_missing");
  assert.equal(pending.recipientEmail, null);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { ownerEmail: f.owner.email! } });
  const mail = sentMessageStore();
  assert.deepEqual(await retryPendingMembershipPaymentOutcomes({ now: new Date(pending.nextAttemptAt.getTime() + 1), sendEmail: mail.sendEmail }), { accepted: 1, due: 1 });
  assert.equal(mail.messages[0].to, f.owner.email);
  assert.match(mail.messages[0].subject, /rinnovato/);
  assert.match(mail.messages[0].text, /Sono stati addebitati €100/);
});

test("migration only creates an empty delivery table and preserves old payments", async () => {
  const sql = readFileSync("prisma/migrations/20261006120000_add_membership_payment_outcome_delivery/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "MembershipPaymentOutcomeDelivery"/);
  assert.match(sql, /CREATE UNIQUE INDEX "MembershipPaymentOutcomeDelivery_paymentId_key"/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "Payment"|DELETE FROM|DROP TABLE/);
  const f = await fixture();
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: f.payment.id } }), 0);
});

test("additive migration applies to existing paid records without backfilling mail", async () => {
  const migrationDirectory = mkdtempSync(join(tmpdir(), "salento-outcome-migration-"));
  const url = `file:${join(migrationDirectory, "existing.db")}`;
  writeFileSync(join(migrationDirectory, "existing.db"), "");
  const environment = { ...process.env, DATABASE_URL: url };
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: environment, stdio: "pipe" });
    const old = await createRefundFixture(db, "migration-old");
    await db.$executeRawUnsafe('DROP TABLE "MembershipPaymentOutcomeDelivery"');
    const sql = readFileSync("prisma/migrations/20261006120000_add_membership_payment_outcome_delivery/migration.sql", "utf8");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
      { env: environment, input: sql, stdio: "pipe" });
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).status, "PAID");
    assert.equal(await db.partnerCommission.count({ where: { paymentId: old.payment.id } }), 1);
    assert.equal(await db.membershipPaymentOutcomeDelivery.count(), 0);
    assert.deepEqual(await db.$queryRawUnsafe('PRAGMA foreign_key_check'), []);
  } finally {
    await db.$disconnect();
    rmSync(migrationDirectory, { force: true, recursive: true });
  }
});

test("a paid renewal webhook acknowledges email failure and duplicate delivery without changing paid state", async () => {
  const f = await fixture();
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { originatingPartnerUserId: null } });
  await prisma.payment.create({ data: { businessId: f.business.id, businessSubmissionId: f.submission.id,
    userId: f.owner.id, method: "STRIPE_CHECKOUT", amountCents: 10000,
    purpose: "ANNUAL_RENEWAL", status: "PENDING_PAYMENT", stripeCheckoutSessionId: `cs_${f.business.id}` } });
  const secret = "whsec_local_outcome_test";
  const old = { stripe: process.env.STRIPE_SECRET_KEY, publishable: process.env.STRIPE_PUBLISHABLE_KEY, webhook: process.env.STRIPE_WEBHOOK_SECRET,
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, resend: process.env.RESEND_API_KEY };
  process.env.STRIPE_SECRET_KEY = "sk_test_local_outcome_test";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_local_outcome_test";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  delete process.env.RESEND_API_KEY;
  const event = { id: `evt_${f.business.id}`, type: "checkout.session.completed", livemode: false,
    data: { object: { id: `cs_${f.business.id}`, amount_total: 10000, currency: "eur", payment_status: "paid",
      metadata: { paymentFlow: "MEMBERSHIP_RENEWAL", businessId: f.business.id,
        businessSubmissionId: f.submission.id, userId: f.owner.id },
      payment_intent: `pi_webhook_${f.business.id}`, customer: null, subscription: null } } };
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const request = () => new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload });
  try {
    const first = await stripeWebhook(request());
    assert.equal(first.status, 200);
    assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status, "PROCESSED");
    const paid = await prisma.payment.findFirstOrThrow({ where: { stripeCheckoutSessionId: event.data.object.id } });
    assert.equal(paid.status, "PAID");
    const delivery = await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({ where: { paymentId: paid.id } });
    assert.equal(delivery.acceptedAt, null); assert.ok(delivery.failureMessage);
    assert.equal((await stripeWebhook(request())).status, 200);
    assert.equal(await prisma.payment.count({ where: { stripeCheckoutSessionId: event.data.object.id } }), 1);
    assert.equal(await prisma.membershipPaymentOutcomeDelivery.count({ where: { paymentId: paid.id } }), 1);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  } finally {
    for (const [key, value] of Object.entries({ STRIPE_SECRET_KEY: old.stripe, STRIPE_PUBLISHABLE_KEY: old.publishable, STRIPE_WEBHOOK_SECRET: old.webhook,
      SMTP_HOST: old.host, SMTP_PORT: old.port, RESEND_API_KEY: old.resend })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
