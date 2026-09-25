import { revalidatePath } from "next/cache";
import type { PaymentRecordMethod, Prisma } from "@prisma/client";
import type Stripe from "stripe";

import { ensurePendingPartnerCommissionForSubmission } from "@/lib/partner-ledger";
import { getStatusAfterPayment, resolvePaymentMethodRecord } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { runThrottledServerTask } from "@/lib/server-throttle";
import { getStripe } from "@/lib/stripe";
import { publishSubmissionAfterPayment } from "@/lib/submission-publication";
import { ensureOwnerAccessForPublishedSubmission } from "@/lib/business-owner-access";
import { ensureInitialBusinessMembership } from "@/lib/business-membership";
import { getVerifiedManualElementPaymentIntent } from "@/lib/no-email-payment";

type SyncResult = {
  paymentReceived: boolean;
  publishedBusinessSlug: string;
  publishedTownSlug: string;
};

type ReceiptCheckoutSession = Pick<
  Stripe.Checkout.Session,
  "amount_total" | "currency" | "id" | "metadata" | "payment_intent" | "payment_status"
>;

const USER_PAYMENT_SYNC_MIN_INTERVAL_MS = 45 * 1000;

type PaymentBusinessAssociationDb = Pick<Prisma.TransactionClient, "payment">;

/**
 * Connect a successful payment to the one Business produced by its submission.
 * A later webhook/polling/receipt pass may have no Business ID in its Stripe
 * metadata (which is normal for an initial payment), so this deliberately
 * never clears or replaces an existing association.
 */
export async function ensurePaymentBusinessAssociation(params: {
  businessId: string;
  db: PaymentBusinessAssociationDb;
  paymentId: string;
}) {
  const payment = await params.db.payment.findUnique({
    where: { id: params.paymentId },
    select: { businessId: true },
  });

  if (!payment) {
    throw new Error("payment_business_association_missing_payment");
  }

  if (payment.businessId && payment.businessId !== params.businessId) {
    throw new Error("payment_business_association_conflict");
  }

  if (payment.businessId === params.businessId) {
    return;
  }

  const updated = await params.db.payment.updateMany({
    where: {
      businessId: null,
      id: params.paymentId,
    },
    data: {
      businessId: params.businessId,
    },
  });

  if (updated.count === 1) {
    return;
  }

  // Another authoritative finalization may have won the race. Read once more
  // and accept only the same immutable association.
  const resolvedPayment = await params.db.payment.findUnique({
    where: { id: params.paymentId },
    select: { businessId: true },
  });

  if (resolvedPayment?.businessId !== params.businessId) {
    throw new Error("payment_business_association_conflict");
  }
}

