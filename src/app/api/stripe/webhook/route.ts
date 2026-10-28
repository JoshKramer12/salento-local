import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ensurePartnerRefundRepurchaseCommissionForPayment, ensurePartnerRenewalCommissionForPayment, reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { assertStripeObjectMode, getStripe, isPublicFinancialHold } from "@/lib/stripe";
import { markStripePaymentRefunded } from "@/lib/stripe-payment-sync";
import { finalizeMembershipRenewalPayment, getVerifiedRenewalInvoiceIntentId } from "@/lib/membership-renewal";
import { prisma } from "@/lib/prisma";
import { attemptMembershipPaymentOutcomeDelivery } from "@/lib/membership-payment-outcomes";
import { attemptMembershipFailedPaymentDelivery, recordMembershipInvoiceFailure } from "@/lib/membership-failed-payments";
import { processPaidSubmissionWebhook } from "@/lib/stripe-payment-webhook";
import {
  beginStripeWebhookProcessing,
  completeStripeWebhookProcessing,
} from "@/lib/stripe-webhook-log";
import { normalizeEnvValue } from "@/lib/env";
import { EMAIL_MANUAL_PAYMENT_FLOW, getVerifiedManualElementPaymentIntent, NO_EMAIL_PAYMENT_FLOW } from "@/lib/no-email-payment";
import { getVerifiedInitialSubscriptionInvoice, MEMBERSHIP_SUBSCRIPTION_FLOW } from "@/lib/embedded-subscription";
import { MEMBERSHIP_ELEMENT_FLOW, syncMembershipElementPayment } from "@/lib/membership-element-payment";
import { reconcileInitialRefund } from "@/lib/self-service-refunds";
import { LISTING_OFFER } from "@/lib/listing-offer";
import { verifyBankRenewalAssociation, verifyCheckoutRenewalAssociation } from "@/lib/stripe-renewal-webhook";

function safeWebhookError(error: unknown) {
  const message = error instanceof Error ? error.message : "webhook_processing_failed";
  return /^[a-z][a-z0-9_]{2,100}$/.test(message) ? message : "webhook_processing_failed";
}

