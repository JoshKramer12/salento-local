import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import Stripe from "stripe";

import { addUtcDays } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { beginStripeWebhookProcessing, completeStripeWebhookProcessing } from "@/lib/stripe-webhook-log";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect-webhook/route";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-webhook-reliability-"));
writeFileSync(join(directory, "isolated.db"), "");
const oldEnvironment = Object.fromEntries(["DATABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET", "RAILWAY_ENVIRONMENT_NAME", "RESEND_API_KEY", "SMTP_HOST"].map((key) => [key, process.env[key]]));
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.STRIPE_SECRET_KEY = "sk_test_local_reliability";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_local_reliability";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_local_reliability";
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_local_connect_reliability";
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" });
after(async () => {
  await prisma.$disconnect();
  for (const [key, value] of Object.entries(oldEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});
let sequence = 0;
async function fixture() { return createRefundFixture(prisma, `reliability-${++sequence}`); }

function request(event: object) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return new Request("http://localhost/api/stripe/webhook", { method: "POST",
    headers: { "stripe-signature": signature }, body: payload });
}

function connectRequest(event: object) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET! });
  return new Request("http://localhost/api/stripe/connect-webhook", { method: "POST",
    headers: { "stripe-signature": signature }, body: payload });
}

function checkoutEvent(f: Awaited<ReturnType<typeof fixture>>) {
  return { id: `evt_checkout_${f.business.id}`, type: "checkout.session.completed", livemode: false,
    data: { object: { id: `cs_${f.business.id}`, amount_total: 10000, currency: "eur", payment_status: "paid",
      metadata: { paymentFlow: "MEMBERSHIP_RENEWAL", businessId: f.business.id,
        businessSubmissionId: f.submission.id, userId: f.owner.id, automaticRenewal: "false" },
      payment_intent: `pi_checkout_${f.business.id}`, customer: null, subscription: null } } };
}

async function pendingCheckout(f: Awaited<ReturnType<typeof fixture>>) {
  return prisma.payment.create({ data: { businessId: f.business.id, businessSubmissionId: f.submission.id,
    userId: f.owner.id, method: "STRIPE_CHECKOUT", amountCents: 10000, status: "PENDING_PAYMENT",
    purpose: "ANNUAL_RENEWAL", stripeCheckoutSessionId: `cs_${f.business.id}` } });
}

function bankEvent(f: Awaited<ReturnType<typeof fixture>>) {
  return { id: `evt_bank_${f.business.id}`, type: "payment_intent.succeeded", livemode: false,
    data: { object: { id: `pi_bank_${f.business.id}`, status: "succeeded", amount: 10000,
      amount_received: 10000, currency: "eur", payment_method_types: ["customer_balance"],
      metadata: { paymentFlow: "MEMBERSHIP_RENEWAL_BANK_TRANSFER", businessId: f.business.id,
        businessSubmissionId: f.submission.id, userId: f.owner.id } } } };
}

async function pendingBank(f: Awaited<ReturnType<typeof fixture>>) {
  return prisma.payment.create({ data: { businessId: f.business.id, businessSubmissionId: f.submission.id,
    userId: f.owner.id, method: "BANK_TRANSFER", amountCents: 10000, status: "AWAITING_BANK_TRANSFER",
    purpose: "ANNUAL_RENEWAL", stripePaymentIntentId: `pi_bank_${f.business.id}` } });
}

function invoiceEvent(f: Awaited<ReturnType<typeof fixture>>) {
  return { id: `evt_invoice_${f.business.id}`, type: "invoice.paid", livemode: false,
    data: { object: { id: `in_${f.business.id}`, billing_reason: "subscription_cycle", status: "paid",
      amount_paid: 10000, currency: "eur", customer: `cus_${f.business.id}`,
      parent: { subscription_details: { subscription: `sub_${f.business.id}` } },
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) } } } };
}

