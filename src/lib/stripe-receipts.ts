import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";

type StripeReceiptReference = {
  stripeCheckoutSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
};

function getStripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function getInvoiceUrl(invoice: Stripe.Invoice | null | undefined) {
  return invoice?.hosted_invoice_url || invoice?.invoice_pdf || null;
}

/**
 * Resolves the Stripe-hosted receipt or invoice only when requested. Checkout
 * Session and PaymentIntent IDs are the durable references retained on Payment.
 */
export async function getStripeHostedReceiptUrl(
  payment: StripeReceiptReference,
  dependencies: { stripe?: Pick<Stripe, "charges" | "checkout" | "invoices" | "paymentIntents"> } = {},
): Promise<string | null> {
  const invoiceId = payment.stripeInvoiceId?.trim();
  const sessionId = payment.stripeCheckoutSessionId?.trim();
  let paymentIntentId = payment.stripePaymentIntentId?.trim() || null;

  try {
    const stripe = dependencies.stripe ?? getStripe();

    // Subscription renewals persist their invoice directly on Payment. It is
    // the strongest possible receipt identity and must be checked before a
    // Checkout Session or a PaymentIntent can be considered.
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const invoiceUrl = getInvoiceUrl(invoice);
      if (invoiceUrl) return invoiceUrl;
    }

    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["invoice", "payment_intent.latest_charge"],
      });
      const invoiceUrl = getInvoiceUrl(
        typeof session.invoice === "string" ? null : session.invoice,
      );

      if (invoiceUrl) return invoiceUrl;

      paymentIntentId ||= getStripeId(session.payment_intent);
      const expandedCharge =
        typeof session.payment_intent === "string"
          ? null
          : session.payment_intent?.latest_charge;
      const receiptUrl =
        typeof expandedCharge === "string" ? null : expandedCharge?.receipt_url;

      if (receiptUrl) return receiptUrl;
    }

    if (!paymentIntentId) return null;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = paymentIntent.latest_charge;

    if (!charge) return null;
    if (typeof charge !== "string") return charge.receipt_url || null;

    return (await stripe.charges.retrieve(charge)).receipt_url || null;
  } catch {
    // Older Stripe records can lack a hosted receipt without invalidating the
    // paid listing or Salento Local's existing receipt record.
    return null;
  }
}
