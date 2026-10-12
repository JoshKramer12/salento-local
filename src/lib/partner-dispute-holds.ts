import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/** Always read the current provider object. Delivery order is not dispute order. */
export async function reconcilePartnerPaymentDispute(
  disputeId: string,
  dependencies: { stripe?: Stripe; db?: typeof prisma } = {},
) {
  const stripe = dependencies.stripe ?? getStripe();
  const db = dependencies.db ?? prisma;
  const dispute = await stripe.disputes.retrieve(disputeId);
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) throw new Error("dispute_charge_missing");
  const charge = await stripe.charges.retrieve(chargeId);
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!paymentIntentId) throw new Error("dispute_payment_intent_missing");

  const payments = await db.payment.findMany({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
    take: 2,
  });
  if (payments.length !== 1) throw new Error("dispute_payment_attribution_unresolved");
  const paymentId = payments[0].id;
  const existing = await db.partnerPaymentDispute.findUnique({ where: { stripeDisputeId: dispute.id } });
  if (existing && (existing.paymentId !== paymentId || existing.stripeChargeId !== chargeId)) {
    throw new Error("dispute_payment_attribution_conflict");
  }
  // A previously observed lost outcome cannot be released by a conflicting
  // provider response. It requires explicit operator reconciliation.
  if (existing?.status === "lost" && dispute.status !== "lost") {
    throw new Error("dispute_terminal_outcome_conflict");
  }

  const observedAt = new Date();
  const holdActive = dispute.status !== "won";
  await db.partnerPaymentDispute.upsert({
    where: { stripeDisputeId: dispute.id },
    create: {
      paymentId,
      stripeDisputeId: dispute.id,
      stripeChargeId: chargeId,
      status: dispute.status,
      holdActive,
      observedAt,
      resolvedAt: holdActive ? null : observedAt,
    },
    update: {
      status: dispute.status,
      holdActive,
      observedAt,
      resolvedAt: holdActive ? null : existing?.resolvedAt ?? observedAt,
    },
  });

  return { chargeId, paymentId, paymentIntentId, status: dispute.status };
}