function mockInvoiceReads(f: Awaited<ReturnType<typeof fixture>>, options: { fail?: boolean; wait?: Promise<void> } = {}) {
  const stripe = getStripe();
  const originalInvoice = stripe.invoices.retrieve;
  const originalIntent = stripe.paymentIntents.retrieve;
  (stripe.invoices as unknown as { retrieve: typeof originalInvoice }).retrieve = async () => {
    await options.wait;
    if (options.fail) throw new Error("synthetic_provider_unavailable");
    return { ...invoiceEvent(f).data.object, payments: { has_more: false, data: [{
      status: "paid", amount_paid: 10000, payment: { type: "payment_intent", payment_intent: `pi_invoice_${f.business.id}` },
    }] } } as never;
  };
  (stripe.paymentIntents as unknown as { retrieve: typeof originalIntent }).retrieve = async () => ({
    id: `pi_invoice_${f.business.id}`, status: "succeeded", amount_received: 10000,
    currency: "eur", customer: `cus_${f.business.id}`,
  }) as never;
  return () => {
    (stripe.invoices as unknown as { retrieve: typeof originalInvoice }).retrieve = originalInvoice;
    (stripe.paymentIntents as unknown as { retrieve: typeof originalIntent }).retrieve = originalIntent;
  };
}

async function prepareInvoice(f: Awaited<ReturnType<typeof fixture>>) {
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: {
    stripeSubscriptionId: `sub_${f.business.id}`, stripeCustomerId: `cus_${f.business.id}`,
    automaticRenewal: true, recurringPaymentReady: true,
  } });
}

async function assertFailure(eventId: string, code: string) {
  const log = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: eventId } });
  assert.equal(log.status, "FAILED");
  assert.equal(log.errorMessage, code);
  assert.equal(log.attemptCount, 1);
}

async function pendingInitialSubmission(method: "ONLINE" | "BANK_TRANSFER") {
  const f = await fixture();
  const submission = await prisma.businessSubmission.create({ data: {
    id: `submission_initial_${method}_${f.business.id}`, userId: f.partner.id,
    status: "AWAITING_PAYMENT", paymentStatus: "PENDING_PAYMENT", paymentMethod: method,
    businessName: `Synthetic ${method} listing ${f.business.id}`, townId: f.town.id,
    categoryId: f.category.id, address: "Via Test 2, Lecce", googleMapsUrl: "https://maps.example.test",
    phone: "+393200000001", whatsapp: "+393200000001", email: "business@example.test",
    openingHours: "9-18", shortDescription: "Synthetic listing", longDescription: "Synthetic listing details",
    ownerName: "Synthetic Owner", ownerPhone: "+393200000002", ownerEmail: `owner-${f.business.id}@example.test`,
    agreementSignature: "data:image/png;base64,synthetic", signedAt: new Date(),
    businessTermsAcceptedAt: new Date(), businessTermsVersion: "business-terms-2026-08-14",
    privacyPolicyVersionPresented: "privacy-policy-2026-07-14",
    firstYearPriceCentsAtAcceptance: 10000, renewalPriceCentsAtAcceptance: 10000,
    listingTermMonthsAtAcceptance: 12, automaticRenewalAtAcceptance: false,
  } });
  return { f, submission };
}

test("initial Checkout cannot acknowledge a missing submission as a paid publication", async () => {
  const membershipsBefore = await prisma.businessMembership.count();
  const event = { id: `evt_initial_missing_${++sequence}`, type: "checkout.session.completed", livemode: false,
    data: { object: { id: `cs_initial_missing_${sequence}`, amount_total: 10000,
      currency: "eur", payment_status: "paid", payment_intent: `pi_initial_missing_${sequence}`,
      subscription: null, metadata: { businessSubmissionId: "synthetic_missing_submission",
        userId: "synthetic_missing_user", paymentFlow: "CHECKOUT" } } } };
  const response = await webhook(request(event));
  assert.equal(response.status, 503);
  await assertFailure(event.id, "initial_payment_submission_unavailable");
  assert.equal(await prisma.payment.count({ where: { stripeCheckoutSessionId: event.data.object.id } }), 0);
  assert.equal(await prisma.businessMembership.count(), membershipsBefore);
});

