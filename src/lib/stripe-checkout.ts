import type { UserRole } from "@prisma/client";
import type Stripe from "stripe";

import { getCurrentLocale } from "@/lib/locale";
import {
  buildStripeCheckoutMetadata,
  getAppUrl,
  getListingPayerEmail,
  getPartnerUserIdForSubmission,
  getReviewAfterPaymentCopy,
  getStripeEuBankTransferCountry,
} from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

type CheckoutViewer = {
  email?: string | null;
  id: string;
  role: UserRole;
};

type CheckoutSubmission = {
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

export type StripeBankTransferInstructions = {
  accountHolderName: string;
  amountRemainingCents: number;
  bic: string;
  hostedInstructionsUrl: string;
  iban: string;
  reference: string;
};

type StripeBankTransferSession = {
  instructions: StripeBankTransferInstructions | null;
  paymentIntentId: string;
  status: Stripe.PaymentIntent.Status;
};

function extractStripeBankTransferInstructions(
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
  submission: CheckoutSubmission;
  viewer: CheckoutViewer;
}) {
  const locale = await getCurrentLocale();
  const stripe = getStripe();
  const appUrl = getAppUrl();
  const customerEmail = getListingPayerEmail({
    ownerEmail: params.submission.ownerEmail,
    submissionUserId: params.submission.userId,
    viewer: params.viewer,
  });
  const latestPendingPayment = await prisma.payment.findFirst({
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
    },
  });

  if (latestPendingPayment?.stripeCheckoutSessionId) {
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(
        latestPendingPayment.stripeCheckoutSessionId,
      );

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
    } catch {
      // Fall through and create a fresh session if Stripe no longer recognizes the old one.
    }
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    cancel_url: `${appUrl}/publish/payment/cancel?submission=${encodeURIComponent(params.submission.id)}`,
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            description: getReviewAfterPaymentCopy(locale),
            name:
              locale === "it"
                ? `Scheda Salento Local: ${params.submission.businessName}`
                : `Salento Local listing: ${params.submission.businessName}`,
          },
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
      userId: params.submission.userId,
    }),
    mode: "payment",
    success_url: `${appUrl}/publish/payment/success?submission=${encodeURIComponent(params.submission.id)}&session={CHECKOUT_SESSION_ID}&locale=it`,
  });

  if (latestPendingPayment) {
    await prisma.payment.update({
      where: {
        id: latestPendingPayment.id,
      },
      data: {
        amountCents: params.submission.amountOwedCents,
        businessId: params.submission.createdBusinessId,
        currency: checkoutSession.currency || "eur",
        stripeCheckoutSessionId: checkoutSession.id,
      },
    });
  } else {
    await prisma.payment.create({
      data: {
        amountCents: params.submission.amountOwedCents,
        businessId: params.submission.createdBusinessId,
        businessSubmissionId: params.submission.id,
        currency: checkoutSession.currency || "eur",
        method: "STRIPE_CHECKOUT",
        partnerUserId: getPartnerUserIdForSubmission(params.viewer),
        status: "PENDING_PAYMENT",
        stripeCheckoutSessionId: checkoutSession.id,
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
}) : Promise<StripeBankTransferSession> {
  const stripe = getStripe();
  const latestPendingPayment = await prisma.payment.findFirst({
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
    },
  });

  if (latestPendingPayment?.stripePaymentIntentId) {
    try {
      const existingIntent = await stripe.paymentIntents.retrieve(
        latestPendingPayment.stripePaymentIntentId,
      );
      const instructions = extractStripeBankTransferInstructions(existingIntent);

      // A previously-created intent can gain its bank details after the first
      // request. Keep the persisted reference in step with Stripe so returning
      // to the payment page never has to invent a placeholder reference.
      if (instructions?.reference) {
        await prisma.$transaction([
          prisma.payment.update({
            where: {
              id: latestPendingPayment.id,
            },
            data: {
              bankTransferReference: instructions.reference,
            },
          }),
          prisma.businessSubmission.update({
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
    } catch {
      // Fall through and create a fresh payment intent if Stripe no longer recognizes the old one.
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
  });

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
  });

  const instructions = extractStripeBankTransferInstructions(paymentIntent);

  if (latestPendingPayment) {
    await prisma.payment.update({
      where: {
        id: latestPendingPayment.id,
      },
      data: {
        amountCents: params.submission.amountOwedCents,
        bankTransferReference: instructions?.reference ?? null,
        businessId: params.submission.createdBusinessId,
        currency: paymentIntent.currency || "eur",
        stripePaymentIntentId: paymentIntent.id,
      },
    });
  } else {
    await prisma.payment.create({
      data: {
        amountCents: params.submission.amountOwedCents,
        bankTransferReference: instructions?.reference ?? null,
        businessId: params.submission.createdBusinessId,
        businessSubmissionId: params.submission.id,
        currency: paymentIntent.currency || "eur",
        method: "BANK_TRANSFER",
        partnerUserId: getPartnerUserIdForSubmission(params.viewer),
        status: "AWAITING_BANK_TRANSFER",
        stripePaymentIntentId: paymentIntent.id,
        userId: params.submission.userId,
      },
    });
  }

  if (instructions?.reference) {
    await prisma.businessSubmission.update({
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
