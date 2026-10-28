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
    ensurePartnerCommissionConfirmationDeliveryForSubmission: async () => {
      calls.push("partner-delivery");
      return "delivery_123";
    },
    ensurePurchaseConfirmationDeliveryForSubmission: async () => {
      calls.push("owner-delivery");
      return "owner-delivery_123";
    },
    attemptPurchaseConfirmationDeliveryForSubmission: async (_id, options) => {
      calls.push("owner-attempt");
      await options.sendConfirmation!({ locale: "it", submissionId: "submission_123" });
      return "accepted";
    },
    attemptPartnerCommissionConfirmationForSubmission: async () => {
      calls.push("partner-email");
      return "accepted";
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

  assert.deepEqual(calls, ["payment", "commission", "partner-delivery", "partner-email", "owner-delivery", "owner-attempt", "email:it:submission_123"]);
  assert.equal(result.ownerEmailSent, true);
  assert.equal(result.payment.paymentReceived, true);
});

test("an owner-email failure is tracked separately without undoing payment or commission", async () => {
  let paymentPersisted = false;
  let commissionPersisted = false;

  const result = await processPaidSubmissionWebhook(paidCheckoutEvent, {
      ensurePartnerCommissionForSubmission: async () => {
        commissionPersisted = true;
        return null;
      },
      ensurePartnerCommissionConfirmationDeliveryForSubmission: async () => "delivery_123",
      attemptPartnerCommissionConfirmationForSubmission: async () => "accepted",
      ensurePurchaseConfirmationDeliveryForSubmission: async () => "owner-delivery_123",
      attemptPurchaseConfirmationDeliveryForSubmission: async (_id, options) => {
        await assert.rejects(options.sendConfirmation!({ locale: "it", submissionId: "submission_123" }), /email_provider_unavailable/);
        return "pending";
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
    });

  assert.equal(paymentPersisted, true);
  assert.equal(commissionPersisted, true);
  assert.equal(result.ownerEmailSent, false);
});