test("initial Checkout rejects unpaid or incorrect-price events before changing financial records", async () => {
  const f = await fixture();
  const beforePayments = await prisma.payment.count({ where: { businessSubmissionId: f.submission.id } });
  const beforeEnd = (await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd;
  for (const [label, paymentStatus, amount] of [["unpaid", "unpaid", 10000], ["wrong_amount", "paid", 5000]] as const) {
    const event = { id: `evt_initial_${label}_${f.business.id}`, type: "checkout.session.completed", livemode: false,
      data: { object: { id: `cs_initial_${label}_${f.business.id}`, amount_total: amount,
        currency: "eur", payment_status: paymentStatus, payment_intent: `pi_initial_${label}_${f.business.id}`,
        subscription: null, metadata: { businessSubmissionId: f.submission.id,
          userId: f.partner.id, paymentFlow: "CHECKOUT" } } } };
    assert.equal((await webhook(request(event))).status, 503);
    await assertFailure(event.id, "initial_checkout_payment_unverified");
  }
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: f.submission.id } }), beforePayments);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), beforeEnd.toISOString());
});

test("initial Checkout cannot attach another submission's pending Payment", async () => {
  const unrelated = await fixture();
  const { f, submission } = await pendingInitialSubmission("ONLINE");
  const sessionId = `cs_initial_cross_submission_${f.business.id}`;
  const otherPayment = await prisma.payment.create({ data: { businessSubmissionId: unrelated.submission.id,
    userId: unrelated.partner.id, method: "STRIPE_CHECKOUT", amountCents: 10000,
    purpose: "INITIAL_MEMBERSHIP", status: "PENDING_PAYMENT", stripeCheckoutSessionId: sessionId } });
  const event = { id: `evt_initial_cross_submission_${f.business.id}`, type: "checkout.session.completed", livemode: false,
    data: { object: { id: sessionId, amount_total: 10000, currency: "eur", payment_status: "paid",
      payment_intent: `pi_initial_cross_submission_${f.business.id}`, subscription: null,
      metadata: { businessSubmissionId: submission.id, userId: f.partner.id, paymentFlow: "CHECKOUT" } } } };
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "initial_payment_association_conflict");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: otherPayment.id } })).status, "PENDING_PAYMENT");
  assert.equal((await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "AWAITING_PAYMENT");
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
});

test("initial bank-transfer webhook rejects unverified settlement and missing exact Payment", async () => {
  const f = await fixture();
  const beforePayments = await prisma.payment.count({ where: { businessSubmissionId: f.submission.id } });
  const event = { id: `evt_initial_bank_${f.business.id}`, type: "payment_intent.succeeded", livemode: false,
    data: { object: { id: `pi_initial_bank_${f.business.id}`, status: "succeeded",
      amount: 10000, amount_received: 10000, currency: "eur", payment_method_types: ["customer_balance"],
      metadata: { paymentFlow: "BANK_TRANSFER", businessSubmissionId: f.submission.id,
        userId: f.partner.id } } } };
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "initial_bank_transfer_payment_association_missing");
  event.data.object.status = "processing";
  event.id = `evt_initial_bank_unpaid_${f.business.id}`;
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "initial_bank_transfer_payment_unverified");
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: f.submission.id } }), beforePayments);
});

test("initial bank-transfer settlement publishes once with one membership and €50 Partner commission", async () => {
  const { f, submission } = await pendingInitialSubmission("BANK_TRANSFER");
  const intentId = `pi_initial_bank_valid_${f.business.id}`;
  await prisma.payment.create({ data: { businessSubmissionId: submission.id, userId: f.partner.id,
    partnerUserId: f.partner.id, method: "BANK_TRANSFER", amountCents: 10000,
    purpose: "INITIAL_MEMBERSHIP", status: "AWAITING_BANK_TRANSFER", stripePaymentIntentId: intentId } });
  const event = { id: `evt_initial_bank_valid_${f.business.id}`, type: "payment_intent.succeeded", livemode: false,
    data: { object: { id: intentId, status: "succeeded", amount: 10000, amount_received: 10000,
      currency: "eur", payment_method_types: ["customer_balance"],
      metadata: { paymentFlow: "BANK_TRANSFER", businessSubmissionId: submission.id,
        userId: f.partner.id } } } };
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal((await prisma.payment.findFirstOrThrow({ where: { stripePaymentIntentId: intentId } })).status, "PAID");
  assert.equal(await prisma.businessMembership.count({ where: { business: { submissions: { some: { id: submission.id } } } } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id, amountCents: 5000 } }), 1);
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal(await prisma.payment.count({ where: { stripePaymentIntentId: intentId } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id, amountCents: 5000 } }), 1);
});

