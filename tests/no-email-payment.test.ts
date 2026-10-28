import assert from "node:assert/strict";
import test from "node:test";
import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import rawPhoneNumberMetadata from "libphonenumber-js/metadata.min.json";
import type Stripe from "stripe";

import {
  createNoEmailPaymentToken,
  EMAIL_MANUAL_PAYMENT_FLOW,
  ensureManualElementPaymentIntent,
  ensureNoEmailPaymentIntent,
  findInitialElementTokenPayment,
  findNoEmailTokenPayment,
  getInitialOnlinePaymentInterface,
  getNoEmailPaymentPhoneError,
  getVerifiedNoEmailPaymentIntent,
  getVerifiedManualElementPaymentIntent,
  isNoEmailElementEligible,
  matchesNoEmailPaymentIntent,
  NO_EMAIL_PAYMENT_FLOW,
  parseNoEmailPaymentToken,
} from "@/lib/no-email-payment";
import { buildNoEmailPaymentQrPayload, buildStripePaymentQrPayload, generateStripePaymentQrDataUrl } from "@/lib/stripe-payment-qr";
import { processPaidSubmissionWebhook } from "@/lib/stripe-payment-webhook";

const signed = new Date("2026-09-24T12:00:00Z");
const submission = {
  agreementSignature: "signed-drawing",
  amountOwedCents: 10000,
  automaticRenewalAtAcceptance: false,
  businessName: "Trattoria del Sole",
  businessTermsAcceptedAt: signed,
  id: "submission-no-email",
  ownerEmail: "",
  ownerHasNoEmail: true,
  ownerPhone: "+39 347 123 4567",
  paymentMethod: "ONLINE",
  paymentStatus: "PENDING_PAYMENT",
  signedAt: signed,
  status: "AWAITING_PAYMENT",
  user: { role: "GETTER" },
  userId: "partner-1",
};
const possibleButInvalidOwnerPhone = "+39 123 456 789";
const phoneNumberMetadataModule = rawPhoneNumberMetadata as typeof rawPhoneNumberMetadata & {
  default?: typeof rawPhoneNumberMetadata;
};
const phoneNumberMetadata = phoneNumberMetadataModule.default ?? rawPhoneNumberMetadata;

test("a plausible but invalid no-email owner phone gets a field error before payment setup", async () => {
  const parsed = parsePhoneNumberFromString(possibleButInvalidOwnerPhone, "IT", phoneNumberMetadata);
  assert.equal(parsed?.isPossible(), true);
  assert.equal(parsed?.isValid(), false);
  const params = {
    locale: "en" as const,
    ownerEmail: "",
    ownerPhone: possibleButInvalidOwnerPhone,
    paymentMethod: "ONLINE",
    submitterRole: "GETTER",
  };
  const error = getNoEmailPaymentPhoneError(params);
  assert.equal(error?.error, "Enter a valid owner phone number before opening the payment QR.");
  assert.deepEqual(error?.invalidFields, ["ownerPhone"]);
  assert.equal(error?.fieldErrors.ownerPhone, error?.error);
  assert.equal(getNoEmailPaymentPhoneError({ ...params, ownerEmail: "owner@example.com" }), null);
  assert.equal(getNoEmailPaymentPhoneError({ ...params, paymentMethod: "BANK_TRANSFER" }), null);
  assert.equal(isNoEmailElementEligible({ ...submission, ownerPhone: possibleButInvalidOwnerPhone, submittingUserRole: "GETTER" }), false);
  const db = {
    businessSubmission: { findUnique: async () => ({ ...submission, ownerPhone: possibleButInvalidOwnerPhone }) },
    payment: { findFirst: async () => { throw new Error("Payment lookup must not run"); } },
  };
  const stripe = { paymentIntents: { create: async () => { throw new Error("Stripe must not run"); } } };
  assert.equal(await ensureNoEmailPaymentIntent(submission.id, { db: db as never, stripe: stripe as never }), null);
});

