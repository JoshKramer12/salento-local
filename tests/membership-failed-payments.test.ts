import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

import { addUtcDays } from "@/lib/business-membership";
import { attemptMembershipFailedPaymentDelivery, recordMembershipInvoiceFailure,
  retryPendingMembershipFailedPayments } from "@/lib/membership-failed-payments";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";
import { POST as retryJob } from "@/app/api/internal/membership-reminders/route";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-failed-invoice-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;

async function fixture() {
  const f = await createRefundFixture(prisma, `failure-${++sequence}`, addUtcDays(new Date(), -365));
  const subscriptionId = `sub_${f.business.id}`;
  await prisma.businessMembership.update({ where: { id: f.membership.id },
    data: { stripeSubscriptionId: subscriptionId, stripeSubscriptionStatus: "active",
      automaticRenewal: true, recurringPaymentReady: true } });
  const invoiceId = `in_${f.business.id}`;
  const invoice = { id: invoiceId, status: "open" as string, created: Math.floor(Date.now() / 1000),
    billingReason: "subscription_cycle" as string | null, subscriptionId };
  const subscription = { id: subscriptionId, status: "past_due" as string,
    latestInvoiceId: invoiceId as string | null };
  const authority = { readInvoice: async () => invoice, readSubscription: async () => subscription };
  const messages: Array<{ idempotencyKey?: string; subject: string; text: string; to: string }> = [];
  const sendEmail = async (message: { idempotencyKey?: string; subject: string; text: string; to: string }) => {
    messages.push(message);
    return { messageId: `mail-${messages.length}`, provider: "resend" as const, success: true };
  };
  return { ...f, subscriptionId, invoiceId, invoice, subscription, authority, messages, sendEmail };
}

test("current unpaid invoice changes state and creates one invoice-level obligation across repeated events", async () => {
  const f = await fixture();
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "recorded");
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "recorded");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "past_due");
  assert.equal(await prisma.membershipFailedPaymentDelivery.count({ where: { stripeInvoiceId: f.invoiceId } }), 1);
  const delivery = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.equal(delivery.attemptCount, 0);
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId,
    { ...f.authority, sendEmail: f.sendEmail }), "accepted");
});

test("an exhausted Stripe subscription preserves its authoritative unpaid status", async () => {
  const f = await fixture();
  f.subscription.status = "unpaid";
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "recorded");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "unpaid");
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId,
    { ...f.authority, sendEmail: f.sendEmail }), "accepted");
});

test("email failure cannot undo membership state; retry succeeds with a stable invoice key", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  const keys: string[] = [];
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId, {
    ...f.authority, sendEmail: async (message) => { keys.push(message.idempotencyKey!); throw new Error("provider_offline"); },
  }), "pending");
  const pending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.equal(pending.failureMessage, "provider_offline");
  assert.equal(pending.acceptedAt, null);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "past_due");
  assert.deepEqual(await retryPendingMembershipFailedPayments({
    ...f.authority, now: new Date(pending.nextAttemptAt.getTime() + 1),
    sendEmail: async (message) => { keys.push(message.idempotencyKey!); return f.sendEmail(message); },
  }), { accepted: 1, due: 1 });
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[0], `membership-failed-invoice:${f.invoiceId}`);
  assert.equal(f.messages.length, 1);
  assert.ok((await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } })).acceptedAt);
});

test("missing recipient remains pending and later resolves to Italian", async () => {
  const f = await fixture();
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { ownerEmail: "invalid" } });
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId, { ...f.authority,
    sendEmail: async () => { throw new Error("should_not_send"); } }), "pending");
  const pending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.equal(pending.failureMessage, "membership_failed_payment_recipient_missing");
  assert.equal(pending.acceptedAt, null);
  assert.equal(pending.recipientEmail, null);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { ownerEmail: f.owner.email } });
  assert.deepEqual(await retryPendingMembershipFailedPayments({ ...f.authority,
    now: new Date(pending.nextAttemptAt.getTime() + 1), sendEmail: f.sendEmail }), { accepted: 1, due: 1 });
  assert.match(f.messages[0].subject, /Non siamo riusciti/);
  assert.equal(f.messages[0].to, f.owner.email);
});