test("initial €100 Checkout publishes, grants owner access, starts 365 plus 14 days, and survives duplicate delivery", async () => {
  const { f, submission } = await pendingInitialSubmission("ONLINE");
  const sessionId = `cs_initial_valid_${f.business.id}`;
  await prisma.payment.create({ data: { businessSubmissionId: submission.id, userId: f.partner.id,
    partnerUserId: f.partner.id, method: "STRIPE_CHECKOUT", amountCents: 10000,
    purpose: "INITIAL_MEMBERSHIP", status: "PENDING_PAYMENT", stripeCheckoutSessionId: sessionId } });
  const event = { id: `evt_initial_valid_${f.business.id}`, type: "checkout.session.completed", livemode: false,
    data: { object: { id: sessionId, amount_total: 10000, currency: "eur", payment_status: "paid",
      payment_intent: `pi_initial_valid_${f.business.id}`, subscription: null,
      metadata: { paymentFlow: "CHECKOUT", businessSubmissionId: submission.id, userId: f.partner.id } } } };
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal((await webhook(request(event))).status, 200);
  const paid = await prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: sessionId } });
  const published = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(paid.amountCents, 10000);
  assert.equal(paid.purpose, "INITIAL_MEMBERSHIP");
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.paymentStatus, "PAID");
  assert.equal(paid.businessId, published.createdBusinessId);
  assert.equal(await prisma.payment.count({ where: { stripeCheckoutSessionId: sessionId } }), 1);
  assert.equal(await prisma.business.count({ where: { submissions: { some: { id: submission.id } } } }), 1);
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { businessId: paid.businessId! } });
  assert.equal(membership.currentPeriodEnd.getTime() - membership.currentPeriodStart.getTime(), 365 * 86_400_000);
  assert.equal(membership.graceEndsAt.getTime() - membership.currentPeriodEnd.getTime(), 14 * 86_400_000);
  assert.equal(membership.originatingPartnerUserId, f.partner.id);
  assert.equal(await prisma.businessOwnerAccess.count({ where: { sourceSubmissionId: submission.id } }), 1);
  const commission = await prisma.partnerCommission.findUniqueOrThrow({ where: { sourceKey: `commission:submission:${submission.id}` } });
  assert.equal(commission.paymentId, paid.id);
  assert.equal(commission.amountCents, 5000);
  assert.equal(commission.eligibleAt!.getTime() - paid.paidAt!.getTime(), 14 * 86_400_000);
  assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status, "PROCESSED");
  const delivery = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { businessSubmissionId: submission.id } });
  assert.equal(delivery.attemptCount, 1);
  assert.ok(delivery.failureMessage);
  assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
});

test("checkout renewal and retry after a lost acknowledgement extend once and preserve one Partner commission", async () => {
  const f = await fixture();
  await pendingCheckout(f);
  const event = checkoutEvent(f);
  assert.equal((await webhook(request(event))).status, 200);
  const paid = await prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: event.data.object.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(paid.businessSubmissionId, f.submission.id);
  const end = (await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd;
  assert.equal(end.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: paid.id, amountCents: 1500 } }), 1);
  // Model a process termination after financial commit and before acknowledgement.
  await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id }, data: { status: "FAILED" } });
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal(await prisma.payment.count({ where: { stripeCheckoutSessionId: event.data.object.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: paid.id, amountCents: 1500 } }), 1);
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), end.toISOString());
  assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).attemptCount, 2);
});

