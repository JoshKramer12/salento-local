import { NextResponse } from "next/server";

import { handleConnectedPayoutEvent } from "@/lib/partner-ledger";
import {
  syncPartnerStripeAccountStatusByConnectedAccountId,
} from "@/lib/partner-connect";
import { assertStripeObjectMode, getStripe } from "@/lib/stripe";
import {
  beginStripeWebhookProcessing,
  completeStripeWebhookProcessing,
} from "@/lib/stripe-webhook-log";
import { normalizeEnvValue } from "@/lib/env";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = normalizeEnvValue(process.env.STRIPE_CONNECT_WEBHOOK_SECRET);

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "stripe_connect_webhook_not_configured" }, { status: 400 });
  }

  const payload = await request.text();
  const stripe = getStripe();

  let event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 400 },
    );
  }

  try {
    assertStripeObjectMode(event.livemode);
  } catch {
    return NextResponse.json({ error: "stripe_payment_mode_mismatch" }, { status: 400 });
  }

  const webhookLog = await beginStripeWebhookProcessing({
    endpointType: "CONNECT",
    eventType: event.type,
    livemode: event.livemode,
    stripeAccountId: typeof event.account === "string" ? event.account : null,
    stripeEventId: event.id,
    stripeObjectId: "id" in event.data.object ? `${event.data.object.id ?? ""}` : null,
    summary: {
      type: event.type,
    },
  });

  if (webhookLog.alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (webhookLog.inProgress) {
    return NextResponse.json({ error: "webhook_processing_in_progress" }, { status: 503 });
  }
  const complete = (params: Omit<Parameters<typeof completeStripeWebhookProcessing>[0], "attemptCount">) =>
    completeStripeWebhookProcessing({ ...params, attemptCount: webhookLog.attemptCount });

  try {
    if (event.type === "account.updated") {
      const account = event.data.object;
      await syncPartnerStripeAccountStatusByConnectedAccountId(account.id);
      await complete({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (
      event.type === "payout.paid" ||
      event.type === "payout.failed" ||
      event.type === "payout.canceled"
    ) {
      const payout = event.data.object;
      await handleConnectedPayoutEvent({
        eventType: event.type,
        payoutId: payout.id,
      });
      await complete({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    await complete({
      id: webhookLog.id,
      status: "SKIPPED",
    });
  } catch (error) {
    await complete({
      errorMessage: error instanceof Error && /^[a-z][a-z0-9_]{2,100}$/.test(error.message)
        ? error.message : "connect_webhook_processing_failed",
      id: webhookLog.id,
      status: "FAILED",
    });
    throw error;
  }

  return NextResponse.json({ received: true });
}