test("activated owner's English locale controls the failure notice", async () => {
  const f = await fixture();
  await prisma.businessOwnerAccess.create({ data: { businessId: f.business.id,
    email: f.owner.email, userId: f.owner.id, activatedAt: new Date() } });
  await prisma.legalAcceptance.create({ data: { userId: f.owner.id, documentType: "BUSINESS_TERMS",
    documentVersion: "test-en", acceptanceContext: "BUSINESS_SIGNUP", locale: "en" } });
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId,
    { ...f.authority, sendEmail: f.sendEmail }), "accepted");
  assert.match(f.messages[0].subject, /couldn’t renew/);
});

test("paid invoice and recovered subscription reject delayed failure without state or email change", async () => {
  const f = await fixture();
  f.invoice.status = "paid";
  f.subscription.status = "active";
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "stale");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
  assert.equal(await prisma.membershipFailedPaymentDelivery.count({ where: { stripeInvoiceId: f.invoiceId } }), 0);
  f.invoice.status = "open";
  f.subscription.status = "past_due";
  await prisma.payment.create({ data: { businessSubmissionId: f.submission.id,
    businessId: f.business.id, userId: f.partner.id, method: "STRIPE_CHECKOUT",
    amountCents: 10000, status: "PAID", purpose: "ANNUAL_RENEWAL",
    stripeInvoiceId: f.invoiceId, paidAt: new Date() } });
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "stale");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
});

test("a later paid term for the exact business blocks an older still-open invoice", async () => {
  const f = await fixture();
  f.invoice.created -= 60;
  await prisma.payment.create({ data: { businessSubmissionId: f.submission.id,
    businessId: f.business.id, userId: f.partner.id, method: "STRIPE_CHECKOUT",
    amountCents: 10000, status: "PAID", purpose: "INITIAL_MEMBERSHIP",
    stripeInvoiceId: `in_repurchase_${f.business.id}`, paidAt: new Date() } });
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "stale");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
});

test("paid finalization cancels a pending notice; an old failed event cannot revive it", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  const result = await prisma.$transaction((db) => finalizeMembershipRenewalPayment({
    db, amountPaidCents: 10000, invoiceId: f.invoiceId, subscriptionId: f.subscriptionId,
    method: "STRIPE_CHECKOUT", paidAt: new Date(), paymentIntentId: `pi_recovered_${f.business.id}`,
  }));
  assert.ok(result?.paymentId);
  const canceled = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.ok(canceled.canceledAt);
  assert.equal(canceled.cancelReason, "membership_payment_succeeded");
  f.invoice.status = "paid";
  f.subscription.status = "active";
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "stale");
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId,
    { ...f.authority, sendEmail: f.sendEmail }), "skipped");
  assert.equal(f.messages.length, 0);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).status, "PAID");
});

test("retry revalidates a subsequently paid invoice and cancels the notice", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  await attemptMembershipFailedPaymentDelivery(f.invoiceId, { ...f.authority,
    sendEmail: async () => { throw new Error("provider_offline"); } });
  const pending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  f.invoice.status = "paid";
  f.subscription.status = "active";
  assert.deepEqual(await retryPendingMembershipFailedPayments({ ...f.authority,
    now: new Date(pending.nextAttemptAt.getTime() + 1), sendEmail: f.sendEmail }), { accepted: 0, due: 1 });
  assert.equal(f.messages.length, 0);
  const canceled = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.ok(canceled.canceledAt);
  assert.equal(canceled.acceptedAt, null);
});

test("an older failed invoice is superseded by the subscription's newer latest invoice", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  f.subscription.latestInvoiceId = "in_newer";
  assert.equal(await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority), "stale");
  assert.ok((await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } })).canceledAt);
});