test("checkout missing membership fails visibly, then a repaired association permits exact retry", async () => {
  const f = await fixture();
  await pendingCheckout(f);
  await prisma.businessMembership.delete({ where: { id: f.membership.id } });
  const event = checkoutEvent(f);
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "renewal_membership_association_missing");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: event.data.object.id } })).status, "PENDING_PAYMENT");
  await prisma.businessMembership.create({ data: { id: f.membership.id, businessId: f.business.id,
    annualPriceCents: 10000, currentPeriodStart: f.membership.currentPeriodStart,
    currentPeriodEnd: f.membership.currentPeriodEnd, graceEndsAt: f.membership.graceEndsAt,
    originatingPartnerUserId: f.partner.id } });
  assert.equal((await webhook(request(event))).status, 200);
  const log = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
  assert.equal(log.status, "PROCESSED"); assert.equal(log.attemptCount, 2);
});

test("checkout renewal without its exact local Payment remains retryable", async () => {
  const f = await fixture();
  const event = checkoutEvent(f);
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "renewal_checkout_payment_association_missing");
  assert.equal(await prisma.partnerCommission.count({ where: { businessId: f.business.id, amountCents: 1500 } }), 0);
  await pendingCheckout(f);
  assert.equal((await webhook(request(event))).status, 200);
});

test("expired membership reactivates from payment time with one €15 original-Partner commission", async () => {
  const f = await fixture();
  const expiredEnd = addUtcDays(new Date(), -20);
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: {
    currentPeriodEnd: expiredEnd, graceEndsAt: addUtcDays(expiredEnd, 14),
  } });
  await pendingCheckout(f);
  const event = checkoutEvent(f);
  assert.equal((await webhook(request(event))).status, 200);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: event.data.object.id } });
  assert.equal(payment.purpose, "REACTIVATION");
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } });
  assert.ok(membership.currentPeriodStart > expiredEnd);
  assert.equal(membership.currentPeriodEnd.toISOString(), addUtcDays(membership.currentPeriodStart, 365).toISOString());
  const commission = await prisma.partnerCommission.findFirstOrThrow({ where: { paymentId: payment.id, amountCents: 1500 } });
  assert.equal(commission.partnerUserId, f.partner.id);
  assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
});

test("bank renewal requires a succeeded exact local payment and never acknowledges a missing association", async () => {
  const f = await fixture();
  const event = bankEvent(f);
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "renewal_bank_transfer_payment_association_missing");
  await pendingBank(f);
  assert.equal((await webhook(request(event))).status, 200);
  const paid = await prisma.payment.findFirstOrThrow({ where: { stripePaymentIntentId: event.data.object.id } });
  assert.equal(paid.status, "PAID");
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: paid.id, amountCents: 1500 } }), 1);
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal(await prisma.payment.count({ where: { stripePaymentIntentId: event.data.object.id } }), 1);
});

test("bank renewal with a missing membership or an unpaid intent returns 503 without financial effects", async () => {
  const f = await fixture();
  await pendingBank(f);
  await prisma.businessMembership.delete({ where: { id: f.membership.id } });
  const event = bankEvent(f);
  assert.equal((await webhook(request(event))).status, 503);
  await assertFailure(event.id, "renewal_membership_association_missing");
  assert.equal(await prisma.partnerCommission.count({ where: { amountCents: 1500, businessId: f.business.id } }), 0);
  const another = await fixture();
  await pendingBank(another);
  const unpaid = bankEvent(another);
  unpaid.data.object.status = "processing";
  assert.equal((await webhook(request(unpaid))).status, 503);
  await assertFailure(unpaid.id, "renewal_bank_transfer_payment_unverified");
});

test("recurring invoice finalizes once; an earlier subscription PaymentIntent event does not extend a term", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  const restore = mockInvoiceReads(f);
  try {
    const intentEvent = { id: `evt_intent_${f.business.id}`, type: "payment_intent.succeeded", livemode: false,
      data: { object: { id: `pi_invoice_${f.business.id}`, metadata: { paymentFlow: "MEMBERSHIP_SUBSCRIPTION_ELEMENT" } } } };
    assert.equal((await webhook(request(intentEvent))).status, 200);
    assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: intentEvent.id } })).status, "SKIPPED");
    const event = invoiceEvent(f);
    assert.equal((await webhook(request(event))).status, 200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { stripeInvoiceId: event.data.object.id } });
    assert.equal(payment.status, "PAID");
    assert.equal(payment.businessId, f.business.id);
    assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 1);
    assert.equal((await webhook(request(event))).status, 200);
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 1);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
  } finally { restore(); }
});

