import type { UserRole } from "@prisma/client";
import type Stripe from "stripe";

import {
  buildStripeCheckoutMetadata,
  getAppUrl,
  getListingPayerEmail,
  getOwnerStripeCheckoutCopy,
  getPartnerUserIdForSubmission,
  getStripeEuBankTransferCountry,
} from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { assertFinancialPaymentAllowed, assertReusableStripeObjectMode, assertStripeObjectMode, getStripe } from "@/lib/stripe";

type Dependencies = { db?: typeof prisma; stripe?: Stripe };

type CheckoutViewer = {
  email?: string | null;
  id: string;
  role: UserRole;
};

type CheckoutSubmission = {
  automaticRenewalAtAcceptance?: boolean | null;
  amountOwedCents: number;
  businessName: string;
  createdBusinessId?: string | null;
  email?: string | null;
  id: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  userId: string;
};

export function buildStripeCheckoutSuccessUrl(params: {
  appUrl: string;
  submissionId: string;
}) {
  return `${params.appUrl.replace(/\/+$/, "")}/publish/payment/success?submission=${encodeURIComponent(
    params.submissionId,
  )}&session={CHECKOUT_SESSION_ID}&locale=it`;
}

export function buildStripeCheckoutCancelUrl(params: {
  appUrl: string;
  submissionId: string;
}) {
  return `${params.appUrl.replace(/\/+$/, "")}/publish/payment/cancel?submission=${encodeURIComponent(
    params.submissionId,
  )}`;
}

export type StripeBankTransferInstructions = {
  accountHolderName: string;
  amountRemainingCents: number;
  bic: string;
  hostedInstructionsUrl: string;
  iban: string;
  reference: string;
};

export type StripeBankTransferSession = {
  instructions: StripeBankTransferInstructions | null;
  paymentIntentId: string;
  status: Stripe.PaymentIntent.Status;
};

export function extractStripeBankTransferInstructions(
  paymentIntent: Stripe.PaymentIntent,
): StripeBankTransferInstructions | null {
  const instructions = paymentIntent.next_action?.display_bank_transfer_instructions;

  if (!instructions) {
    return null;
  }

  const ibanAddress = instructions.financial_addresses?.find(
    (address) => address.type === "iban" && address.iban,
  )?.iban;

  if (!ibanAddress) {
    return null;
  }

  if (
    instructions.amount_remaining == null ||
    !instructions.hosted_instructions_url ||
    !instructions.reference
  ) {
    return null;
  }

  return {
    accountHolderName: ibanAddress.account_holder_name,
    amountRemainingCents: instructions.amount_remaining,
    bic: ibanAddress.bic,
    hostedInstructionsUrl: instructions.hosted_instructions_url,
    iban: ibanAddress.iban,
    reference: instructions.reference,
  };
}

