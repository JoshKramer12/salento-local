import assert from "node:assert/strict";
import test from "node:test";

import { processPaidSubmissionWebhook } from "@/lib/stripe-payment-webhook";

const paidCheckoutEvent = {
  amountPaidCents: 10000,
  businessId: "business_123",
  businessSubmissionId: "submission_123",
  currency: "eur",
  eventType: "checkout.session.completed",
  method: "STRIPE_CHECKOUT" as const,
  paymentIntentId: "pi_test_paid",
  sessionId: "cs_test_paid",
  stripeEventId: "evt_test_paid",
};

test("the paid Stripe webhook persists payment and commission before sending the owner email", async () => {
  const calls: string[] = [];
  const result = await processPaidSubmissionWebhook(paidCheckoutEvent, {
    ensurePartnerCommissionForSubmission: async () => {
      calls.push("commission");
      return null;
    },
    sendPurchaseConfirmationForSubmission: async (params) => {
      calls.push(`email:${params.locale}:${params.submissionId}`);
      return true;
    },
    syncStripePaymentFromWebhook: async () => {
      calls.push("payment");
      return {
        paymentReceived: true,
        publishedBusinessSlug: "masseria-del-sole",
        publishedTownSlug: "lecce",
      };
    },
  });

  assert.deepEqual(calls, ["payment", "commission", "email:it:submission_123"]);
  assert.equal(result.ownerEmailSent, true);
  assert.equal(result.payment.paymentReceived, true);
});

test("an owner-email failure is retryable without undoing payment or commission", async () => {
  let paymentPersisted = false;
  let commissionPersisted = false;

  await assert.rejects(
    processPaidSubmissionWebhook(paidCheckoutEvent, {
      ensurePartnerCommissionForSubmission: async () => {
        commissionPersisted = true;
        return null;
      },
      sendPurchaseConfirmationForSubmission: async () => {
        throw new Error("email_provider_unavailable");
      },
      syncStripePaymentFromWebhook: async () => {
        paymentPersisted = true;
        return {
          paymentReceived: true,
          publishedBusinessSlug: "masseria-del-sole",
          publishedTownSlug: "lecce",
        };
      },
    }),
    /email_provider_unavailable/,
  );

  assert.equal(paymentPersisted, true);
  assert.equal(commissionPersisted, true);
});