test("recurring invoice null finalizer is FAILED and retryable, never PROCESSED", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  await prisma.businessSubmission.delete({ where: { id: f.submission.id } });
  const restore = mockInvoiceReads(f);
  try {
    const event = invoiceEvent(f);
    assert.equal((await webhook(request(event))).status, 503);
    await assertFailure(event.id, "renewal_invoice_membership_unavailable");
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 0);
  } finally { restore(); }
});

test("recurring invoice rejects a PaymentIntent linked to another business", async () => {
  const f = await fixture();
  const unrelated = await fixture();
  await prepareInvoice(f);
  await prisma.payment.create({ data: { businessId: unrelated.business.id,
    businessSubmissionId: unrelated.submission.id, userId: unrelated.owner.id,
    method: "STRIPE_CHECKOUT", amountCents: 10000, currency: "eur",
    purpose: "ANNUAL_RENEWAL", status: "PAID", paidAt: new Date(),
    stripePaymentIntentId: `pi_invoice_${f.business.id}` } });
  const restore = mockInvoiceReads(f);
  try {
    const event = invoiceEvent(f);
    assert.equal((await webhook(request(event))).status, 503);
    await assertFailure(event.id, "renewal_payment_association_conflict");
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 0);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(),
      f.membership.currentPeriodEnd.toISOString());
    assert.equal(await prisma.partnerCommission.count({ where: { businessId: unrelated.business.id, amountCents: 1500 } }), 0);
  } finally { restore(); }
});

test("temporary Stripe failure records a sanitized retryable failure", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  const restore = mockInvoiceReads(f, { fail: true });
  try {
    const event = invoiceEvent(f);
    assert.equal((await webhook(request(event))).status, 503);
    await assertFailure(event.id, "synthetic_provider_unavailable");
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 0);
  } finally { restore(); }
});

test("temporary database read failure cannot acknowledge a renewal", async () => {
  const f = await fixture();
  await pendingCheckout(f);
  const event = checkoutEvent(f);
  const delegate = prisma.payment as unknown as { findUnique: typeof prisma.payment.findUnique };
  const original = delegate.findUnique;
  delegate.findUnique = async () => { throw new Error("synthetic_database_unavailable"); };
  try {
    assert.equal((await webhook(request(event))).status, 503);
    await assertFailure(event.id, "synthetic_database_unavailable");
    assert.equal(await prisma.partnerCommission.count({ where: { businessId: f.business.id, amountCents: 1500 } }), 0);
  } finally { delegate.findUnique = original; }
  assert.equal((await webhook(request(event))).status, 200);
});

test("concurrent duplicate receives 503 while processing and 200 only after completion", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const restore = mockInvoiceReads(f, { wait: wait.then(() => {}) });
  const stripe = getStripe();
  const blockedRead = stripe.invoices.retrieve;
  (stripe.invoices as unknown as { retrieve: typeof blockedRead }).retrieve = async (...args) => {
    entered();
    return blockedRead(...args);
  };
  try {
    const event = invoiceEvent(f);
    const first = webhook(request(event));
    await started;
    assert.equal((await webhook(request(event))).status, 503);
    assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status, "PROCESSING");
    release();
    assert.equal((await first).status, 200);
    assert.equal((await webhook(request(event))).status, 200);
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 1);
  } finally { release(); restore(); }
});

test("initial subscription invoice is not mistaken for a recurring cycle", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  const event = invoiceEvent(f);
  event.data.object.billing_reason = "subscription_create";
  assert.equal((await webhook(request(event))).status, 200);
  assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } })).status, "SKIPPED");
  assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(), f.membership.currentPeriodEnd.toISOString());
});