export async function ensureStripeCheckoutSession(params: {
  appUrl?: string | null;
  submission: CheckoutSubmission;
  viewer: CheckoutViewer;
}, dependencies: Dependencies = {}) {
  assertFinancialPaymentAllowed();
  const stripe = dependencies.stripe ?? getStripe();
  const db = dependencies.db ?? prisma;
  const appUrl = params.appUrl?.trim().replace(/\/+$/, "") || getAppUrl();
  const ownerCheckoutCopy = getOwnerStripeCheckoutCopy(params.submission.businessName);
  const customerEmail = getListingPayerEmail({
    ownerEmail: params.submission.ownerEmail,
    submissionUserId: params.submission.userId,
    viewer: params.viewer,
  });
  const latestPendingPayment = await db.payment.findFirst({
    where: {
      businessSubmissionId: params.submission.id,
      method: "STRIPE_CHECKOUT",
      status: "PENDING_PAYMENT",
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      stripeCheckoutSessionId: true,
      stripeLivemode: true,
    },
  });

  if (latestPendingPayment?.stripeCheckoutSessionId) {
    assertReusableStripeObjectMode(latestPendingPayment.stripeLivemode);
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(
        latestPendingPayment.stripeCheckoutSessionId,
      );
      assertStripeObjectMode(existingSession.livemode);

      if (
        existingSession.url &&
        existingSession.status === "open" &&
        (!existingSession.expires_at || existingSession.expires_at * 1000 > Date.now()) &&
        (existingSession.customer_email?.trim() || undefined) === customerEmail
      ) {
        return {
          id: existingSession.id,
          url: existingSession.url,
        };
      }

      if (existingSession.status === "open") {
        await stripe.checkout.sessions.expire(existingSession.id);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "stripe_payment_mode_mismatch") throw error;
      // Fall through and create a fresh session if Stripe no longer recognizes the old one.
    }
  }

  const automaticRenewal = Boolean(params.submission.automaticRenewalAtAcceptance);
  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: buildStripeCheckoutCancelUrl({
      appUrl,
      submissionId: params.submission.id,
    }),
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            description: ownerCheckoutCopy.description,
            name: ownerCheckoutCopy.name,
          },
          ...(automaticRenewal ? { recurring: { interval: "year" as const } } : {}),
          unit_amount: params.submission.amountOwedCents,
        },
        quantity: 1,
      },
    ],
    locale: "it",
    metadata: buildStripeCheckoutMetadata({
      businessId: params.submission.createdBusinessId,
      businessSubmissionId: params.submission.id,
      partnerId: getPartnerUserIdForSubmission(params.viewer),
      paymentFlow: "CHECKOUT",
      automaticRenewal,
      userId: params.submission.userId,
    }),
    mode: automaticRenewal ? "subscription" : "payment",
    ...(automaticRenewal ? { subscription_data: { metadata: buildStripeCheckoutMetadata({
      businessId: params.submission.createdBusinessId,
      businessSubmissionId: params.submission.id,
      partnerId: getPartnerUserIdForSubmission(params.viewer),
      paymentFlow: "CHECKOUT",
      automaticRenewal: true,
      userId: params.submission.userId,
    }) } } : {}),
    success_url: buildStripeCheckoutSuccessUrl({
      appUrl,
      submissionId: params.submission.id,
    }),
  });
  assertStripeObjectMode(checkoutSession.livemode);

  if (latestPendingPayment) {
    await db.payment.update({
      where: {
        id: latestPendingPayment.id,
      },
      data: {
        amountCents: params.submission.amountOwedCents,
        businessId: params.submission.createdBusinessId,
        currency: checkoutSession.currency || "eur",
        stripeCheckoutSessionId: checkoutSession.id,
        stripeLivemode: checkoutSession.livemode,
      },
    });
  } else {
    await db.payment.create({
      data: {
        amountCents: params.submission.amountOwedCents,
        businessId: params.submission.createdBusinessId,
        businessSubmissionId: params.submission.id,
        currency: checkoutSession.currency || "eur",
        method: "STRIPE_CHECKOUT",
        partnerUserId: getPartnerUserIdForSubmission(params.viewer),
        status: "PENDING_PAYMENT",
        stripeCheckoutSessionId: checkoutSession.id,
        stripeLivemode: checkoutSession.livemode,
        userId: params.submission.userId,
      },
    });
  }

  return {
    id: checkoutSession.id,
    url: checkoutSession.url,
  };
}

