import { NextResponse } from "next/server";
import { ensurePartnerCommissionForSubmission, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { getStripe } from "@/lib/stripe";
import { markStripePaymentRefunded, syncStripePaymentFromWebhook } from "@/lib/stripe-payment-sync";
import {
  beginStripeWebhookProcessing,
  completeStripeWebhookProcessing,
} from "@/lib/stripe-webhook-log";
import { normalizeEnvValue } from "@/lib/env";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = normalizeEnvValue(process.env.STRIPE_WEBHOOK_SECRET);

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "stripe_webhook_not_configured" }, { status: 400 });
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

  const webhookLog = await beginStripeWebhookProcessing({
    endpointType: "PLATFORM",
    eventType: event.type,
    livemode: event.livemode,
    stripeEventId: event.id,
    stripeObjectId: "id" in event.data.object ? `${event.data.object.id ?? ""}` : null,
    summary: {
      type: event.type,
    },
  });

  if (webhookLog.alreadyProcessed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const businessSubmissionId = session.metadata?.businessSubmissionId?.trim();
      const userId = session.metadata?.userId?.trim();
      const businessId = session.metadata?.businessId?.trim() || null;

      if (!businessSubmissionId || !userId) {
        await completeStripeWebhookProcessing({
          errorMessage: "missing_checkout_metadata",
          id: webhookLog.id,
          status: "FAILED",
        });
        return NextResponse.json({ error: "missing_checkout_metadata" }, { status: 400 });
      }

      const amountPaidCents = session.amount_total ?? 0;
      await syncStripePaymentFromWebhook({
        amountPaidCents,
        businessId,
        businessSubmissionId,
        currency: session.currency,
        method: "STRIPE_CHECKOUT",
        paymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        sessionId: session.id,
        stripeEventId: event.id,
      });
      await ensurePartnerCommissionForSubmission({
        businessSubmissionId,
        sourceEventId: event.id,
        sourceEventType: event.type,
      });
      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const businessSubmissionId = paymentIntent.metadata?.businessSubmissionId?.trim();
      const paymentFlow = paymentIntent.metadata?.paymentFlow?.trim();

      if (!businessSubmissionId || paymentFlow !== "BANK_TRANSFER") {
        await completeStripeWebhookProcessing({
          id: webhookLog.id,
          status: "SKIPPED",
        });
        return NextResponse.json({ received: true });
      }

      await syncStripePaymentFromWebhook({
        amountPaidCents: paymentIntent.amount_received || paymentIntent.amount || 0,
        businessId: paymentIntent.metadata?.businessId?.trim() || null,
        businessSubmissionId,
        currency: paymentIntent.currency,
        method: "BANK_TRANSFER",
        paymentIntentId: paymentIntent.id,
        stripeEventId: event.id,
      });
      await ensurePartnerCommissionForSubmission({
        businessSubmissionId,
        sourceEventId: event.id,
        sourceEventType: event.type,
      });
      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object;

      if (typeof charge.payment_intent === "string") {
        await markStripePaymentRefunded({
          stripePaymentIntentId: charge.payment_intent,
        });
        await reversePartnerCommissionForPayment({
          eventType: event.type,
          reason: "payment_refunded",
          sourceEventId: event.id,
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
        });
      }

      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.dispute.created") {
      const dispute = event.data.object;
      const charge = await stripe.charges.retrieve(
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id,
      );

      if (typeof charge.payment_intent === "string") {
        await reversePartnerCommissionForPayment({
          eventType: event.type,
          reason: "payment_disputed",
          sourceEventId: event.id,
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
        });
      }

      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    await completeStripeWebhookProcessing({
      id: webhookLog.id,
      status: "SKIPPED",
    });
  } catch (error) {
    await completeStripeWebhookProcessing({
      errorMessage: error instanceof Error ? error.message : "webhook_processing_failed",
      id: webhookLog.id,
      status: "FAILED",
    });
    throw error;
  }

  return NextResponse.json({ received: true });
}
