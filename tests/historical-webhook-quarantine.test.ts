import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import Stripe from "stripe";

import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { createRefundFixture } from "./helpers/refund-fixture";

const historical = [
  ["evt_1UJJ2NRTjKpCuoPHll3hmDPu", "checkout.session.completed", "cs_test_a1An0qB6hmzz7zkaBhOX5rTzSJAV4kmpPKVPIESKchJWUlLfbHnvSQLEZt"],
  ["evt_1UJeG3RTjKpCuoPHMmbWMeXM", "invoice.paid", "in_1UJeFdRTjKpCuoPHKzFxc8U6"],
  ["evt_3UKsxwRTjKpCuoPH1Wp54OFK", "payment_intent.succeeded", "pi_3UKsxwRTjKpCuoPH1CnAeHWq"],
  ["evt_3UKsxyRTjKpCuoPH0RudFuRx", "payment_intent.succeeded", "pi_3UKsxyRTjKpCuoPH0zR9J9tf"],
  ["evt_3UKsz7RTjKpCuoPH0ylnYHhf", "payment_intent.succeeded", "pi_3UKsz7RTjKpCuoPH0RqS5bOj"],
  ["evt_3UKzJ5RTjKpCuoPH0Rzu653v", "payment_intent.succeeded", "pi_3UKzJ5RTjKpCuoPH0dmjcGHb"],
  ["evt_3UKzJ5RTjKpCuoPH1cm5MNnv", "payment_intent.succeeded", "pi_3UKzJ5RTjKpCuoPH1Er8N8iq"],
  ["evt_3UKzJ6RTjKpCuoPH0ms8QExK", "payment_intent.succeeded", "pi_3UKzJ6RTjKpCuoPH0mG1ZoSz"],
  ["evt_1UKzRWRTjKpCuoPHHr4Czf6j", "invoice.paid", "in_1UKzJ7RTjKpCuoPHtoSciXwk"],
] as const;

const directory = mkdtempSync(join(tmpdir(), "salento-historical-webhook-"));
writeFileSync(join(directory, "isolated.db"), "");
const previous = Object.fromEntries(["DATABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET", "RAILWAY_ENVIRONMENT_NAME", "RESEND_API_KEY", "SMTP_HOST"]
  .map((key) => [key, process.env[key]]));
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.STRIPE_SECRET_KEY = "sk_test_local_historical";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_local_historical";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_historical";
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" });

const stripe = getStripe();
const originalAccountRetrieve = stripe.accounts.retrieve;
let accountId = "acct_1TqwSuRTjKpCuoPH";
let accountUnavailable = false;
let accountReads = 0;
(stripe.accounts as unknown as { retrieve: typeof originalAccountRetrieve }).retrieve = async () => {
  accountReads++;
  if (accountUnavailable) throw new Error("synthetic_account_unavailable");
  return { id: accountId } as never;
};

after(async () => {
  (stripe.accounts as unknown as { retrieve: typeof originalAccountRetrieve }).retrieve = originalAccountRetrieve;
  await prisma.$disconnect();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

function event([id, type, objectId]: (typeof historical)[number], overrides: Record<string, unknown> = {}) {
  return { id, type, livemode: false, data: { object: { id: objectId } }, ...overrides };
}

function request(payload: object, validSignature = true) {
  const body = JSON.stringify(payload);
  const signature = validSignature
    ? Stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET! })
    : "t=1,v1=invalid";
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body,
  });
}

async function financialSnapshot() {
  return {
    businesses: await prisma.business.findMany({ orderBy: { id: "asc" } }),
    submissions: await prisma.businessSubmission.findMany({ orderBy: { id: "asc" } }),
    memberships: await prisma.businessMembership.findMany({ orderBy: { id: "asc" } }),
    payments: await prisma.payment.findMany({ orderBy: { id: "asc" } }),
    commissions: await prisma.partnerCommission.findMany({ orderBy: { id: "asc" } }),
    payouts: await prisma.partnerPayout.findMany({ orderBy: { id: "asc" } }),
    ownerAccesses: await prisma.businessOwnerAccess.findMany({ orderBy: { id: "asc" } }),
    purchaseDeliveries: await prisma.purchaseConfirmationDelivery.findMany({ orderBy: { id: "asc" } }),
    outcomeDeliveries: await prisma.membershipPaymentOutcomeDelivery.findMany({ orderBy: { id: "asc" } }),
    failedPaymentDeliveries: await prisma.membershipFailedPaymentDelivery.findMany({ orderBy: { id: "asc" } }),
    commissionDeliveries: await prisma.partnerCommissionConfirmationDelivery.findMany({ orderBy: { id: "asc" } }),
  };
}

