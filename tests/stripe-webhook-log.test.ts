import assert from "node:assert/strict";
import test from "node:test";

import { StripeWebhookProcessingStatus } from "@prisma/client";

import { shouldRetryStripeWebhook } from "@/lib/stripe-webhook-log";

test("only a failed Stripe event is eligible for a Stripe webhook retry", () => {
  assert.equal(shouldRetryStripeWebhook(StripeWebhookProcessingStatus.FAILED), true);
  assert.equal(shouldRetryStripeWebhook(StripeWebhookProcessingStatus.PROCESSED), false);
  assert.equal(shouldRetryStripeWebhook(StripeWebhookProcessingStatus.SKIPPED), false);
});