test("different failed invoices for one membership keep distinct identities", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  const nextInvoice = `in_next_${f.business.id}`;
  f.invoice.id = nextInvoice;
  f.invoice.created += 30 * 24 * 60 * 60;
  f.subscription.latestInvoiceId = nextInvoice;
  assert.equal(await recordMembershipInvoiceFailure(nextInvoice, f.subscriptionId, f.authority), "recorded");
  assert.equal(await prisma.membershipFailedPaymentDelivery.count({ where: { membershipId: f.membership.id } }), 2);
});

test("ambiguous subscription or conflicting invoice ownership cannot update an arbitrary business", async () => {
  const f = await fixture();
  const other = await fixture();
  await prisma.businessMembership.update({ where: { id: other.membership.id },
    data: { stripeSubscriptionId: f.subscriptionId } });
  await assert.rejects(recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority),
    /failed_invoice_subscription_ambiguous/);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
  assert.equal(await prisma.membershipFailedPaymentDelivery.count({ where: { stripeInvoiceId: f.invoiceId } }), 0);
  await prisma.businessMembership.update({ where: { id: other.membership.id },
    data: { stripeSubscriptionId: other.subscriptionId } });
  await prisma.membershipFailedPaymentDelivery.create({ data: {
    membershipId: other.membership.id, stripeInvoiceId: f.invoiceId,
    stripeSubscriptionId: other.subscriptionId, businessName: other.business.name,
    graceEndsAt: other.membership.graceEndsAt,
  } });
  await assert.rejects(recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority),
    /failed_invoice_membership_conflict/);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "active");
});

test("overlapping workers cannot claim the same invoice during its lease", async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = attemptMembershipFailedPaymentDelivery(f.invoiceId, { ...f.authority,
    sendEmail: async (message) => { entered(); await blocked; return f.sendEmail(message); } });
  await started;
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId,
    { ...f.authority, sendEmail: f.sendEmail }), "skipped");
  release();
  assert.equal(await first, "accepted");
  assert.equal(f.messages.length, 1);
});

test("hung provider call is bounded and remains retryable", { timeout: 2000 }, async () => {
  const f = await fixture();
  await recordMembershipInvoiceFailure(f.invoiceId, f.subscriptionId, f.authority);
  let signal: AbortSignal | undefined;
  assert.equal(await attemptMembershipFailedPaymentDelivery(f.invoiceId, {
    ...f.authority, sendTimeoutMs: 25,
    sendEmail: async (message) => { signal = message.signal; return new Promise(() => {}); },
  }), "pending");
  assert.equal(signal?.aborted, true);
  const pending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
  assert.equal(pending.failureMessage, "membership_failed_payment_send_timeout");
  assert.equal(pending.acceptedAt, null);
  assert.ok(pending.nextAttemptAt > new Date());
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "past_due");
});

test("failed-payment migration is additive on a populated isolated database", async () => {
  const sql = readFileSync("prisma/migrations/20261006160000_add_membership_failed_payment_delivery/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "MembershipFailedPaymentDelivery"/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "Payment"|DELETE FROM|DROP TABLE/);
  const migrationDirectory = mkdtempSync(join(tmpdir(), "salento-failure-migration-"));
  const url = `file:${join(migrationDirectory, "existing.db")}`;
  writeFileSync(join(migrationDirectory, "existing.db"), "");
  const environment = { ...process.env, DATABASE_URL: url };
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
      { env: environment, stdio: "pipe" });
    const old = await createRefundFixture(db, "failed-migration-old");
    await db.$executeRawUnsafe('DROP TABLE "MembershipFailedPaymentDelivery"');
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute",
      "--stdin", "--schema", "prisma/schema.prisma"], { env: environment, input: sql, stdio: "pipe" });
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).status, "PAID");
    assert.equal(await db.membershipFailedPaymentDelivery.count(), 0);
    assert.deepEqual(await db.$queryRawUnsafe("PRAGMA foreign_key_check"), []);
  } finally {
    await db.$disconnect();
    rmSync(migrationDirectory, { recursive: true, force: true });
  }
});