test("new card payments select Payment Element while no-email eligibility retains its phone and Partner rules", () => {
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "owner@example.com", submitterRole: "GETTER" }), "ELEMENT");
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "owner@example.com", submitterRole: "BUSINESS_OWNER" }), "ELEMENT");
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "", submitterRole: "BUSINESS_OWNER" }), "ELEMENT");
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "  ", submitterRole: "GETTER" }), "ELEMENT");
  assert.equal(isNoEmailElementEligible({ ...submission, submittingUserRole: "GETTER" }), true);
  assert.equal(isNoEmailElementEligible({ ...submission, ownerEmail: "   ", ownerHasNoEmail: false, submittingUserRole: "GETTER" }), true);
  assert.equal(isNoEmailElementEligible({ ...submission, ownerEmail: "owner@example.com", submittingUserRole: "GETTER" }), false);
  assert.equal(isNoEmailElementEligible({ ...submission, ownerPhone: "invalid", submittingUserRole: "GETTER" }), false);
  assert.equal(isNoEmailElementEligible({ ...submission, automaticRenewalAtAcceptance: true, submittingUserRole: "GETTER" }), false);
  assert.equal(isNoEmailElementEligible({ ...submission, signedAt: null, submittingUserRole: "GETTER" }), false);
  assert.equal(isNoEmailElementEligible({ ...submission, submittingUserRole: "BUSINESS_OWNER" }), false);
  assert.equal(isNoEmailElementEligible({ ...submission, paymentStatus: "PAID", submittingUserRole: "GETTER" }), false);
});

