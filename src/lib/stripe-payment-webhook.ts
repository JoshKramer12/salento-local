import type { PaymentRecordMethod } from "@prisma/client";

import { ensurePartnerCommissionForSubmission } from "@/lib/partner-ledger";
import { attemptPartnerCommissionConfirmationForSubmission, ensurePartnerCommissionConfirmationDeliveryForSubmission } from "@/lib/partner-commission-confirmations";
import { sendPurchaseConfirmationForSubmission } from "@/lib/receipts";
import { attemptPurchaseConfirmationDeliveryForSubmission, ensurePurchaseConfirmationDeliveryForSubmission } from "@/lib/purchase-confirmation-delivery";
import { syncStripePaymentFromWebhook } from "@/lib/stripe-payment-sync";

type PaidSubmissionWebhookParams = {
  amountPaidCents: number;
  businessId?: string | null;
  businessSubmissionId: string;
  currency?: string | null;
  eventType: string;
  method: PaymentRecordMethod;
  paymentIntentId?: string | null;
  sessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeEventId: string;
  stripeLivemode?: boolean;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
};

type PaidSubmissionWebhookDependencies = {
  attemptPartnerCommissionConfirmationForSubmission: typeof attemptPartnerCommissionConfirmationForSubmission;
  ensurePartnerCommissionConfirmationDeliveryForSubmission: typeof ensurePartnerCommissionConfirmationDeliveryForSubmission;
  ensurePartnerCommissionForSubmission: typeof ensurePartnerCommissionForSubmission;
  sendPurchaseConfirmationForSubmission: typeof sendPurchaseConfirmationForSubmission;
  ensurePurchaseConfirmationDeliveryForSubmission: typeof ensurePurchaseConfirmationDeliveryForSubmission;
  attemptPurchaseConfirmationDeliveryForSubmission: typeof attemptPurchaseConfirmationDeliveryForSubmission;
  syncStripePaymentFromWebhook: typeof syncStripePaymentFromWebhook;
};

/**
 * Authoritative paid-listing lifecycle. Payment/publication and commission are
 * persisted before notification. Owner email failures remain in a durable
 * delivery record and do not invalidate completed financial processing.
 */
export async function processPaidSubmissionWebhook(
  params: PaidSubmissionWebhookParams,
  dependencies: Partial<PaidSubmissionWebhookDependencies> = {},
) {
  const syncPayment =
    dependencies.syncStripePaymentFromWebhook ?? syncStripePaymentFromWebhook;
  const ensureCommission =
    dependencies.ensurePartnerCommissionForSubmission ??
    ensurePartnerCommissionForSubmission;
  const sendOwnerEmail =
    dependencies.sendPurchaseConfirmationForSubmission ??
    sendPurchaseConfirmationForSubmission;

  const payment = await syncPayment({
    amountPaidCents: params.amountPaidCents,
    businessId: params.businessId,
    businessSubmissionId: params.businessSubmissionId,
    currency: params.currency,
    method: params.method,
    paymentIntentId: params.paymentIntentId,
    sessionId: params.sessionId,
    stripeCustomerId: params.stripeCustomerId,
    stripeCancelAtPeriodEnd: params.stripeCancelAtPeriodEnd,
    stripeEventId: params.stripeEventId,
    stripeLivemode: params.stripeLivemode,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripeSubscriptionStatus: params.stripeSubscriptionStatus,
  });
  await ensureCommission({
    businessSubmissionId: params.businessSubmissionId,
    sourceEventId: params.stripeEventId,
    sourceEventType: params.eventType,
  });
  await (dependencies.ensurePartnerCommissionConfirmationDeliveryForSubmission ??
    ensurePartnerCommissionConfirmationDeliveryForSubmission)(params.businessSubmissionId);
  await (dependencies.attemptPartnerCommissionConfirmationForSubmission ??
    attemptPartnerCommissionConfirmationForSubmission)(params.businessSubmissionId);
  const deliveryId = await (dependencies.ensurePurchaseConfirmationDeliveryForSubmission ??
    ensurePurchaseConfirmationDeliveryForSubmission)(params.businessSubmissionId);
  const ownerEmailSent = deliveryId ? (await (dependencies.attemptPurchaseConfirmationDeliveryForSubmission ??
    attemptPurchaseConfirmationDeliveryForSubmission)(params.businessSubmissionId, {
      sendConfirmation: sendOwnerEmail,
    })) === "accepted" : false;

  return { ownerEmailSent, payment };
}
