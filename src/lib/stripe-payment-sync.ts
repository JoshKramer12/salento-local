import { revalidatePath } from "next/cache";
import type { PaymentRecordMethod } from "@prisma/client";

import { ensurePendingPartnerCommissionForSubmission } from "@/lib/partner-ledger";
import { getStatusAfterPayment, resolvePaymentMethodRecord } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { sendPurchaseConfirmationForSubmission } from "@/lib/receipts";
import { runThrottledServerTask } from "@/lib/server-throttle";
import { getStripe } from "@/lib/stripe";
import { publishSubmissionAfterPayment } from "@/lib/submission-publication";

type SyncResult = {
  paymentReceived: boolean;
  publishedBusinessSlug: string;
  publishedTownSlug: string;
};

const USER_PAYMENT_SYNC_MIN_INTERVAL_MS = 45 * 1000;

async function finalizeStripeManagedPayment(params: {
  amountPaidCents: number;
  businessId?: string | null;
  businessSubmissionId: string;
  currency?: string | null;
  method: PaymentRecordMethod;
  paymentIntentId?: string | null;
  revalidatePaths?: boolean;
  sessionId?: string | null;
  stripeEventId?: string | null;
}): Promise<SyncResult> {
  let publishedBusinessSlug = "";
  let publishedTownSlug = "";

  await prisma.$transaction(async (tx) => {
    const existingPayment = await tx.payment.findFirst({
      where: {
        OR: [
          ...(params.stripeEventId ? [{ stripeLastEventId: params.stripeEventId }] : []),
          ...(params.sessionId ? [{ stripeCheckoutSessionId: params.sessionId }] : []),
          ...(params.paymentIntentId ? [{ stripePaymentIntentId: params.paymentIntentId }] : []),
        ],
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existingPayment) {
      await tx.payment.update({
        where: {
          id: existingPayment.id,
        },
        data: {
          amountCents: params.amountPaidCents,
          businessId: params.businessId ?? null,
          currency: params.currency || "eur",
          method: params.method,
          paidAt: new Date(),
          status: "PAID",
          stripeCheckoutSessionId: params.sessionId ?? undefined,
          stripeLastEventId: params.stripeEventId ?? undefined,
          stripePaymentIntentId: params.paymentIntentId ?? null,
        },
      });
    } else {
      const submissionForPayment = await tx.businessSubmission.findUnique({
        where: {
          id: params.businessSubmissionId,
        },
        select: {
          userId: true,
        },
      });

      if (submissionForPayment) {
        await tx.payment.create({
          data: {
            amountCents: params.amountPaidCents,
            businessId: params.businessId ?? null,
            businessSubmissionId: params.businessSubmissionId,
            currency: params.currency || "eur",
            method: params.method,
            paidAt: new Date(),
            status: "PAID",
            stripeCheckoutSessionId: params.sessionId ?? null,
            stripeLastEventId: params.stripeEventId ?? null,
            stripePaymentIntentId: params.paymentIntentId ?? null,
            userId: submissionForPayment.userId,
          },
        });
      }
    }

    const submission = await tx.businessSubmission.findUnique({
      where: {
        id: params.businessSubmissionId,
      },
      select: {
        amountPaidCents: true,
        createdBusiness: {
          select: {
            slug: true,
            town: {
              select: {
                slug: true,
              },
            },
          },
        },
        id: true,
        paymentStatus: true,
        status: true,
      },
    });

    if (!submission) {
      return;
    }

    if (
      submission.paymentStatus !== "PAID" ||
      submission.amountPaidCents !== params.amountPaidCents ||
      submission.status !== "PUBLISHED"
    ) {
      await tx.businessSubmission.update({
        where: {
          id: params.businessSubmissionId,
        },
        data: {
          amountOwedCents: 0,
          amountPaidCents: params.amountPaidCents,
          paymentStatus: "PAID",
          status: getStatusAfterPayment(),
        },
      });
    }

    if (submission.status !== "PUBLISHED") {
      const publishedBusiness = await publishSubmissionAfterPayment({
        db: tx,
        submissionId: params.businessSubmissionId,
      });

      publishedBusinessSlug = publishedBusiness?.slug ?? "";
      publishedTownSlug = publishedBusiness?.town.slug ?? "";
      return;
    }

    publishedBusinessSlug = submission.createdBusiness?.slug ?? "";
    publishedTownSlug = submission.createdBusiness?.town.slug ?? "";
  });

  if (params.revalidatePaths !== false) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");
    revalidatePath("/directory");
    revalidatePath("/explore");
    if (publishedBusinessSlug) {
      revalidatePath(`/businesses/${publishedBusinessSlug}`);
    }
    if (publishedTownSlug) {
      revalidatePath(`/towns/${publishedTownSlug}`);
    }
  }

  await ensurePendingPartnerCommissionForSubmission({
    businessSubmissionId: params.businessSubmissionId,
  });
  await sendPurchaseConfirmationForSubmission({
    locale: "it",
    submissionId: params.businessSubmissionId,
  });

  return {
    paymentReceived: true,
    publishedBusinessSlug,
    publishedTownSlug,
  };
}

export async function syncStripePaymentForSubmission(params: {
  revalidatePaths?: boolean;
  submissionId: string;
  userId: string;
}) {
  const submission = await prisma.businessSubmission.findFirst({
    where: {
      id: params.submissionId,
      userId: params.userId,
    },
    include: {
      createdBusiness: {
        select: {
          slug: true,
          town: {
            select: {
              slug: true,
            },
          },
        },
      },
      payments: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
        },
        take: 1,
      },
    },
  });

  if (!submission) {
    return {
      paymentReceived: false,
      publishedBusinessSlug: "",
      publishedTownSlug: "",
      status: "missing" as const,
    };
  }

  if (submission.paymentStatus === "PAID" || submission.status === "PUBLISHED") {
    return {
      paymentReceived: true,
      publishedBusinessSlug: submission.createdBusiness?.slug ?? "",
      publishedTownSlug: submission.createdBusiness?.town.slug ?? "",
      status: "paid" as const,
    };
  }

  if (submission.paymentMethod !== "ONLINE") {
    if (submission.paymentMethod !== "BANK_TRANSFER") {
      return {
        paymentReceived: false,
        publishedBusinessSlug: "",
        publishedTownSlug: "",
        status: "unsupported" as const,
      };
    }

    const paymentIntentId = submission.payments[0]?.stripePaymentIntentId?.trim();

    if (!paymentIntentId) {
      return {
        paymentReceived: false,
        publishedBusinessSlug: "",
        publishedTownSlug: "",
        status: "missing_intent" as const,
      };
    }

    const stripe = getStripe();
    let paymentIntent;

    try {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch {
      return {
        paymentReceived: false,
        publishedBusinessSlug: "",
        publishedTownSlug: "",
        status: "pending" as const,
      };
    }

    if (paymentIntent.status !== "succeeded") {
      return {
        paymentReceived: false,
        publishedBusinessSlug: "",
        publishedTownSlug: "",
        status: "pending" as const,
      };
    }

    const synced = await finalizeStripeManagedPayment({
      amountPaidCents:
        paymentIntent.amount_received || paymentIntent.amount || submission.amountOwedCents,
      businessId: submission.createdBusinessId,
      businessSubmissionId: submission.id,
      currency: paymentIntent.currency,
      method: "BANK_TRANSFER",
      paymentIntentId: paymentIntent.id,
      revalidatePaths: params.revalidatePaths,
    });

    return {
      ...synced,
      status: "paid" as const,
    };
  }

  const sessionId = submission.payments[0]?.stripeCheckoutSessionId?.trim();

  if (!sessionId) {
    return {
      paymentReceived: false,
      publishedBusinessSlug: "",
      publishedTownSlug: "",
      status: "missing_session" as const,
    };
  }

  const stripe = getStripe();
  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return {
      paymentReceived: false,
      publishedBusinessSlug: "",
      publishedTownSlug: "",
      status: "pending" as const,
    };
  }

  if (session.payment_status !== "paid") {
    return {
      paymentReceived: false,
      publishedBusinessSlug: "",
      publishedTownSlug: "",
      status: session.status === "expired" ? ("expired" as const) : ("pending" as const),
    };
  }

  const synced = await finalizeStripeManagedPayment({
    amountPaidCents: session.amount_total ?? submission.amountOwedCents,
    businessId: submission.createdBusinessId,
    businessSubmissionId: submission.id,
    currency: session.currency,
    method: "STRIPE_CHECKOUT",
    paymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    revalidatePaths: params.revalidatePaths,
    sessionId: session.id,
  });

  return {
    ...synced,
    status: "paid" as const,
  };
}