test("the QR token is signed, expires, and binds one Payment rather than a user-selected submission", () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-only-secret";
  try {
    const now = Date.parse("2026-09-24T12:00:00Z");
    const token = createNoEmailPaymentToken("initial-element:submission-no-email", now);
    assert.equal(parseNoEmailPaymentToken(token, now), "initial-element:submission-no-email");
    assert.equal(parseNoEmailPaymentToken(token, now + 8 * 24 * 60 * 60 * 1000), null);
    assert.equal(parseNoEmailPaymentToken(`${token}x`, now), null);
    assert.equal(buildNoEmailPaymentQrPayload({ appUrl: "https://salentolocal.example", token, runtimeEnvironment: "production" }),
      `https://salentolocal.example/pay/element/${token}`);
    assert.throws(() => buildNoEmailPaymentQrPayload({ appUrl: "http://localhost:3000", token, runtimeEnvironment: "production" }), /invalid_public_app_url/);
    const checkout = buildStripePaymentQrPayload({
      appUrl: "https://salentolocal.example",
      checkoutSessionId: "cs_test_existing123",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_existing123",
      runtimeEnvironment: "production",
    });
    assert.equal(checkout.qrValue, "https://salentolocal.example/pay/stripe/cs_test_existing123");
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test("refresh reuses one server-priced PaymentIntent and its exact Payment record", async () => {
  let ownerPhone = possibleButInvalidOwnerPhone;
  let storedPayment: Record<string, unknown> | null = null;
  let intent: Stripe.PaymentIntent | null = null;
  const createCalls: Array<{ amount: number; currency: string; metadata: Record<string, string>; idempotencyKey: string; paymentMethodTypes: string[] }> = [];
  const db = {
    businessSubmission: { findUnique: async () => ({ ...submission, ownerPhone }) },
    payment: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async () => storedPayment,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        storedPayment ||= { ...create, purpose: "INITIAL_MEMBERSHIP", stripeCheckoutSessionId: null, stripePaymentIntentId: null };
        return storedPayment;
      },
      updateMany: async ({ data }: { data: { stripePaymentIntentId: string } }) => {
        storedPayment = { ...storedPayment, ...data };
        return { count: 1 };
      },
    },
  };
  const stripe = {
    paymentIntents: {
      create: async (params: { amount: number; currency: string; metadata: Record<string, string>; payment_method_types: string[] }, opts: { idempotencyKey: string }) => {
        createCalls.push({ amount: params.amount, currency: params.currency, metadata: params.metadata, idempotencyKey: opts.idempotencyKey, paymentMethodTypes: params.payment_method_types });
        intent = { id: "pi_test_exact", amount: params.amount, amount_received: 0, currency: params.currency, metadata: params.metadata, status: "requires_payment_method", client_secret: "pi_test_exact_secret_test" } as Stripe.PaymentIntent;
        return intent;
      },
      retrieve: async () => intent,
    },
    checkout: { sessions: { retrieve: async () => { throw new Error("unexpected Checkout lookup"); } } },
  };
  assert.equal(await ensureNoEmailPaymentIntent(submission.id, { db: db as never, stripe: stripe as never }), null);
  assert.equal(storedPayment, null);
  assert.equal(createCalls.length, 0);
  ownerPhone = submission.ownerPhone;
  const first = await ensureNoEmailPaymentIntent(submission.id, { db: db as never, stripe: stripe as never });
  const second = await ensureNoEmailPaymentIntent(submission.id, { db: db as never, stripe: stripe as never });
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].amount, 10000);
  assert.equal(createCalls[0].currency, "eur");
  assert.deepEqual(createCalls[0].paymentMethodTypes, ["card"]);
  assert.equal(createCalls[0].metadata.paymentFlow, NO_EMAIL_PAYMENT_FLOW);
  assert.equal(createCalls[0].metadata.businessSubmissionId, submission.id);
  assert.equal(createCalls[0].metadata.partnerId, "partner-1");
  assert.equal(createCalls[0].metadata.paymentId, "initial-element:submission-no-email");
  assert.equal(createCalls[0].metadata.ownerEmail, undefined);
  assert.equal(first?.stripePaymentIntentId, "pi_test_exact");
  assert.equal(second?.stripePaymentIntentId, "pi_test_exact");
  assert.equal((storedPayment as { stripeCheckoutSessionId: string | null }).stripeCheckoutSessionId, null);

  const verified = await getVerifiedNoEmailPaymentIntent(intent!, { db: {
    payment: { findUnique: async () => ({ ...storedPayment, businessSubmission: submission }) },
  } as never });
  assert.equal(verified?.id, "initial-element:submission-no-email");
  assert.equal(matchesNoEmailPaymentIntent({ ...intent!, metadata: { ...intent!.metadata, paymentFlow: "CHECKOUT" } } as Stripe.PaymentIntent, storedPayment as never), false);
  assert.equal(matchesNoEmailPaymentIntent({ ...intent!, amount: 100 } as Stripe.PaymentIntent, storedPayment as never), false);
  assert.equal(matchesNoEmailPaymentIntent({ ...intent!, metadata: { ...intent!.metadata, partnerId: "other-partner" } } as Stripe.PaymentIntent, storedPayment as never), false);

  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-only-secret";
  try {
    const token = createNoEmailPaymentToken(first!.id);
    const url = buildNoEmailPaymentQrPayload({
      appUrl: "https://web-production-6f26e.up.railway.app",
      token,
      runtimeEnvironment: "production",
    });
    assert.equal(parseNoEmailPaymentToken(token), first!.id);
    assert.ok(url.startsWith("https://web-production-6f26e.up.railway.app/pay/element/"));
    assert.match(await generateStripePaymentQrDataUrl(url), /^data:image\/png;base64,/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test("email manual reuses the embedded PaymentIntent with the real owner email and signed token", async () => {
  const emailSubmission = { ...submission, ownerEmail: "owner@example.com", ownerHasNoEmail: false };
  let storedPayment: Record<string, unknown> | null = null;
  let intent: Stripe.PaymentIntent | null = null;
  let creates = 0;
  const db = {
    businessSubmission: { findUnique: async () => emailSubmission },
    payment: {
      findFirst: async () => null, findMany: async () => [],
      findUnique: async () => storedPayment && { ...storedPayment, businessSubmission: emailSubmission },
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        storedPayment ??= { ...create, purpose: "INITIAL_MEMBERSHIP", stripeCheckoutSessionId: null,
          stripePaymentIntentId: null, stripeSubscriptionId: null, stripeInvoiceId: null, stripeCustomerId: null };
        return storedPayment;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        storedPayment = { ...storedPayment, ...data };
        return { count: 1 };
      },
    },
  };
  const stripe = {
    paymentIntents: {
      create: async (params: { amount: number; currency: string; metadata: Record<string, string>; receipt_email?: string }) => {
        creates++;
        assert.equal(params.receipt_email, "owner@example.com");
        assert.equal(params.metadata.paymentFlow, EMAIL_MANUAL_PAYMENT_FLOW);
        intent = { id: "pi_email", amount: params.amount, amount_received: 0, currency: params.currency,
          metadata: params.metadata, status: "requires_payment_method", client_secret: "pi_email_secret_test" } as Stripe.PaymentIntent;
        return intent;
      },
      retrieve: async () => intent,
    },
    checkout: { sessions: { retrieve: async () => { throw Error("unexpected Checkout"); } } },
  };
  const dependencies = { db: db as never, stripe: stripe as never };
  const first = await ensureManualElementPaymentIntent(submission.id, dependencies);
  const second = await ensureManualElementPaymentIntent(submission.id, dependencies);
  assert.equal(first?.stripePaymentIntentId, "pi_email");
  assert.equal(second?.stripePaymentIntentId, "pi_email");
  assert.equal(creates, 1);
  assert.equal((await getVerifiedManualElementPaymentIntent(intent!, { db: db as never }))?.businessSubmission.ownerEmail, "owner@example.com");
  assert.equal(await getVerifiedNoEmailPaymentIntent(intent!, { db: db as never }), null);
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-only-secret";
  try {
    const token = createNoEmailPaymentToken(first!.id);
    assert.equal((await findInitialElementTokenPayment(token, undefined, { db: db as never }))?.id, first!.id);
    assert.equal(await findNoEmailTokenPayment(token, undefined, { db: db as never }), null);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test("the owner token cannot open another Payment or a document before authoritative PAID state", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-only-secret";
  try {
    const token = createNoEmailPaymentToken("initial-element:submission-no-email");
    const db = { payment: { findUnique: async () => ({
      id: "initial-element:submission-no-email", businessSubmissionId: submission.id,
      businessSubmission: submission, method: "STRIPE_CHECKOUT", partnerUserId: "partner-1",
      userId: "partner-1",
      purpose: "INITIAL_MEMBERSHIP", status: "PENDING_PAYMENT", stripeCheckoutSessionId: null,
      stripePaymentIntentId: "pi_test_exact",
    }) } };
    assert.equal(await findNoEmailTokenPayment(token, { paymentId: "other-payment" }, { db: db as never }), null);
    assert.equal(await findNoEmailTokenPayment(token, { submissionId: "other-submission" }, { db: db as never }), null);
    assert.equal(await findNoEmailTokenPayment(token, { paid: true }, { db: db as never }), null);
    assert.ok(await findNoEmailTokenPayment(token, undefined, { db: db as never }));
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test("an older paid Checkout Session blocks a second PaymentIntent", async () => {
  let created = false;
  const db = {
    businessSubmission: { findUnique: async () => submission },
    payment: {
      findFirst: async () => null,
      findMany: async () => [{ stripeCheckoutSessionId: "cs_test_previous" }],
      upsert: async () => { created = true; throw new Error("must not create a second Payment"); },
    },
  };
  const stripe = {
    checkout: { sessions: { retrieve: async () => ({ id: "cs_test_previous", payment_status: "paid", status: "complete" }) } },
  };
  assert.equal(await ensureNoEmailPaymentIntent(submission.id, { db: db as never, stripe: stripe as never }), null);
  assert.equal(created, false);
});

test("Checkout's own PaymentIntent cannot enter the no-email verifier", async () => {
  const checkoutIntent = {
    id: "pi_test_checkout", amount: 10000, amount_received: 10000, currency: "eur",
    metadata: { businessSubmissionId: submission.id, paymentFlow: "CHECKOUT" }, status: "succeeded",
  } as unknown as Stripe.PaymentIntent;
  const db = { payment: { findUnique: async () => { throw new Error("Checkout should not reach Payment lookup"); } } };
  assert.equal(await getVerifiedNoEmailPaymentIntent(checkoutIntent, { db: db as never }), null);
});

test("no-email authoritative webhook uses the existing payment, commission, and notification pipeline", async () => {
  const calls: string[] = [];
  await processPaidSubmissionWebhook({
    amountPaidCents: 10000,
    businessSubmissionId: submission.id,
    currency: "eur",
    eventType: "payment_intent.succeeded",
    method: "STRIPE_CHECKOUT",
    paymentIntentId: "pi_test_exact",
    stripeEventId: "evt_test_exact",
  }, {
    syncStripePaymentFromWebhook: async (params) => {
      assert.equal(params.sessionId, undefined);
      assert.equal(params.paymentIntentId, "pi_test_exact");
      calls.push("payment_and_publication");
      return { paymentReceived: true, publishedBusinessSlug: "trattoria-del-sole", publishedTownSlug: "lecce" };
    },
    ensurePartnerCommissionForSubmission: async () => { calls.push("commission"); return null; },
    ensurePartnerCommissionConfirmationDeliveryForSubmission: async () => { calls.push("partner_delivery"); return "delivery_test"; },
    attemptPartnerCommissionConfirmationForSubmission: async () => { calls.push("partner_notification"); return "accepted"; },
    ensurePurchaseConfirmationDeliveryForSubmission: async () => { calls.push("owner_delivery"); return "owner_delivery_test"; },
    attemptPurchaseConfirmationDeliveryForSubmission: async (_id, options) => {
      calls.push("owner_attempt");
      await options.sendConfirmation!({ locale: "it", submissionId: submission.id });
      return "pending";
    },
    sendPurchaseConfirmationForSubmission: async () => { calls.push("owner_notification"); return false; },
  });
  assert.deepEqual(calls, ["payment_and_publication", "commission", "partner_delivery", "partner_notification", "owner_delivery", "owner_attempt", "owner_notification"]);
});