async function finalizeStripeManagedPayment(params: {
  amountPaidCents: number;
  businessId?: string | null;
  businessSubmissionId: string;
  currency?: string | null;
  method: PaymentRecordMethod;
  paymentIntentId?: string | null;
  revalidatePaths?: boolean;
  sessionId?: string | null;
  stripeCustomerId?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeEventId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
}): Promise<SyncResult> {
  let publishedBusinessSlug = "";
  let publishedTownSlug = "";
  let finalizedPaymentId: string | null = null;
  const finalizedAt = new Date();

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
        businessId: true,
        id: true,
        status: true,
      },
    });

    if (existingPayment) {
      if (
        existingPayment.businessId &&
        params.businessId &&
        existingPayment.businessId !== params.businessId
      ) {
        throw new Error("payment_business_association_conflict");
      }

      await tx.payment.update({
        where: {
          id: existingPayment.id,
        },
        data: {
          amountCents: params.amountPaidCents,
          // Initial Checkout metadata is intentionally blank because the
          // Business is created only after payment. Never erase the durable
          // association established by an earlier authoritative finalization.
          businessId: params.businessId || undefined,
          currency: params.currency || "eur",
          method: params.method,
          paidAt: finalizedAt,
          status: "PAID",
          stripeCheckoutSessionId: params.sessionId ?? undefined,
          stripeLastEventId: params.stripeEventId ?? undefined,
          stripePaymentIntentId: params.paymentIntentId ?? null,
        },
      });
      finalizedPaymentId = existingPayment.id;
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
        const createdPayment = await tx.payment.create({
          data: {
            amountCents: params.amountPaidCents,
            businessId: params.businessId ?? null,
            businessSubmissionId: params.businessSubmissionId,
            currency: params.currency || "eur",
            method: params.method,
            paidAt: finalizedAt,
            status: "PAID",
            stripeCheckoutSessionId: params.sessionId ?? null,
            stripeLastEventId: params.stripeEventId ?? null,
            stripePaymentIntentId: params.paymentIntentId ?? null,
            userId: submissionForPayment.userId,
          },
          select: {
            id: true,
          },
        });
        finalizedPaymentId = createdPayment.id;
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
            id: true,
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

    let publishedBusinessId: string | null = null;

    if (submission.status !== "PUBLISHED") {
      const publishedBusiness = await publishSubmissionAfterPayment({
        db: tx,
        submissionId: params.businessSubmissionId,
      });

      publishedBusinessSlug = publishedBusiness?.slug ?? "";
      publishedTownSlug = publishedBusiness?.town.slug ?? "";
      if (publishedBusiness) {
        publishedBusinessId = publishedBusiness.id;
        await ensureInitialBusinessMembership({
          businessId: publishedBusiness.id,
          db: tx,
          paidAt: finalizedAt,
          submissionId: params.businessSubmissionId,
          automaticRenewal: Boolean(params.stripeSubscriptionId),
          stripeCustomerId: params.stripeCustomerId,
          stripeCancelAtPeriodEnd: params.stripeCancelAtPeriodEnd,
          stripeSubscriptionId: params.stripeSubscriptionId,
          stripeSubscriptionStatus: params.stripeSubscriptionStatus,
        });
      }
    } else {
      publishedBusinessSlug = submission.createdBusiness?.slug ?? "";
      publishedTownSlug = submission.createdBusiness?.town.slug ?? "";
      if (submission.createdBusiness) {
        publishedBusinessId = submission.createdBusiness.id;
        await ensureInitialBusinessMembership({
          businessId: submission.createdBusiness.id,
          db: tx,
          paidAt: finalizedAt,
          submissionId: params.businessSubmissionId,
          automaticRenewal: Boolean(params.stripeSubscriptionId),
          stripeCustomerId: params.stripeCustomerId,
          stripeCancelAtPeriodEnd: params.stripeCancelAtPeriodEnd,
          stripeSubscriptionId: params.stripeSubscriptionId,
          stripeSubscriptionStatus: params.stripeSubscriptionStatus,
        });
      }
    }

    if (publishedBusinessId && finalizedPaymentId) {
      await ensurePaymentBusinessAssociation({
        businessId: publishedBusinessId,
        db: tx,
        paymentId: finalizedPaymentId,
      });
    }

    // This runs in the same authoritative payment transaction as publication.
    // It is safe on webhook retries and also backfills access for a published
    // submission whose earlier processing stopped before this feature existed.
    await ensureOwnerAccessForPublishedSubmission({
      db: tx,
      submissionId: params.businessSubmissionId,
    });
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
          id: true,
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
          stripeSubscriptionId: true,
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

  const elementPayment = submission.payments[0];
  if (elementPayment?.id.startsWith("initial-element:") && elementPayment.stripePaymentIntentId &&
    !elementPayment.stripeSubscriptionId &&
    !elementPayment.stripeCheckoutSessionId) {
    let intent: Stripe.PaymentIntent;
    try {
      intent = await getStripe().paymentIntents.retrieve(elementPayment.stripePaymentIntentId);
    } catch {
      return { paymentReceived: false, publishedBusinessSlug: "", publishedTownSlug: "", status: "pending" as const };
    }
    const verified = await getVerifiedManualElementPaymentIntent(intent);
    if (!verified || verified.id !== elementPayment.id || intent.status !== "succeeded" ||
      intent.amount_received !== verified.amountCents) {
      return { paymentReceived: false, publishedBusinessSlug: "", publishedTownSlug: "", status: "pending" as const };
    }
    const synced = await finalizeStripeManagedPayment({
      amountPaidCents: verified.amountCents,
      businessSubmissionId: submission.id,
      currency: intent.currency,
      method: "STRIPE_CHECKOUT",
      paymentIntentId: intent.id,
      revalidatePaths: params.revalidatePaths,
    });
    return { ...synced, status: "paid" as const };
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

  // Subscription Checkout has no PaymentIntent on the session in every API
  // shape. Retrieve the subscription server-side so polling has exactly the
  // same durable association as the webhook path.
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  let subscription: Stripe.Subscription | null = null;
  if (subscriptionId) {
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch {
      // Do not activate an automatic membership until its durable recurring
      // authority has been read from Stripe. The QR poll will retry safely.
      return {
        paymentReceived: false,
        publishedBusinessSlug: "",
        publishedTownSlug: "",
        status: "pending" as const,
      };
    }
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
    stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
    stripeCancelAtPeriodEnd: subscription?.cancel_at_period_end ?? null,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionStatus: subscription?.status ?? null,
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
}, dependencies: {
  finalizePayment?: typeof finalizeStripeManagedPayment;
  findPaidPayment?: (params: {
    checkoutSessionId: string;
    submissionId: string;
  }) => Promise<{ id: string } | null>;
  retrieveCheckoutSession?: (
    checkoutSessionId: string,
  ) => Promise<ReceiptCheckoutSession>;
} = {}) {
  const findPaidPayment = dependencies.findPaidPayment ?? (async (lookup) =>
    prisma.payment.findFirst({
      where: {
        businessSubmissionId: lookup.submissionId,
        status: "PAID",
        stripeCheckoutSessionId: lookup.checkoutSessionId,
      },
      select: { id: true },
    }));
  const existingPayment = await findPaidPayment({
    checkoutSessionId: params.checkoutSessionId,
    submissionId: params.submissionId,
  });

  // After the webhook has persisted the payment, the exact Checkout Session
  // stored with this submission is sufficient bearer proof. This makes receipt
  // refreshes independent of both Stripe availability and email delivery.
  if (existingPayment) {
    return {
      paymentReceived: true,
      status: "paid" as const,
    };
  }

  const retrieveCheckoutSession = dependencies.retrieveCheckoutSession ??
    ((checkoutSessionId: string) => getStripe().checkout.sessions.retrieve(
      checkoutSessionId,
      {},
      { maxNetworkRetries: 0, timeout: 10_000 },
    ));
  let session;

  try {
    session = await retrieveCheckoutSession(params.checkoutSessionId);
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

  const finalizePayment = dependencies.finalizePayment ?? finalizeStripeManagedPayment;
  await finalizePayment({
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
  stripeCustomerId?: string | null;
  stripeCancelAtPeriodEnd?: boolean | null;
  stripeEventId: string;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionStatus?: string | null;
}) {
  return finalizeStripeManagedPayment({
    amountPaidCents: params.amountPaidCents,
    businessId: params.businessId,
    businessSubmissionId: params.businessSubmissionId,
    currency: params.currency,
    method: params.method ?? resolvePaymentMethodRecord(null),
    paymentIntentId: params.paymentIntentId,
    sessionId: params.sessionId,
    stripeCustomerId: params.stripeCustomerId,
    stripeCancelAtPeriodEnd: params.stripeCancelAtPeriodEnd,
    stripeEventId: params.stripeEventId,
    stripeSubscriptionId: params.stripeSubscriptionId,
    stripeSubscriptionStatus: params.stripeSubscriptionStatus,
  });
}

export async function markStripePaymentRefunded(params: {
  revalidatePaths?: boolean;
  revokeMembershipEntitlement?: boolean;
  stripePaymentIntentId: string;
}, dependencies: {
  db?: Pick<typeof prisma, "$transaction">;
} = {}) {
  const db = dependencies.db ?? prisma;

  await db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: {
        stripePaymentIntentId: params.stripePaymentIntentId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        businessId: true,
        businessSubmissionId: true,
        id: true,
        purpose: true,
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

    // A renewal/re-activation is a new membership payment, not a refund of
    // the historical initial submission. Preserve that submission's paid and
    // published audit trail; its own refund is still handled as before.
    if (payment.purpose === "INITIAL_MEMBERSHIP") {
      await tx.businessSubmission.update({
        where: { id: payment.businessSubmissionId },
        data: { paymentStatus: "REFUNDED" },
      });
    }

    // A partial refund keeps the existing entitlement behavior unchanged. A
    // full refund of the payment funding this Phase 1 membership revokes only
    // that business's public entitlement; no listing data or owner access is
    // removed.
    if (params.revokeMembershipEntitlement && payment.businessId) {
      await tx.businessMembership.updateMany({
        where: {
          businessId: payment.businessId,
          entitlementRevokedAt: null,
        },
        data: {
          entitlementRevokedAt: new Date(),
        },
      });
    }
  });

  if (params.revalidatePaths !== false) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/businesses");
  }
}