test("a crashed processing claim can be reclaimed, and a superseded worker cannot mark it complete", async () => {
  const eventId = `evt_claim_${++sequence}`;
  const params = { endpointType: "PLATFORM" as const, eventType: "invoice.paid", livemode: false,
    stripeEventId: eventId, stripeObjectId: `in_claim_${sequence}` };
  const first = await beginStripeWebhookProcessing(params);
  assert.equal(first.inProgress, false);
  assert.equal(first.attemptCount, 1);
  const concurrent = await beginStripeWebhookProcessing(params);
  assert.equal(concurrent.inProgress, true);
  await prisma.stripeWebhookEvent.update({ where: { stripeEventId: eventId },
    data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
  const recovered = await beginStripeWebhookProcessing(params);
  assert.equal(recovered.inProgress, false);
  assert.equal(recovered.attemptCount, 2);
  await assert.rejects(completeStripeWebhookProcessing({ id: first.id, attemptCount: 1, status: "PROCESSED" }),
    /webhook_processing_lease_lost/);
  await completeStripeWebhookProcessing({ id: recovered.id, attemptCount: 2, status: "PROCESSED" });
  const done = await beginStripeWebhookProcessing(params);
  assert.equal(done.alreadyProcessed, true);
  assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: eventId } })).status, "PROCESSED");
});

test("two workers racing to reclaim one stale event obtain only one processing claim", async () => {
  const eventId = `evt_reclaim_race_${++sequence}`;
  const params = { endpointType: "PLATFORM" as const, eventType: "invoice.paid", livemode: false,
    stripeEventId: eventId, stripeObjectId: `in_reclaim_race_${sequence}` };
  await beginStripeWebhookProcessing(params);
  await prisma.stripeWebhookEvent.update({ where: { stripeEventId: eventId },
    data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
  const claims = await Promise.all([beginStripeWebhookProcessing(params), beginStripeWebhookProcessing(params)]);
  assert.equal(claims.filter((claim) => !claim.inProgress).length, 1);
  assert.equal(claims.filter((claim) => claim.inProgress).length, 1);
  const winner = claims.find((claim) => !claim.inProgress)!;
  assert.equal(winner.attemptCount, 2);
  await completeStripeWebhookProcessing({ id: winner.id, attemptCount: winner.attemptCount, status: "PROCESSED" });
  assert.equal((await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: eventId } })).status, "PROCESSED");
});

test("a worker past its lease cannot overwrite a newer completed invoice attempt or extend twice", async () => {
  const f = await fixture();
  await prepareInvoice(f);
  const restore = mockInvoiceReads(f);
  const stripe = getStripe();
  const originalRead = stripe.invoices.retrieve;
  let firstRead = true;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  (stripe.invoices as unknown as { retrieve: typeof originalRead }).retrieve = async (...args) => {
    if (firstRead) { firstRead = false; entered(); await wait; }
    return originalRead(...args);
  };
  try {
    const event = invoiceEvent(f);
    const oldWorker = webhook(request(event));
    await started;
    await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id },
      data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
    assert.equal((await webhook(request(event))).status, 200);
    release();
    await assert.rejects(oldWorker, /webhook_processing_lease_lost/);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { stripeInvoiceId: event.data.object.id } });
    assert.equal(await prisma.payment.count({ where: { stripeInvoiceId: event.data.object.id } }), 1);
    assert.equal(await prisma.partnerCommission.count({ where: { paymentId: payment.id, amountCents: 1500 } }), 1);
    assert.equal((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).currentPeriodEnd.toISOString(),
      addUtcDays(f.membership.currentPeriodEnd, 365).toISOString());
    const log = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
    assert.equal(log.status, "PROCESSED");
    assert.equal(log.attemptCount, 2);
  } finally { release(); (stripe.invoices as unknown as { retrieve: typeof originalRead }).retrieve = originalRead; restore(); }
});

test("duplicate full-refund and lost-dispute events reverse the exact initial commission once", async () => {
  const f = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { stripeLivemode: false } });
  const charge = { id: `ch_${f.business.id}`, amount: 10000, amount_refunded: 10000,
    payment_intent: f.payment.stripePaymentIntentId, refunds: { data: [] } };
  const refund = { id: `evt_refund_${f.business.id}`, type: "charge.refunded", livemode: false,
    data: { object: charge } };
  assert.equal((await webhook(request(refund))).status, 200);
  assert.equal((await webhook(request(refund))).status, 200);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "REFUNDED");
  assert.ok((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).entitlementRevokedAt);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
  const stripe = getStripe();
  const original = stripe.charges.retrieve;
  (stripe.charges as unknown as { retrieve: typeof original }).retrieve = async () => charge as never;
  try {
    const dispute = { id: `evt_dispute_${f.business.id}`, type: "charge.dispute.closed", livemode: false,
      data: { object: { id: `dp_${f.business.id}`, status: "lost", charge: charge.id } } };
    assert.equal((await webhook(request(dispute))).status, 200);
    assert.equal((await webhook(request(dispute))).status, 200);
    assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, type: "REVERSAL" } }), 1);
    assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
  } finally { (stripe.charges as unknown as { retrieve: typeof original }).retrieve = original; }
});