function revalidatePartnerViewsAfterFinancialCommit() {
  try {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");
    revalidatePath("/dashboard/earnings");
    revalidatePath("/dashboard/admin/users");
  } catch {
    // A cache failure must not turn a committed payment into a failed webhook.
    console.error("[stripe-webhook] partner cache revalidation unavailable");
  }
}

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

  try {
    assertStripeObjectMode(event.livemode);
  } catch {
    return NextResponse.json({ error: "stripe_payment_mode_mismatch" }, { status: 400 });
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
  if (webhookLog.inProgress) {
    return NextResponse.json({ error: "webhook_processing_in_progress" }, { status: 503 });
  }
  const complete = (params: Omit<Parameters<typeof completeStripeWebhookProcessing>[0], "attemptCount">) =>
    completeStripeWebhookProcessing({ ...params, attemptCount: webhookLog.attemptCount });

  if (isPublicFinancialHold() && !event.livemode &&
    ["checkout.session.completed", "invoice.paid", "payment_intent.succeeded"].includes(event.type)) {
    await complete({ id: webhookLog.id, status: "SKIPPED" });
    return NextResponse.json({ received: true, sandboxFinancialHold: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const paymentFlow = session.metadata?.paymentFlow?.trim();
      const businessSubmissionId = session.metadata?.businessSubmissionId?.trim();
      const userId = session.metadata?.userId?.trim();
      const businessId = session.metadata?.businessId?.trim() || null;

      if (paymentFlow === "MEMBERSHIP_RENEWAL") {
        await verifyCheckoutRenewalAssociation(session);
        const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
          amountPaidCents: session.amount_total ?? 0,
          automaticRenewal: session.metadata?.automaticRenewal === "true",
          businessId,
          db: tx,
          eventId: event.id,
          method: "STRIPE_CHECKOUT",
          paidAt: new Date(),
          paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          stripeLivemode: event.livemode,
          sessionId: session.id,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
          subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
        }));
        if (!result?.paymentId) throw new Error("renewal_membership_unavailable");
        if (result?.paymentId) {
          await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
          await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
          await attemptMembershipPaymentOutcomeDelivery(result.paymentId);
        }
        await complete({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      if (!businessSubmissionId || !userId) {
        await complete({
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
        stripeLivemode: event.livemode,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: subscription?.status ?? null,
      });
      await complete({
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
        if (invoice.parent?.subscription_details?.metadata?.paymentFlow === MEMBERSHIP_SUBSCRIPTION_FLOW) {
          const paymentId = invoice.parent.subscription_details.metadata.paymentId;
          const payment = paymentId ? await prisma.payment.findUnique({ where: { id: paymentId } }) : null;
          if (!payment || payment.stripeInvoiceId !== invoice.id || payment.stripeSubscriptionId !== subscriptionId) {
            // Retry if Stripe delivered before the setup response was persisted.
            throw new Error("membership_element_invoice_association_pending");
          }
          const result = await syncMembershipElementPayment(payment.id, { eventId: event.id, eventType: event.type });
          if (!result) throw new Error("membership_element_invoice_not_confirmed");
          await complete({ id: webhookLog.id, status: "PROCESSED" });
          return NextResponse.json({ received: true });
        }
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
            stripeLivemode: event.livemode,
            stripeSubscriptionId: verified.subscription.id,
            stripeSubscriptionStatus: verified.subscription.status,
            stripeCancelAtPeriodEnd: verified.subscription.cancel_at_period_end,
          });
          await complete({ id: webhookLog.id, status: "PROCESSED" });
          return NextResponse.json({ received: true });
        }
      }
      // The first invoice belongs to the Checkout purchase that already made
      // the initial 365-day membership. Only cycle invoices buy a new term.
      if (!subscriptionId || invoice.status !== "paid" || invoice.billing_reason === "subscription_create") {
        await complete({ id: webhookLog.id, status: "SKIPPED" });
        return NextResponse.json({ received: true });
      }
      // Stripe's invoice.paid snapshot omits the `payments` collection. Read
      // the current invoice so the exact charge remains attached to the term
      // and can later be matched to a refund or dispute.
      const currentInvoice = await stripe.invoices.retrieve(invoice.id, { expand: ["payments"] });
      const { intentId: paymentIntentId, customerId } = getVerifiedRenewalInvoiceIntentId({
        currentInvoice, eventInvoice: invoice, subscriptionId,
      });
      const paidIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paidIntent.status !== "succeeded" ||
        paidIntent.amount_received !== currentInvoice.amount_paid ||
        paidIntent.currency !== currentInvoice.currency || paidIntent.customer !== customerId) {
        throw new Error("renewal_invoice_payment_identity_unavailable");
      }
      const memberships = await prisma.businessMembership.findMany({
        where: { stripeSubscriptionId: subscriptionId }, select: { stripeCustomerId: true }, take: 2,
      });
      if (memberships.length !== 1 || memberships[0].stripeCustomerId !== customerId) {
        throw new Error("renewal_invoice_membership_association_missing");
      }
      const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
        amountPaidCents: currentInvoice.amount_paid,
        db: tx,
        eventId: event.id,
        invoiceId: invoice.id,
        method: "STRIPE_CHECKOUT",
        paidAt: new Date(invoice.status_transitions.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
        paymentIntentId,
        stripeLivemode: event.livemode,
        subscriptionId,
      }));
      if (!result?.paymentId) throw new Error("renewal_invoice_membership_unavailable");
      if (result?.paymentId) {
        await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
        await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
        await attemptMembershipPaymentOutcomeDelivery(result.paymentId);
      }
      await complete({ id: webhookLog.id, status: "PROCESSED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const rawSubscription = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : null;
      if (subscriptionId) {
        const result = await recordMembershipInvoiceFailure(invoice.id, subscriptionId);
        if (result === "recorded") await attemptMembershipFailedPaymentDelivery(invoice.id);
      }
      await complete({ id: webhookLog.id, status: "PROCESSED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const businessSubmissionId = paymentIntent.metadata?.businessSubmissionId?.trim();
      const paymentFlow = paymentIntent.metadata?.paymentFlow?.trim();

      if (paymentFlow === MEMBERSHIP_ELEMENT_FLOW) {
        const result = await syncMembershipElementPayment(paymentIntent.metadata.paymentId, { eventId: event.id, eventType: event.type });
        if (!result) throw new Error("membership_element_intent_not_confirmed");
        await complete({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      if (paymentFlow === NO_EMAIL_PAYMENT_FLOW || paymentFlow === EMAIL_MANUAL_PAYMENT_FLOW) {
        const payment = await getVerifiedManualElementPaymentIntent(paymentIntent);
        if (!payment || paymentIntent.amount_received !== payment.amountCents) {
          await complete({
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
          stripeLivemode: event.livemode,
        });
        await complete({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      if (paymentFlow === "MEMBERSHIP_RENEWAL_BANK_TRANSFER") {
        if (paymentIntent.status !== "succeeded" || paymentIntent.amount_received !== LISTING_OFFER.renewalPriceCents ||
          paymentIntent.currency !== "eur" || !paymentIntent.payment_method_types?.includes("customer_balance")) {
          throw new Error("renewal_bank_transfer_payment_unverified");
        }
        await verifyBankRenewalAssociation(paymentIntent);
        const result = await prisma.$transaction((tx) => finalizeMembershipRenewalPayment({
          amountPaidCents: paymentIntent.amount_received || paymentIntent.amount || 0,
          businessId: paymentIntent.metadata?.businessId?.trim() || null,
          db: tx,
          eventId: event.id,
          method: "BANK_TRANSFER",
          paidAt: new Date(),
          paymentIntentId: paymentIntent.id,
          stripeLivemode: event.livemode,
        }));
        if (!result?.paymentId) throw new Error("renewal_membership_unavailable");
        if (result?.paymentId) {
          await ensurePartnerRenewalCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
          await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: result.paymentId, sourceEventId: event.id, sourceEventType: event.type }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
          await attemptMembershipPaymentOutcomeDelivery(result.paymentId);
        }
        await complete({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      if (!businessSubmissionId || paymentFlow !== "BANK_TRANSFER") {
        await complete({
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
        stripeLivemode: event.livemode,
      });
      await complete({
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
        await complete({ id: webhookLog.id, status: "PROCESSED" });
        return NextResponse.json({ received: true });
      }

      // An operator-created bank Refund may have no Salento metadata. Bind
      // it only to a durable timely support request for this exact payment.
      for (const refund of chargeRefunds) {
        if (await reconcileInitialRefund(refund, event.id)) {
          await complete({ id: webhookLog.id, status: "PROCESSED" });
          return NextResponse.json({ received: true });
        }
      }

      if (typeof charge.payment_intent === "string") {
        await markStripePaymentRefunded({
          revalidatePaths: false,
          revokeMembershipEntitlement: charge.amount_refunded >= charge.amount,
          stripePaymentIntentId: charge.payment_intent,
        });
        await reversePartnerCommissionForPayment({
          eventType: event.type,
          reason: "payment_refunded",
          sourceEventId: event.id,
          stripeChargeId: charge.id,
          stripePaymentIntentId: charge.payment_intent,
        }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
      }

      await complete({
        id: webhookLog.id,
        status: "PROCESSED",
      });
      return NextResponse.json({ received: true });
    }

    if (event.type === "refund.updated" || event.type === "refund.created" || event.type === "refund.failed") {
      const handled = await reconcileInitialRefund(event.data.object, event.id);
      await complete({ id: webhookLog.id, status: handled ? "PROCESSED" : "SKIPPED" });
      return NextResponse.json({ received: true });
    }

    if (event.type === "charge.dispute.created") {
      // A dispute can still be won. Commission reversal waits for Stripe's
      // authoritative `lost` outcome below rather than pre-emptively taking
      // back an otherwise valid acquisition or renewal commission.
      await complete({
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
            revalidatePaths: false,
            revokeMembershipEntitlement: true,
            stripePaymentIntentId: charge.payment_intent,
          });
          await reversePartnerCommissionForPayment({
            eventType: event.type,
            reason: "payment_dispute_lost",
            sourceEventId: event.id,
            stripeChargeId: charge.id,
            stripePaymentIntentId: charge.payment_intent,
          }, { revalidatePaths: revalidatePartnerViewsAfterFinancialCommit });
        }
      }

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
    const errorMessage = safeWebhookError(error);
    console.error("[stripe-webhook] processing failed", {
      errorMessage,
      eventType: event.type,
    });
    await complete({
      errorMessage,
      id: webhookLog.id,
      status: "FAILED",
    });
    return NextResponse.json({ error: errorMessage }, { status: 503 });
  }

  return NextResponse.json({ received: true });
}