export async function syncStripePaymentFromReceiptAccess(params: {
  checkoutSessionId: string;
  revalidatePaths?: boolean;
  submissionId: string;
}) {
  const stripe = getStripe();
  let session;

  try {
    session = await stripe.checkout.sessions.retrieve(params.checkoutSessionId);
  } catch {
    return {
      paymentReceived: false,
      status: "pending" as const,
    };
  }

  if (session.payment_status !== "paid") {
    return {
      paymentReceived: false,
      status: "pending" as const,
    };
  }

  if (session.metadata?.businessSubmissionId?.trim() !== params.submissionId) {
    return {
      paymentReceived: false,
      status: "mismatch" as const,
    };
  }

  await finalizeStripeManagedPayment({
    amountPaidCents: session.amount_total ?? 0,
    businessId: session.metadata?.businessId?.trim() || null,
    businessSubmissionId: params.submissionId,
    currency: session.currency,
    method: "STRIPE_CHECKOUT",
    paymentIntentId:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    revalidatePaths: params.revalidatePaths,
    sessionId: session.id,
  });

  return {
    paymentReceived: true,
    status: "paid" as const,
  };
}

export async function syncPendingStripePaymentsForUser(
  userId: string,
  options: {
    force?: boolean;
    minIntervalMs?: number;
  } = {},
) {
  return runThrottledServerTask({
    force: options.force,
    key: userId,
    minIntervalMs: options.minIntervalMs ?? USER_PAYMENT_SYNC_MIN_INTERVAL_MS,
    task: async () => {
      const pendingSubmissions = await prisma.businessSubmission.findMany({
        where: {
          paymentMethod: {
            in: ["ONLINE", "BANK_TRANSFER"],
          },
          paymentStatus: {
            not: "PAID",
          },
          userId,
        },
        select: {
          id: true,
        },
      });

      for (const submission of pendingSubmissions) {
        await syncStripePaymentForSubmission({
          submissionId: submission.id,
          userId,
        });
      }

      return pendingSubmissions.length;
    },
    taskName: "user-pending-stripe-payment-sync",
  });
}