test("failed-invoice webhook acknowledges a durable obligation despite missing email; delayed paid event is ignored", async () => {
  const f = await fixture();
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { ownerEmail: "invalid" } });
  const secret = "whsec_local_failed_invoice_test";
  const oldSecret = process.env.STRIPE_SECRET_KEY;
  const oldPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
  const oldWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  const oldMail = { resendKey: process.env.RESEND_API_KEY, resendFrom: process.env.RESEND_FROM,
    host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, from: process.env.SMTP_FROM };
  process.env.STRIPE_SECRET_KEY = "sk_test_local_failed_invoice_test";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_local_failed_invoice_test";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const stripe = getStripe();
  const oldInvoiceRead = stripe.invoices.retrieve;
  const oldSubscriptionRead = stripe.subscriptions.retrieve;
  (stripe.invoices as unknown as { retrieve: (id: string) => Promise<unknown> }).retrieve =
    async () => ({ ...f.invoice, billing_reason: f.invoice.billingReason,
      parent: { subscription_details: { subscription: f.subscriptionId } } });
  (stripe.subscriptions as unknown as { retrieve: (id: string) => Promise<unknown> }).retrieve =
    async () => ({ ...f.subscription, latest_invoice: f.subscription.latestInvoiceId });
  const event = { id: `evt_failed_${f.business.id}`, type: "invoice.payment_failed", livemode: false,
    data: { object: { id: f.invoiceId,
      parent: { subscription_details: { subscription: f.subscriptionId } } } } };
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const request = () => new Request("http://localhost/api/stripe/webhook", { method: "POST",
    headers: { "stripe-signature": signature }, body: payload });
  try {
    assert.equal((await stripeWebhook(request())).status, 200);
    assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status, "PROCESSED");
    const pending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({ where: { stripeInvoiceId: f.invoiceId } });
    assert.equal(pending.failureMessage, "membership_failed_payment_recipient_missing");
    assert.equal(pending.acceptedAt, null);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).stripeSubscriptionStatus, "past_due");
    f.invoice.status = "paid";
    f.subscription.status = "active";
    assert.equal((await stripeWebhook(request())).status, 200);
    assert.equal(await prisma.membershipFailedPaymentDelivery.count({ where: { stripeInvoiceId: f.invoiceId } }), 1);

    // A different current invoice with a valid recipient must still be
    // acknowledged if the email provider is unavailable after the commit.
    await prisma.businessSubmission.update({ where: { id: f.submission.id },
      data: { ownerEmail: f.owner.email } });
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";
    process.env.SMTP_FROM = "test@example.test";
    f.invoice.id = `in_provider_failure_${f.business.id}`;
    f.invoice.status = "open";
    f.subscription.status = "past_due";
    f.subscription.latestInvoiceId = f.invoice.id;
    const event2 = { ...event, id: `evt_provider_failure_${f.business.id}`,
      data: { object: { ...event.data.object, id: f.invoice.id } } };
    const payload2 = JSON.stringify(event2);
    const signature2 = Stripe.webhooks.generateTestHeaderString({ payload: payload2, secret });
    const response2 = await stripeWebhook(new Request("http://localhost/api/stripe/webhook",
      { method: "POST", headers: { "stripe-signature": signature2 }, body: payload2 }));
    assert.equal(response2.status, 200);
    const providerPending = await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({
      where: { stripeInvoiceId: f.invoice.id },
    });
    assert.equal(providerPending.acceptedAt, null);
    assert.ok(providerPending.failureMessage);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({
      where: { id: f.membership.id },
    })).stripeSubscriptionStatus, "past_due");
  } finally {
    (stripe.invoices as unknown as { retrieve: typeof oldInvoiceRead }).retrieve = oldInvoiceRead;
    (stripe.subscriptions as unknown as { retrieve: typeof oldSubscriptionRead }).retrieve = oldSubscriptionRead;
    if (oldSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = oldSecret;
    if (oldPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY; else process.env.STRIPE_PUBLISHABLE_KEY = oldPublishable;
    if (oldWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldWebhook;
    for (const [key, value] of Object.entries({ RESEND_API_KEY: oldMail.resendKey,
      RESEND_FROM: oldMail.resendFrom, SMTP_HOST: oldMail.host, SMTP_PORT: oldMail.port,
      SMTP_FROM: oldMail.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("outcomes-only endpoint runs transactional queues and skips daily reminders", async () => {
  const f = await fixture();
  await prisma.businessMembership.update({ where: { id: f.membership.id },
    data: { currentPeriodEnd: addUtcDays(new Date(), 30), graceEndsAt: addUtcDays(new Date(), 44) } });
  const secret = "local_reminder_cron_test";
  const prior = process.env.MEMBERSHIP_REMINDER_CRON_SECRET;
  process.env.MEMBERSHIP_REMINDER_CRON_SECRET = secret;
  // Keep this route test entirely local: only its queue dispatch is under test.
  await prisma.membershipPaymentOutcomeDelivery.updateMany({
    data: { nextAttemptAt: addUtcDays(new Date(), 1) },
  });
  await prisma.membershipFailedPaymentDelivery.updateMany({
    data: { nextAttemptAt: addUtcDays(new Date(), 1) },
  });
  const paid = await fixture();
  await prisma.businessSubmission.update({ where: { id: paid.submission.id }, data: { ownerEmail: "invalid" } });
  await prisma.membershipPaymentOutcomeDelivery.create({ data: {
    paymentId: paid.payment.id, membershipId: paid.membership.id,
    periodEnd: paid.membership.currentPeriodEnd, businessName: paid.business.name,
  } });
  const failed = await fixture();
  await prisma.businessSubmission.update({ where: { id: failed.submission.id }, data: { ownerEmail: "invalid" } });
  await recordMembershipInvoiceFailure(failed.invoiceId, failed.subscriptionId, failed.authority);
  const stripe = getStripe();
  const oldInvoiceRead = stripe.invoices.retrieve;
  const oldSubscriptionRead = stripe.subscriptions.retrieve;
  (stripe.invoices as unknown as { retrieve: (id: string) => Promise<unknown> }).retrieve =
    async () => ({ ...failed.invoice, billing_reason: failed.invoice.billingReason,
      parent: { subscription_details: { subscription: failed.subscriptionId } } });
  (stripe.subscriptions as unknown as { retrieve: (id: string) => Promise<unknown> }).retrieve =
    async () => ({ ...failed.subscription, latest_invoice: failed.subscription.latestInvoiceId });
  try {
    const response = await retryJob(new Request("http://localhost/api/internal/membership-reminders?outcomes=only",
      { method: "POST", headers: { authorization: `Bearer ${secret}` } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.outcomes, { accepted: 0, due: 1 });
    assert.deepEqual(body.failedPayments, { accepted: 0, due: 1 });
    assert.equal((await prisma.membershipPaymentOutcomeDelivery.findUniqueOrThrow({
      where: { paymentId: paid.payment.id },
    })).attemptCount, 1);
    assert.equal((await prisma.membershipFailedPaymentDelivery.findUniqueOrThrow({
      where: { stripeInvoiceId: failed.invoiceId },
    })).attemptCount, 1);
    assert.equal(await prisma.membershipReminder.count({ where: { membershipId: f.membership.id } }), 0);
  } finally {
    (stripe.invoices as unknown as { retrieve: typeof oldInvoiceRead }).retrieve = oldInvoiceRead;
    (stripe.subscriptions as unknown as { retrieve: typeof oldSubscriptionRead }).retrieve = oldSubscriptionRead;
    if (prior === undefined) delete process.env.MEMBERSHIP_REMINDER_CRON_SECRET;
    else process.env.MEMBERSHIP_REMINDER_CRON_SECRET = prior;
  }
});
