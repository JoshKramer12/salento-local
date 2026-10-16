import type Stripe from "stripe";

import { LISTING_OFFER } from "@/lib/listing-offer";
import { prisma } from "@/lib/prisma";
import { getStripe, isStripeSandboxMode } from "@/lib/stripe";

type Recovery = { state: "none" } | { state: "blocked" } | { state: "ready"; url: string };

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id ?? null;
}

/** Inspect the existing subscription. An unresolved invoice blocks any second renewal. */
export async function inspectMembershipRenewalRecovery(businessId: string, dependencies: {
  stripe?: Stripe;
  db?: typeof prisma;
  sandbox?: boolean;
} = {}): Promise<Recovery> {
  const db = dependencies.db ?? prisma;
  const membership = await db.businessMembership.findUnique({ where: { businessId } });
  if (!membership?.automaticRenewal || !membership.stripeSubscriptionId ||
    !membership.stripeCustomerId || membership.entitlementRevokedAt) return { state: "none" };

  const stripe = dependencies.stripe ?? getStripe();
  const subscription = await stripe.subscriptions.retrieve(membership.stripeSubscriptionId);
  if (subscription.id !== membership.stripeSubscriptionId ||
    stripeId(subscription.customer) !== membership.stripeCustomerId ||
    subscription.livemode === (dependencies.sandbox ?? isStripeSandboxMode())) {
    return { state: "blocked" };
  }
  if (!["past_due", "unpaid"].includes(subscription.status)) return { state: "none" };
  if (subscription.cancel_at_period_end) return { state: "blocked" };
  const invoiceId = stripeId(subscription.latest_invoice);
  if (!invoiceId) return { state: "blocked" };
  const invoice = await stripe.invoices.retrieve(invoiceId);
  if (invoice.status === "paid") return { state: "none" };
  if (invoice.id !== invoiceId || invoice.status !== "open" ||
    stripeId(invoice.customer) !== membership.stripeCustomerId ||
    stripeId(invoice.parent?.subscription_details?.subscription) !== subscription.id ||
    invoice.billing_reason !== "subscription_cycle" ||
    invoice.collection_method !== "charge_automatically" ||
    invoice.currency !== "eur" || invoice.amount_due !== LISTING_OFFER.renewalPriceCents ||
    invoice.livemode !== subscription.livemode ||
    subscription.payment_settings?.save_default_payment_method !== "on_subscription") {
    return { state: "blocked" };
  }
  if (!invoice.hosted_invoice_url) return { state: "blocked" };
  try {
    const url = new URL(invoice.hosted_invoice_url);
    if (url.protocol === "https:" && url.hostname === "invoice.stripe.com") {
      return { state: "ready", url: url.toString() };
    }
  } catch { /* Fail closed if Stripe has no usable hosted invoice URL. */ }
  return { state: "blocked" };
}