export async function syncStripePaymentFromWebhook(params: {
  amountPaidCents: number;
  businessId?: string | null;
  businessSubmissionId: string;
  currency?: string | null;
  method?: PaymentRecordMethod;
  paymentIntentId?: string | null;
  sessionId?: string | null;
  stripeEventId: string;
}) {
  return finalizeStripeManagedPayment({
    amountPaidCents: params.amountPaidCents,
    businessId: params.businessId,
    businessSubmissionId: params.businessSubmissionId,
    currency: params.currency,
    method: params.method ?? resolvePaymentMethodRecord(null),
    paymentIntentId: params.paymentIntentId,
    sessionId: params.sessionId,
    stripeEventId: params.stripeEventId,
  });
}

export async function markStripePaymentRefunded(params: {
  stripePaymentIntentId: string;
}) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: {
        stripePaymentIntentId: params.stripePaymentIntentId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        businessSubmissionId: true,
        id: true,
      },
    });

    if (!payment) {
      return;
    }

    await tx.payment.update({
      where: {
        id: payment.id,
      },
      data: {
        status: "REFUNDED",
      },
    });

    await tx.businessSubmission.update({
      where: {
        id: payment.businessSubmissionId,
      },
      data: {
        paymentStatus: "REFUNDED",
      },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/businesses");
}
