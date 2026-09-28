import { NextResponse } from "next/server";
import { ensurePartnerRefundRepurchaseCommissionForPayment, ensurePartnerRenewalCommissionForPayment, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { getStripe } from "@/lib/stripe";
import { markStripePaymentRefunded } from "@/lib/stripe-payment-sync";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { prisma } from "@/lib/prisma";
import { sendMembershipPaymentOutcomeEmail } from "@/lib/membership-reminders";
import { processPaidSubmissionWebhook } from "@/lib/stripe-payment-webhook";
import {
  beginStripeWebhookProcessing,
  completeStripeWebhookProcessing,
} from "@/lib/stripe-webhook-log";
import { normalizeEnvValue } from "@/lib/env";
import { EMAIL_MANUAL_PAYMENT_FLOW, getVerifiedManualElementPaymentIntent, NO_EMAIL_PAYMENT_FLOW } from "@/lib/no-email-payment";
import { getVerifiedInitialSubscriptionInvoice } from "@/lib/embedded-subscription";
import { reconcileInitialRefund } from "@/lib/self-service-refunds";

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
      const paymentFlow = session.metadata?.paymentFlow?.trim();
      const businessSubmissionId = session.metadata?.businessSubmissionId?.trim();
      const userId = session.metadata?.userId?.trim();
      const businessId = session.metadata?.businessId?.trim() || null;

      if (paymentFlow === "MEMBERSHIP_RENEWAL") {
        const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
          amountPaidCents: session.amount_total ?? 0,
          automaticRenewal: session.metadata?.automaticRenewal === "true",
          businessId,
          db: tx,
          eventId: event.id,
          method: "STRIPE_CHECKOUT",
          paidAt: new Date(),
          paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          sessionId: session.id,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
          subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
        }));
        if (result?.paymentId) {
          await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
          await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
          if (!result.duplicate) await sendMembershipPaymentOutcomeEmail({ membershipId: result.membership.id });
        }
        await completeStripeWebhookProcessing({ id: webhookLog.id, status: result ? "PROCESSED" : "FAILED" });
        return NextResponse.json({ received: true });
      }

      if (!businessSubmissionId || !userId) {
        await completeStripeWebhookProcessing({
          errorMessage: "missing_checkout_metadata",
          id: webhookLog.id,
          status: "FAILED",
        });
        return NextResponse.json({ error: "missing_checkout_metadata" }, { status: 400 });
      }

      const amountPaidCents = session.amount_total ?? 0;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
      let subscription: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>> | null = null;
      if (subscriptionId) {
        // Treat a temporary Stripe read failure as a webhook failure. Stripe
        // retries it, and we never create an auto-renew membership without its
        // server-authoritative subscription state.
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      }
      await processPaidSubmissionWebhook({
        amountPaidCents,
        businessId,
        businessSubmissionId,
        currency: session.currency,
        eventType: event.type,
        method: "STRIPE_CHECKOUT",
        paymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        sessionId: session.id,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
        stripeCancelAtPeriodEnd: subscription?.cancel_at_period_end ?? null,
        stripeEventId: event.id,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: subscription?.status ?? null,
      });
      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    // `invoice.paid` is the authoritative recurring-payment success signal.
    // Checkout completion only establishes the initial membership; invoices
    // extend later terms and cannot create Partner commissions.
    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      const rawSubscription = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : null;
      if (invoice.billing_reason === "subscription_create" && invoice.status === "paid") {
        const exactPayment = await prisma.payment.findUnique({
          where: { stripeInvoiceId: invoice.id },
          select: { id: true, stripeCheckoutSessionId: true, stripeSubscriptionId: true },
        });
        if (exactPayment?.id.startsWith("initial-element:") && exactPayment.stripeSubscriptionId &&
          !exactPayment.stripeCheckoutSessionId) {
          const currentInvoice = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
          const verified = await getVerifiedInitialSubscriptionInvoice(currentInvoice);
          if (!verified || verified.payment.id !== exactPayment.id) {
            throw new Error("invalid_embedded_initial_subscription_invoice");
          }
          await processPaidSubmissionWebhook({
            amountPaidCents: verified.payment.amountCents,
            businessSubmissionId: verified.payment.businessSubmissionId,
            currency: currentInvoice.currency,
            eventType: event.type,
            method: "STRIPE_CHECKOUT",
            paymentIntentId: verified.payment.stripePaymentIntentId,
            stripeCustomerId: verified.payment.stripeCustomerId,
            stripeEventId: event.id,
            stripeSubscriptionId: verified.subscription.id,
            stripeSubscriptionStatus: verified.subscription.status,
            stripeCancelAtPeriodEnd: verified.subscription.cancel_at_period_end,
          });
          await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
          return NextResponse.json({ received: true });
        }
      }
      // The first invoice belongs to the Checkout purchase that already made
      // the initial 365-day membership. Only cycle invoices buy a new term.
      if (!subscriptionId || invoice.status !== "paid" || invoice.billing_reason === "subscription_create") {
        await completeStripeWebhookProcessing({ id: webhookLog.id, status: "SKIPPED" });
        return NextResponse.json({ received: true });
      }
      const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
        amountPaidCents: invoice.amount_paid,
        db: tx,
        eventId: event.id,
        invoiceId: invoice.id,
        method: "STRIPE_CHECKOUT",
        paidAt: new Date(invoice.status_transitions.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
        paymentIntentId: (() => {
          const paidPayment = invoice.payments?.data.find((payment) => payment.status === "paid" && payment.payment.type === "payment_intent");
          const paymentIntent = paidPayment?.payment.payment_intent;
          return typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null;
        })(),
        subscriptionId,
      }));
      if (result?.paymentId) {
        await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
        await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
        if (!result.duplicate) await sendMembershipPaymentOutcomeEmail({ membershipId: result.membership.id });
      }
      await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const rawSubscription = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : null;
      if (subscriptionId) {
        await prisma.businessMembership.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: { stripeSubscriptionStatus: "past_due" },
        });
        const membership = await prisma.businessMembership.findFirst({ where: { stripeSubscriptionId: subscriptionId }, select: { id: true } });
        if (membership) await sendMembershipPaymentOutcomeEmail({ failed: true, membershipId: membership.id });
      }
      await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const businessSubmissionId = paymentIntent.metadata?.businessSubmissionId?.trim();
      const paymentFlow = paymentIntent.metadata?.paymentFlow?.trim();

      if (paymentFlow === NO_EMAIL_PAYMENT_FLOW || paymentFlow === EMAIL_MANUAL_PAYMENT_FLOW) {
        const payment = await getVerifiedManualElementPaymentIntent(paymentIntent);
        if (!payment || paymentIntent.amount_received !== payment.amountCents) {
          await completeStripeWebhookProcessing({
            errorMessage: "invalid_manual_element_payment_intent",
            id: webhookLog.id,
            status: "FAILED",
          });
          return NextResponse.json({ error: "invalid_manual_element_payment_intent" }, { status: 400 });
        }
        await processPaidSubmissionWebhook({
          amountPaidCents: payment.amountCents,
          businessSubmissionId: payment.businessSubmissionId,
          currency: paymentIntent.currency,
          eventType: event.type,
          method: "STRIPE_CHECKOUT",
          paymentIntentId: paymentIntent.id,
          stripeEventId: event.id,
        });
        await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      if (businessSubmissionId && paymentFlow === "MEMBERSHIP_RENEWAL_BANK_TRANSFER") {
        const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
          amountPaidCents: paymentIntent.amount_received || paymentIntent.amount || 0,
          businessId: paymentIntent.metadata?.businessId?.trim() || null,
          db: tx,
          eventId: event.id,
          method: "BANK_TRANSFER",
          paidAt: new Date(),
          paymentIntentId: paymentIntent.id,
        }));
        if (result?.paymentId) {
          await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
          await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type });
          if (!result.duplicate) await sendMembershipPaymentOutcomeEmail({ membershipId: result.membership.id });
        }
        await completeStripeWebhookProcessing({ id: webhookLog.id, status: result ? "PROCESSED" : "FAILED" });
        return NextResponse.json({ received: true });
      }

      if (!businessSubmissionId || paymentFlow !== "BANK_TRANSFER") {
        await completeStripeWebhookProcessing({
          id: webhookLog.id,
          status: "SKIPPED",
        });
        return NextResponse.json({ received: true });
      }

      await processPaidSubmissionWebhook({
        amountPaidCents: paymentIntent.amount_received || paymentIntent.amount || 0,
        businessId: paymentIntent.metadata?.businessId?.trim() || null,
        businessSubmissionId,
        currency: paymentIntent.currency,
        eventType: event.type,
        method: "BANK_TRANSFER",
        paymentIntentId: paymentIntent.id,
        stripeEventId: event.id,
      });
      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      // Current Stripe charge events do not include expanded Refund objects.
      // Read the exact charge's refunds so crash recovery uses the same finalizer.
      const chargeRefunds = charge.refunds?.data ?? (await getStripe().refunds.list({ charge: charge.id, limit: 100 })).data;
      const selfService = chargeRefunds.find((refund) => refund.metadata?.salentoRefundType === "initial_membership_14_day");
      if (selfService) {
        await reconcileInitialRefund(selfService, event.id);
        await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      // An operator-created bank Refund may have no Salento metadata. Bind
      // it only to a durable timely support request for this exact payment.
      for (const refund of chargeRefunds) {
        if (await reconcileInitialRefund(refund, event.id)) {
          await completeStripeWebhookProcessing({ id: webhookLog.id, status: "PROCESSED" });
          return NextResponse.json({ received: true });
        }
      }

      if (typeof charge.payment_intent === "string") {
        await markStripePaymentRefunded({
          revokeMembershipEntitlement: charge.amount_refunded >= charge.amount,
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

    if (event.type === "refund.updated" || event.type === "refund.created" || event.type === "refund.failed") {
      const handled = await reconcileInitialRefund(event.data.object, event.id);
      await completeStripeWebhookProcessing({ id: webhookLog.id, status: handled ? "PROCESSED" : "SKIPPED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.dispute.created") {
      // A dispute can still be won. Commission reversal waits for Stripe's
      // authoritative `lost` outcome below rather than pre-emptively taking
      // back an otherwise valid acquisition or renewal commission.
      await completeStripeWebhookProcessing({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.dispute.closed") {
      const dispute = event.data.object;

      if (dispute.status === "lost") {
        const charge = await stripe.charges.retrieve(
          typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id,
        );

        if (typeof charge.payment_intent === "string") {
          await markStripePaymentRefunded({
            revokeMembershipEntitlement: true,
            stripePaymentIntentId: charge.payment_intent,
          });
          await reversePartnerCommissionForPayment({
            eventType: event.type,
            reason: "payment_dispute_lost",
            sourceEventId: event.id,
            stripeChargeId: charge.id,
            stripePaymentIntentId: charge.payment_intent,
          });
        }
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
    const errorMessage = error instanceof Error ? error.message : "webhook_processing_failed";
    console.error("[stripe-webhook] processing failed", {
      errorMessage,
      eventType: event.type,
    });
    await completeStripeWebhookProcessing({
      errorMessage,
      id: webhookLog.id,
      status: "FAILED",
    });
    throw error;
  }

  return NextResponse.json({ received: true });
}