test("all nine reconciled historical events acknowledge twice without financial, notification, or log mutation", async (t) => {
  const checkout = await createRefundFixture(prisma, "historical-checkout");
  const invoice = await createRefundFixture(prisma, "historical-invoice");
  await prisma.payment.update({ where: { id: checkout.payment.id }, data: {
    stripeCheckoutSessionId: historical[0][2], stripeLivemode: false,
  } });
  await prisma.payment.update({ where: { id: invoice.payment.id }, data: {
    stripeInvoiceId: historical[1][2], stripeLivemode: false,
  } });
  for (const [id, type, objectId] of historical) {
    await prisma.stripeWebhookEvent.create({ data: {
      stripeEventId: id, endpointType: "PLATFORM", eventType: type, stripeObjectId: objectId,
      livemode: false, status: "FAILED", errorMessage: "historical_failure",
      createdAt: new Date("2026-09-29T12:00:00.000Z"),
    } });
  }
  const before = await financialSnapshot();
  const readsBefore = accountReads;
  for (const item of historical) {
    await t.test(item[0], async () => {
      const rowBefore = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: item[0] } });
      for (let delivery = 0; delivery < 2; delivery++) {
        const response = await webhook(request(event(item)));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { received: true, historicalDisposition: "RECONCILED_NO_REPLAY" });
      }
      assert.deepEqual(await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: item[0] } }), rowBefore);
      assert.deepEqual(await financialSnapshot(), before);
    });
  }
  assert.equal(accountReads - readsBefore, 18);
});

test("wrong account, live mode, invalid signature, and conflicting identity cannot suppress or mutate a historical row", async () => {
  const item = historical[0];
  const before = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: item[0] } });
  const finances = await financialSnapshot();
  accountId = "acct_other_test_account";
  assert.equal((await webhook(request(event(item)))).status, 409);
  accountId = "acct_1TqwSuRTjKpCuoPH";
  assert.equal((await webhook(request(event(item, { account: "acct_other_test_account" })))).status, 409);
  assert.equal((await webhook(request(event(item, { livemode: true })))).status, 400);
  assert.equal((await webhook(request(event(item), false))).status, 400);
  assert.equal((await webhook(request(event(item, { type: "invoice.paid" })))).status, 409);
  assert.equal((await webhook(request(event(item, { data: { object: { id: "cs_wrong_object" } } })))).status, 409);
  accountUnavailable = true;
  assert.equal((await webhook(request(event(item)))).status, 503);
  accountUnavailable = false;
  assert.deepEqual(await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: item[0] } }), before);
  assert.deepEqual(await financialSnapshot(), finances);
});

test("completed and skipped logs remain final, while a historical processing claim requires review", async () => {
  const item = historical[0];
  const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: item[0] } });
  const finances = await financialSnapshot();
  const readsBefore = accountReads;
  for (const status of ["PROCESSED", "SKIPPED"] as const) {
    await prisma.stripeWebhookEvent.update({ where: { id: row.id }, data: { status } });
    const response = await webhook(request(event(item)));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true, duplicate: true });
  }
  assert.equal(accountReads, readsBefore);
  await prisma.stripeWebhookEvent.update({ where: { id: row.id }, data: { status: "PROCESSING",
    updatedAt: new Date("2026-09-29T12:00:00.000Z") } });
  const processing = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal((await webhook(request(event(item)))).status, 503);
  assert.deepEqual(await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: row.id } }), processing);
  await prisma.stripeWebhookEvent.update({ where: { id: row.id }, data: { status: "FAILED" } });
  assert.deepEqual(await financialSnapshot(), finances);
});

test("a later refunded or disputed historical Payment cannot be reopened by its old event", async () => {
  const checkoutPayment = await prisma.payment.findUniqueOrThrow({ where: { id: "payment-historical-checkout" } });
  const invoicePayment = await prisma.payment.findUniqueOrThrow({ where: { id: "payment-historical-invoice" } });
  const checkoutCommission = await prisma.partnerCommission.findFirstOrThrow({ where: { paymentId: checkoutPayment.id } });
  const invoiceCommission = await prisma.partnerCommission.findFirstOrThrow({ where: { paymentId: invoicePayment.id } });
  const now = new Date();
  await prisma.payment.update({ where: { id: checkoutPayment.id }, data: {
    status: "REFUNDED", refundedAt: now, refundStatus: "succeeded",
  } });
  await prisma.partnerCommission.update({ where: { id: checkoutCommission.id }, data: {
    status: "REVERSED", reversedAt: now, reversalReason: "payment_refunded",
  } });
  await prisma.payment.update({ where: { id: invoicePayment.id }, data: {
    status: "REFUNDED", refundedAt: now, refundStatus: "dispute_lost",
  } });
  await prisma.partnerCommission.update({ where: { id: invoiceCommission.id }, data: {
    status: "REVERSED", reversedAt: now, reversalReason: "payment_dispute_lost",
  } });
  const before = await financialSnapshot();
  for (const item of historical.slice(0, 2)) {
    const response = await webhook(request(event(item)));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).historicalDisposition, "RECONCILED_NO_REPLAY");
  }
  assert.deepEqual(await financialSnapshot(), before);
});

test("unknown event IDs and new FAILED rows still use the ordinary retry path", async () => {
  const id = "evt_3UNLISTED_historical_looking";
  const payload = { id, type: "unhandled.synthetic", livemode: false, data: { object: { id: "synthetic_object" } } };
  const readsBefore = accountReads;
  const first = await webhook(request(payload));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true });
  const row = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: id } });
  assert.equal(row.status, "SKIPPED");
  await prisma.stripeWebhookEvent.update({ where: { id: row.id }, data: { status: "FAILED" } });
  const second = await webhook(request(payload));
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { received: true });
  const retried = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(retried.status, "SKIPPED");
  assert.equal(retried.attemptCount, 2);
  assert.equal(accountReads, readsBefore);
});