test("a renewal refund reverses only its €15 commission and preserves the initial €50 attribution", async () => {
  const f = await fixture();
  await pendingCheckout(f);
  const renewal = checkoutEvent(f);
  assert.equal((await webhook(request(renewal))).status, 200);
  const renewalPayment = await prisma.payment.findUniqueOrThrow({ where: { stripeCheckoutSessionId: renewal.data.object.id } });
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: renewalPayment.id, amountCents: 1500 } }), 1);
  const refund = { id: `evt_renewal_refund_${f.business.id}`, type: "charge.refunded", livemode: false,
    data: { object: { id: `ch_renewal_${f.business.id}`, amount: 10000, amount_refunded: 10000,
      payment_intent: renewalPayment.stripePaymentIntentId, refunds: { data: [] } } } };
  assert.equal((await webhook(request(refund))).status, 200);
  assert.equal((await webhook(request(refund))).status, 200);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: renewalPayment.id } })).status, "REFUNDED");
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: renewalPayment.id, type: "REVERSAL" } }), 1);
  assert.ok((await prisma.businessMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).entitlementRevokedAt);
  assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
});

test("unmatched refund and lost dispute leave unrelated payment and Partner payout state untouched", async () => {
  const f = await fixture();
  const missingIntent = `pi_unmatched_${f.business.id}`;
  const charge = { id: `ch_unmatched_${f.business.id}`, amount: 10000, amount_refunded: 10000,
    payment_intent: missingIntent, refunds: { data: [] } };
  const refund = { id: `evt_unmatched_refund_${f.business.id}`, type: "charge.refunded", livemode: false,
    data: { object: charge } };
  assert.equal((await webhook(request(refund))).status, 200);
  const stripe = getStripe();
  const original = stripe.charges.retrieve;
  (stripe.charges as unknown as { retrieve: typeof original }).retrieve = async () => charge as never;
  try {
    const dispute = { id: `evt_unmatched_dispute_${f.business.id}`, type: "charge.dispute.closed", livemode: false,
      data: { object: { id: `dp_unmatched_${f.business.id}`, status: "lost", charge: charge.id } } };
    assert.equal((await webhook(request(dispute))).status, 200);
  } finally { (stripe.charges as unknown as { retrieve: typeof original }).retrieve = original; }
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).status, "PENDING");
  assert.equal(await prisma.partnerCommission.count({ where: { type: "REVERSAL", businessId: f.business.id } }), 0);
  assert.equal(await prisma.partnerPayout.count({ where: { partnerUserId: f.partner.id } }), 0);
});

test("Connect webhook processing claims, duplicate delivery, and stale recovery do not alter payouts", async () => {
  const event = { id: `evt_connect_${++sequence}`, type: "payout.paid", livemode: false,
    account: "acct_synthetic_unmatched", data: { object: { id: `po_synthetic_${sequence}` } } };
  const params = { endpointType: "CONNECT" as const, eventType: event.type, livemode: false,
    stripeAccountId: event.account, stripeEventId: event.id, stripeObjectId: event.data.object.id };
  await beginStripeWebhookProcessing(params);
  assert.equal((await connectWebhook(connectRequest(event))).status, 503);
  await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id },
    data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
  assert.equal((await connectWebhook(connectRequest(event))).status, 200);
  assert.equal((await connectWebhook(connectRequest(event))).status, 200);
  const log = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } });
  assert.equal(log.status, "PROCESSED");
  assert.equal(log.attemptCount, 2);
  assert.equal(await prisma.partnerPayout.count(), 0);
});
