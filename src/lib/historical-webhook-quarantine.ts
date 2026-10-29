import type Stripe from "stripe";

import { prisma } from "@/lib/prisma";

// These nine test-mode platform events were reconciled in Step 4C. They remain
// FAILED in the historical ledger; a redelivery must not create new financial
// or notification effects. The object IDs bind this exception to the exact
// stored events, not merely to a familiar-looking Stripe event ID.
const RECONCILED_ACCOUNT_ID = "acct_1TqwSuRTjKpCuoPH";
const RECONCILED_BEFORE = new Date("2026-10-01T00:00:00.000Z");
const RECONCILED_EVENTS: Readonly<Record<string, { type: string; objectId: string }>> = {
  evt_1UJJ2NRTjKpCuoPHll3hmDPu: {
    type: "checkout.session.completed",
    objectId: "cs_test_a1An0qB6hmzz7zkaBhOX5rTzSJAV4kmpPKVPIESKchJWUlLfbHnvSQLEZt",
  },
  evt_1UJeG3RTjKpCuoPHMmbWMeXM: {
    type: "invoice.paid",
    objectId: "in_1UJeFdRTjKpCuoPHKzFxc8U6",
  },
  evt_3UKsxwRTjKpCuoPH1Wp54OFK: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKsxwRTjKpCuoPH1CnAeHWq",
  },
  evt_3UKsxyRTjKpCuoPH0RudFuRx: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKsxyRTjKpCuoPH0zR9J9tf",
  },
  evt_3UKsz7RTjKpCuoPH0ylnYHhf: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKsz7RTjKpCuoPH0RqS5bOj",
  },
  evt_3UKzJ5RTjKpCuoPH0Rzu653v: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKzJ5RTjKpCuoPH0dmjcGHb",
  },
  evt_3UKzJ5RTjKpCuoPH1cm5MNnv: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKzJ5RTjKpCuoPH1Er8N8iq",
  },
  evt_3UKzJ6RTjKpCuoPH0ms8QExK: {
    type: "payment_intent.succeeded",
    objectId: "pi_3UKzJ6RTjKpCuoPH0mG1ZoSz",
  },
  evt_1UKzRWRTjKpCuoPHHr4Czf6j: {
    type: "invoice.paid",
    objectId: "in_1UKzJ7RTjKpCuoPHtoSciXwk",
  },
};

export type HistoricalWebhookDisposition =
  | "ordinary"
  | "reconciled_no_replay"
  | "identity_conflict"
  | "historical_processing_in_progress";

/** Called only after Stripe signature and mode validation. Never writes a row. */
export async function getHistoricalWebhookDisposition(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<HistoricalWebhookDisposition> {
  const expected = RECONCILED_EVENTS[event.id];
  if (!expected) return "ordinary";

  const stored = await prisma.stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { createdAt: true, endpointType: true, eventType: true, livemode: true,
      status: true, stripeAccountId: true, stripeObjectId: true },
  });
  if (!stored || stored.status === "PROCESSED" || stored.status === "SKIPPED") {
    return "ordinary";
  }

  const objectId = "id" in event.data.object ? event.data.object.id : null;
  if (stored.endpointType !== "PLATFORM" || stored.livemode || event.livemode ||
    stored.stripeAccountId !== null || stored.createdAt >= RECONCILED_BEFORE ||
    stored.eventType !== expected.type || event.type !== expected.type ||
    stored.stripeObjectId !== expected.objectId || objectId !== expected.objectId ||
    (event.account && event.account !== RECONCILED_ACCOUNT_ID)) {
    return "identity_conflict";
  }

  // A valid platform signature proves the configured endpoint secret signed
  // the payload. Verify the current API key's account too, because this code
  // also runs in other Stripe environments with different endpoint secrets.
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== RECONCILED_ACCOUNT_ID) return "identity_conflict";

  if (stored.status === "PROCESSING") return "historical_processing_in_progress";
  return "reconciled_no_replay";
}