export async function ensureStripeBankTransferIntent(params: {
  submission: CheckoutSubmission;
  viewer: CheckoutViewer;
  idempotencyKey?: string;
}, dependencies: Dependencies = {}) : Promise<StripeBankTransferSession> {
  assertFinancialPaymentAllowed();
  const stripe = dependencies.stripe ?? getStripe();
  const db = dependencies.db ?? prisma;
  const latestPendingPayment = await db.payment.findFirst({
    where: {
      businessSubmissionId: params.submission.id,
      method: "BANK_TRANSFER",
      status: "AWAITING_BANK_TRANSFER",
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      stripePaymentIntentId: true,
      stripeLivemode: true,
    },
  });

  if (latestPendingPayment?.stripePaymentIntentId) {
    assertReusableStripeObjectMode(latestPendingPayment.stripeLivemode);
    let existingIntent: Stripe.PaymentIntent | null = null;
    try {
      existingIntent = await stripe.paymentIntents.retrieve(
        latestPendingPayment.stripePaymentIntentId,
      );
      assertStripeObjectMode(existingIntent.livemode);
    } catch (error) {
      if (error instanceof Error && error.message === "stripe_payment_mode_mismatch") throw error;
      // Fall through and create a fresh payment intent if Stripe no longer recognizes the old one.
    }
    if (existingIntent) {
      const instructions = extractStripeBankTransferInstructions(existingIntent);

      // A previously-created intent can gain its bank details after the first
      // request. Keep the persisted reference in step with Stripe so returning
      // to the payment page never has to invent a placeholder reference.
      if (instructions?.reference) {
        await db.$transaction([
          db.payment.update({
            where: {
              id: latestPendingPayment.id,
            },
            data: {
              bankTransferReference: instructions.reference,
            },
          }),
          db.businessSubmission.update({
            where: {
              id: params.submission.id,
            },
            data: {
              bankTransferReference: instructions.reference,
            },
          }),
        ]);
      }

      return {
        instructions,
        paymentIntentId: existingIntent.id,
        status: existingIntent.status,
      };
    }
  }

  const customer = await stripe.customers.create({
    email: getListingPayerEmail({
      ownerEmail: params.submission.ownerEmail,
      submissionUserId: params.submission.userId,
      viewer: params.viewer,
    }),
    metadata: {
      businessSubmissionId: params.submission.id,
      userId: params.submission.userId,
    },
    name: params.submission.ownerName || params.submission.businessName,
    phone: params.submission.ownerPhone || undefined,
  }, params.idempotencyKey ? { idempotencyKey: `${params.idempotencyKey}:customer` } : undefined);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.submission.amountOwedCents,
    confirm: true,
    currency: "eur",
    customer: customer.id,
    description: `Salento Local listing: ${params.submission.businessName}`,
    metadata: buildStripeCheckoutMetadata({
      businessId: params.submission.createdBusinessId,
      businessSubmissionId: params.submission.id,
      partnerId: getPartnerUserIdForSubmission(params.viewer),
      paymentFlow: "BANK_TRANSFER",
      userId: params.submission.userId,
    }),
    payment_method_data: {
      type: "customer_balance",
    },
    payment_method_options: {
      customer_balance: {
        bank_transfer: {
          eu_bank_transfer: {
            country: getStripeEuBankTransferCountry(),
          },
          requested_address_types: ["iban"],
          type: "eu_bank_transfer",
        },
        funding_type: "bank_transfer",
      },
    },
    payment_method_types: ["customer_balance"],
  }, params.idempotencyKey ? { idempotencyKey: `${params.idempotencyKey}:intent` } : undefined);
  assertStripeObjectMode(paymentIntent.livemode);

  const instructions = extractStripeBankTransferInstructions(paymentIntent);

  if (latestPendingPayment) {
    await db.payment.update({
      where: {
        id: latestPendingPayment.id,
      },
      data: {
        amountCents: params.submission.amountOwedCents,
        bankTransferReference: instructions?.reference ?? null,
        businessId: params.submission.createdBusinessId,
        currency: paymentIntent.currency || "eur",
        stripePaymentIntentId: paymentIntent.id,
        stripeLivemode: paymentIntent.livemode,
      },
    });
  } else {
    await db.payment.create({
      data: {
        ...(params.idempotencyKey ? { id: `initial-bank:${params.submission.id}` } : {}),
        amountCents: params.submission.amountOwedCents,
        bankTransferReference: instructions?.reference ?? null,
        businessId: params.submission.createdBusinessId,
        businessSubmissionId: params.submission.id,
        currency: paymentIntent.currency || "eur",
        method: "BANK_TRANSFER",
        partnerUserId: getPartnerUserIdForSubmission(params.viewer),
        status: "AWAITING_BANK_TRANSFER",
        stripePaymentIntentId: paymentIntent.id,
        stripeLivemode: paymentIntent.livemode,
        userId: params.submission.userId,
      },
    });
  }

  if (instructions?.reference) {
    await db.businessSubmission.update({
      where: {
        id: params.submission.id,
      },
      data: {
        bankTransferReference: instructions.reference,
      },
    });
  }

  return {
    instructions,
    paymentIntentId: paymentIntent.id,
    status: paymentIntent.status,
  };
}
