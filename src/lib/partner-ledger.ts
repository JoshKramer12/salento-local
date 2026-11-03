import { revalidatePath } from "next/cache";
import type {
  PartnerCommissionStatus,
  PartnerPayout,
  PartnerPayoutStatus,
  Prisma,
} from "@prisma/client";
import { addUtcDays } from "@/lib/business-membership";

import { sendTransactionalEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import {
  getNextPartnerPayoutDate,
  getPartnerCommissionCents,
  getPartnerMinimumPayoutCents,
  getPartnerPayoutDay,
  getPartnerPayoutTimezone,
  syncPartnerStripeAccountStatus,
} from "@/lib/partner-connect";
import { prisma } from "@/lib/prisma";
import { runThrottledServerTask } from "@/lib/server-throttle";
import { areRealPartnerDisbursementsAllowed, assertRealPartnerDisbursementsAllowed, getStripe, isStripeSandboxMode } from "@/lib/stripe";
import { createPaypalPayout, getPaypalPayoutBatch, isPaypalPayoutConfigured } from "@/lib/partner-payout-methods";

function revalidatePartnerLedgerPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/earnings");
  revalidatePath("/dashboard/admin/users");
}

function getLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "it";
}

function formatPayoutDate(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
    timeZone: getPartnerPayoutTimezone(),
  }).format(date);
}

function buildRunKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: getPartnerPayoutTimezone(),
    year: "numeric",
  })
    .format(date)
    .replace(/\//g, "-");
}

function getFriendlyPayoutFailureMessage(locale: Locale) {
  return locale === "it"
    ? "Non siamo riusciti a completare il pagamento. Controlla i tuoi dati di pagamento."
    : "We could not complete your payout. Please review your payout information.";
}

function getPayoutNotSentMessage(
  locale: Locale,
  reason: "bank-account-not-connected" | "bank-account-not-ready" | "paypal-not-configured" | "sepa-rail-unavailable",
) {
  if (reason === "paypal-not-configured") {
    return locale === "it"
      ? "Pagamento non inviato — il servizio PayPal di Salento Local richiede ancora l'attivazione. I guadagni restano disponibili."
      : "Payout not sent — Salento Local's PayPal service still needs activation. Your earnings remain available.";
  }
  if (reason === "sepa-rail-unavailable") {
    return locale === "it"
      ? "Pagamento non inviato — è necessario un servizio bancario SEPA aziendale per inviare questo bonifico. I guadagni restano disponibili."
      : "Payout not sent — a business SEPA banking service is needed to send this transfer. Your earnings remain available.";
  }
  if (locale === "it") {
    return reason === "bank-account-not-connected"
      ? "Pagamento non inviato — conto bancario non collegato. Questo importo resta da pagare e sara incluso in un pagamento futuro quando il conto sara collegato."
      : "Pagamento non inviato — conto bancario non pronto. Questo importo resta da pagare e sara incluso in un pagamento futuro quando il conto sara pronto.";
  }

  return reason === "bank-account-not-connected"
    ? "Payout not sent — bank account not connected. This amount is still owed and will be included in a future payout once your account is connected."
    : "Payout not sent — bank account not ready. This amount is still owed and will be included in a future payout once your account is ready.";
}

function isStripeInsufficientBalanceError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorWithCode = error as {
    code?: unknown;
    message?: unknown;
    raw?: {
      code?: unknown;
      message?: unknown;
    };
  };

  const code =
    typeof errorWithCode.code === "string"
      ? errorWithCode.code
      : typeof errorWithCode.raw?.code === "string"
        ? errorWithCode.raw.code
        : "";
  const message =
    typeof errorWithCode.message === "string"
      ? errorWithCode.message
      : typeof errorWithCode.raw?.message === "string"
        ? errorWithCode.raw.message
        : "";

  return (
    code === "balance_insufficient" ||
    message.toLowerCase().includes("insufficient funds in your stripe account")
  );
}

async function sendPartnerPayoutEmail(params: {
  amountCents: number;
  email: string;
  locale: Locale;
  status: "action-required" | "initiated" | "paid";
}) {
  const amount = new Intl.NumberFormat(params.locale === "it" ? "it-IT" : "en-US", {
    currency: "EUR",
    style: "currency",
  }).format(params.amountCents / 100);

  const copy =
    params.locale === "it"
      ? {
          "action-required": {
            html:
              "<p>Non siamo riusciti a completare il tuo pagamento Salento Local.</p><p>Controlla i tuoi dati di pagamento per continuare a ricevere i guadagni.</p>",
            subject: "Il tuo pagamento Salento Local richiede attenzione",
            text:
              "Non siamo riusciti a completare il tuo pagamento Salento Local. Controlla i tuoi dati di pagamento per continuare a ricevere i guadagni.",
          },
          initiated: {
            html: `<p>Il tuo pagamento Salento Local di <strong>${amount}</strong> e stato inviato per l'elaborazione.</p>`,
            subject: `Pagamento Salento Local avviato: ${amount}`,
            text: `Il tuo pagamento Salento Local di ${amount} e stato inviato per l'elaborazione.`,
          },
          paid: {
            html: `<p>Il tuo pagamento Salento Local di <strong>${amount}</strong> e stato inviato al tuo conto bancario.</p>`,
            subject: `Pagamento Salento Local inviato: ${amount}`,
            text: `Il tuo pagamento Salento Local di ${amount} e stato inviato al tuo conto bancario.`,
          },
        }
      : {
          "action-required": {
            html:
              "<p>We could not complete your Salento Local payout.</p><p>Please review your payout details so payments can continue.</p>",
            subject: "Your Salento Local payout needs attention",
            text:
              "We could not complete your Salento Local payout. Please review your payout details so payments can continue.",
          },
          initiated: {
            html: `<p>Your Salento Local payout of <strong>${amount}</strong> has been sent for processing.</p>`,
            subject: `Salento Local payout initiated: ${amount}`,
            text: `Your Salento Local payout of ${amount} has been sent for processing.`,
          },
          paid: {
            html: `<p>Your Salento Local payout of <strong>${amount}</strong> has been sent to your bank.</p>`,
            subject: `Salento Local payout sent: ${amount}`,
            text: `Your Salento Local payout of ${amount} has been sent to your bank.`,
          },
        };

  await sendTransactionalEmail({
    headers: {
      "X-Transactional-Message": "partner-payout",
    },
    html: copy[params.status].html,
    subject: copy[params.status].subject,
    text: copy[params.status].text,
    to: params.email,
  });
}

async function sendPartnerPayoutEmailSafely(params: {
  amountCents: number;
  email: string | null | undefined;
  locale: Locale;
  partnerUserId?: string;
  payoutId?: string;
  status: "action-required" | "initiated" | "paid";
}) {
  if (!params.email || isStripeSandboxMode()) {
    return;
  }

  try {
    await sendPartnerPayoutEmail({
      amountCents: params.amountCents,
      email: params.email,
      locale: params.locale,
      status: params.status,
    });
  } catch (error) {
    console.error("[partner-payout:email]", {
      error,
      partnerUserId: params.partnerUserId ?? null,
      payoutId: params.payoutId ?? null,
      status: params.status,
    });
  }
}

async function settleSandboxPartnerPayout(params: {
  email: string;
  locale: Locale;
  payout: Pick<
    PartnerPayout,
    | "amountCents"
    | "attemptCount"
    | "bankAccountLast4"
    | "bankName"
    | "id"
    | "partnerUserId"
    | "stripePayoutId"
    | "stripeTransferId"
  >;
}) {
  await assertPartnerPayoutHasOnlyLivePayments(params.payout.id);
  const settledAt = new Date();
  const stripeTransferId = params.payout.stripeTransferId || `sandbox-transfer-${params.payout.id}`;
  const stripePayoutId = params.payout.stripePayoutId || `sandbox-payout-${params.payout.id}`;

  await prisma.$transaction(async (tx) => {
    await tx.partnerPayout.update({
      where: {
        id: params.payout.id,
      },
      data: {
        attemptCount: Math.max(params.payout.attemptCount, 1),
        failedAt: null,
        failureMessage: null,
        initiatedAt: settledAt,
        paidAt: settledAt,
        status: "PAID",
        stripePayoutId,
        stripeTransferId,
      },
    });

    await tx.partnerCommission.updateMany({
      where: {
        payoutId: params.payout.id,
        status: "RESERVED",
      },
      data: {
        paidAt: settledAt,
        status: "PAID",
        stripePayoutId,
        stripeTransferId,
        transferredAt: settledAt,
      },
    });
  });

  await sendPartnerPayoutEmailSafely({
    amountCents: params.payout.amountCents,
    email: params.email,
    locale: params.locale,
    partnerUserId: params.payout.partnerUserId,
    payoutId: params.payout.id,
    status: "paid",
  });
}

function shouldCountAsToBePaid(status: PartnerCommissionStatus) {
  return status === "PENDING" || status === "AVAILABLE";
}

function shouldCountAsOutstanding(status: PartnerCommissionStatus) {
  return status === "PENDING" || shouldCountAsToBePaid(status);
}

function buildSubmissionCommissionSourceKey(submissionId: string) {
  return `commission:submission:${submissionId}`;
}

export const INITIAL_COMMISSION_HOLD_DAYS = 14;

/** This predicate is used again inside the payout reservation transaction.
 * Old rows with an early eligibleAt remain held by the paidAt condition. */
export function payableCommissionWhere(now: Date, stripeLivemode = true): Prisma.PartnerCommissionWhereInput {
  return {
    amountCents: { gt: 0 },
    eligibleAt: { lte: now },
    // Callers use the live default. Only the account-verified Stage 5A local
    // harness may request false for test-only provider verification.
    payment: { is: { stripeLivemode } },
    payoutId: null,
    status: { in: ["PENDING", "AVAILABLE"] },
    type: "COMMISSION",
    OR: [
      { payment: { is: { purpose: "INITIAL_MEMBERSHIP", status: "PAID", OR: [{ refundRequestedAt: null }, { refundStatus: "support_closed" }], paidAt: { lte: addUtcDays(now, -INITIAL_COMMISSION_HOLD_DAYS) } } } },
      { payment: { is: { purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "PAID" } } },
    ],
  };
}

/** Final provider boundary for reserved payouts, including old reservations
 * made before payment mode was stored. No provider transfer may precede this. */
export async function assertPartnerPayoutHasOnlyLivePayments(
  payoutId: string,
  db: Pick<typeof prisma, "partnerPayout"> = prisma,
) {
  assertRealPartnerDisbursementsAllowed();
  const payout = await db.partnerPayout.findUnique({
    where: { id: payoutId },
    select: { amountCents: true, commissions: { select: {
      amountCents: true, status: true, type: true,
      payment: { select: { status: true, stripeLivemode: true } },
    } } },
  });
  if (!payout || !payout.commissions.length ||
    payout.commissions.some((commission) => commission.type !== "COMMISSION" ||
      commission.status !== "RESERVED" || commission.payment?.status !== "PAID" ||
      commission.payment.stripeLivemode !== true) ||
    payout.commissions.reduce((sum, commission) => sum + commission.amountCents, 0) !== payout.amountCents) {
    throw new Error("partner_payout_requires_verified_live_payments");
  }
}

type InitialMembershipPayment = {
  currency: string;
  id: string;
  paidAt: Date | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
};

type InitialCommissionAttribution =
  | { kind: "ASSIGN"; payment: InitialMembershipPayment }
  | { kind: "PRESERVE" }
  | { kind: "CONFLICT" }
  | { kind: "UNRESOLVED" };

/**
 * A submission commission represents the acquisition payment, not the most
 * recent payment made for that submission. A later renewal/reactivation shares
 * the submission but has its own payment-keyed €15 commission.
 */
export function resolveInitialCommissionAttribution(params: {
  existingPaymentId: string | null;
  paidInitialPayments: InitialMembershipPayment[];
}): InitialCommissionAttribution {
  if (params.existingPaymentId) {
    return params.paidInitialPayments.some((payment) => payment.id === params.existingPaymentId)
      ? { kind: "PRESERVE" }
      : { kind: "CONFLICT" };
  }

  return params.paidInitialPayments.length === 1
    ? { kind: "ASSIGN", payment: params.paidInitialPayments[0] }
    : { kind: "UNRESOLVED" };
}

export const PARTNER_RENEWAL_COMMISSION_CENTS = 1500;

function buildRenewalCommissionSourceKey(paymentId: string) {
  return `commission:renewal:${paymentId}`;
}

/** Records only a paid renewal/reactivation against its original membership.
 * It is intentionally independent from the initial-submission €50 flow. */
export async function ensurePartnerRenewalCommissionForPayment(params: {
  paymentId: string;
  sourceEventId?: string | null;
  sourceEventType?: string | null;
}, dependencies: { revalidatePaths?: () => void } = {}) {
  let created = false;
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      include: {
        business: { include: { membership: { select: { originatingPartnerUserId: true } } } },
        businessSubmission: { select: { id: true } },
      },
    });
    const partnerUserId = payment?.business?.membership?.originatingPartnerUserId;
    if (!payment || !partnerUserId || payment.status !== "PAID" || (payment.purpose !== "ANNUAL_RENEWAL" && payment.purpose !== "REACTIVATION")) return;
    const sourceKey = buildRenewalCommissionSourceKey(payment.id);
    const existing = await tx.partnerCommission.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) return;
    await tx.partnerCommission.create({
      data: {
        amountCents: PARTNER_RENEWAL_COMMISSION_CENTS,
        businessId: payment.businessId,
        businessSubmissionId: payment.businessSubmissionId,
        currency: payment.currency,
        earnedAt: payment.paidAt ?? new Date(),
        eligibleAt: payment.paidAt ?? new Date(),
        partnerUserId,
        paymentId: payment.id,
        sourceEventId: params.sourceEventId ?? null,
        sourceEventType: params.sourceEventType ?? null,
        sourceKey,
        status: "PENDING",
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        type: "COMMISSION",
      },
    });
    created = true;
  });
  if (created) (dependencies.revalidatePaths ?? revalidatePartnerLedgerPaths)();
}

/** A refunded acquisition can earn a new €50 only after a new, distinct
 * INITIAL_MEMBERSHIP payment. The original submission row stays reversed. */
export async function ensurePartnerRefundRepurchaseCommissionForPayment(params: {
  paymentId: string;
  sourceEventId?: string | null;
  sourceEventType?: string | null;
}, dependencies: { db?: Pick<typeof prisma, "$transaction">; revalidatePaths?: () => void } = {}) {
  let created = false;
  await (dependencies.db ?? prisma).$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      include: { business: { include: { membership: true } } },
    });
    const partnerUserId = payment?.business?.membership?.originatingPartnerUserId;
    if (!payment || !payment.businessId || !partnerUserId || payment.status !== "PAID" || payment.purpose !== "INITIAL_MEMBERSHIP" || !payment.paidAt) return;
    const prior = await tx.payment.findMany({
      where: { businessId: payment.businessId, purpose: "INITIAL_MEMBERSHIP", id: { not: payment.id } },
      select: { status: true, selfServiceRefundedAt: true },
    });
    if (!prior.length || prior.some((entry) => entry.status !== "REFUNDED" || !entry.selfServiceRefundedAt)) return;
    const retained = await tx.partnerCommission.findFirst({
      where: { businessSubmissionId: payment.businessSubmissionId, type: "COMMISSION", amountCents: 5000, status: { not: "REVERSED" } },
      select: { id: true },
    });
    if (retained) return;
    const sourceKey = `commission:refund-repurchase:${payment.id}`;
    const existing = await tx.partnerCommission.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) return;
    await tx.partnerCommission.create({
      data: {
        amountCents: getPartnerCommissionCents(),
        businessId: payment.businessId,
        businessSubmissionId: payment.businessSubmissionId,
        currency: payment.currency,
        earnedAt: payment.paidAt,
        eligibleAt: addUtcDays(payment.paidAt, INITIAL_COMMISSION_HOLD_DAYS),
        partnerUserId,
        paymentId: payment.id,
        sourceEventId: params.sourceEventId ?? null,
        sourceEventType: params.sourceEventType ?? null,
        sourceKey,
        status: "PENDING",
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        type: "COMMISSION",
      },
    });
    created = true;
  });
  if (created) (dependencies.revalidatePaths ?? revalidatePartnerLedgerPaths)();
}

const PARTNER_COMMISSION_SYNC_MIN_INTERVAL_MS = 45 * 1000;

export type PartnerOutstandingCommissionItem = {
  amountCents: number;
  businessName: string;
  id: string;
  status: "AVAILABLE" | "PENDING" | "RESERVED";
};

export type PartnerPayoutRunSummaryItem = {
  businessCount: number;
  businessNames: string[];
  failureMessage: string | null;
  partnerName: string;
  partnerUserId: string;
  status:
    | "failed"
    | "paid"
    | "processing"
    | "skipped-below-minimum"
    | "skipped-no-commissions"
    | "skipped-payouts-disabled"
    | "skipped-setup-incomplete";
  stripeTransferId: string | null;
  totalPaidCents: number;
};

function getCommissionBusinessName(commission: {
  business?: { name: string } | null;
  businessSubmission?: {
    businessName: string;
    createdBusiness?: { name: string } | null;
  } | null;
}) {
  return (
    commission.business?.name ||
    commission.businessSubmission?.createdBusiness?.name ||
    commission.businessSubmission?.businessName ||
    "Partner submission"
  );
}

export async function getPartnerBalanceSummary(userId: string) {
  const [commissions, latestPayout] = await Promise.all([
    prisma.partnerCommission.findMany({
      where: {
        partnerUserId: userId,
      },
      select: {
        amountCents: true,
        eligibleAt: true,
        payment: { select: { paidAt: true, purpose: true, status: true, refundRequestedAt: true, refundStatus: true, stripeLivemode: true } },
        status: true,
        type: true,
      },
    }),
    prisma.partnerPayout.findFirst({
      where: {
        partnerUserId: userId,
      },
      orderBy: {
        initiatedAt: "desc",
      },
      select: {
        status: true,
      },
    }),
  ]);

  return commissions.reduce(
    (summary, commission) => {
      if (commission.type === "COMMISSION" && commission.amountCents > 0 && commission.status !== "REVERSED") {
        if (commission.payment?.stripeLivemode === false) summary.testActivity += commission.amountCents;
        else if (commission.payment?.stripeLivemode == null) summary.unverifiedActivity += commission.amountCents;
      }
      if (commission.payment?.stripeLivemode !== true) return summary;
      const payable = commission.payment?.status === "PAID" && commission.payment.stripeLivemode === true &&
        commission.eligibleAt && commission.eligibleAt <= new Date() &&
        (commission.payment.purpose !== "INITIAL_MEMBERSHIP" || Boolean((!commission.payment.refundRequestedAt || commission.payment.refundStatus === "support_closed") && commission.payment.paidAt && addUtcDays(commission.payment.paidAt, INITIAL_COMMISSION_HOLD_DAYS) <= new Date()));
      if (commission.type === "COMMISSION" && commission.amountCents > 0) {
        if (commission.status !== "REVERSED" && (payable || commission.status === "PAID" || commission.status === "RESERVED")) {
          summary.totalEarned += commission.amountCents;
        }
      }

      if (commission.status === "PENDING") {
        summary.pending += commission.amountCents;
      }

      if (shouldCountAsOutstanding(commission.status) && payable) {
        summary.available += commission.amountCents;
      }

      if (commission.status === "PAID") {
        summary.paid += commission.amountCents;
      }

      if (commission.status === "DEBT") {
        summary.debt += Math.abs(commission.amountCents);
      }

      return summary;
    },
    {
      available: 0,
      debt: 0,
      lastPayoutStatus: latestPayout?.status ?? null,
      nextPayoutDate: getNextPartnerPayoutDate(),
      paid: 0,
      pending: 0,
      testActivity: 0,
      totalEarned: 0,
      unverifiedActivity: 0,
    },
  );
}

export async function ensurePendingPartnerCommissionForSubmission(params: {
  businessSubmissionId: string;
  revalidatePaths?: boolean;
  sourceEventId?: string;
  sourceEventType?: string;
}) {
  let created = false;

  await prisma.$transaction(async (tx) => {
    const submission = await tx.businessSubmission.findUnique({
      where: {
        id: params.businessSubmissionId,
      },
      select: {
        commissionCents: true,
        createdAt: true,
        createdBusinessId: true,
        id: true,
        paymentMethod: true,
        paymentStatus: true,
        payLaterInvitation: { select: { id: true } },
        payments: {
          where: {
            status: "PAID",
            purpose: "INITIAL_MEMBERSHIP",
          },
          orderBy: {
            paidAt: "asc",
          },
          select: {
            currency: true,
            id: true,
            paidAt: true,
            stripeCheckoutSessionId: true,
            stripePaymentIntentId: true,
          },
          // More than one paid initial payment is a data conflict. Do not
          // choose one arbitrarily and attach a durable commission to it.
          take: 2,
        },
        status: true,
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    if (
      !submission ||
      submission.user.role !== "GETTER" ||
      !submission.paymentMethod ||
      submission.status === "DRAFT" ||
      (submission.payLaterInvitation && (submission.paymentStatus !== "PAID" || submission.status !== "PUBLISHED")) ||
      submission.commissionCents <= 0
    ) {
      return;
    }

    const existing = await tx.partnerCommission.findUnique({
      where: {
        sourceKey: buildSubmissionCommissionSourceKey(submission.id),
      },
      select: {
        id: true,
        paymentId: true,
        status: true,
      },
    });

    if (existing) {
      const attribution = resolveInitialCommissionAttribution({
        existingPaymentId: existing.paymentId,
        paidInitialPayments: submission.payments,
      });
      const shouldMarkPending =
        submission.paymentStatus === "PAID" &&
        (submission.status === "APPROVED" || submission.status === "PUBLISHED") &&
        attribution.kind === "ASSIGN";

      // A linked initial commission is immutable. In particular, a later
      // renewal/reactivation must not replace its payment or Stripe references.
      // An existing non-initial link is a historical data conflict and is left
      // for an explicit repair rather than silently reassigned by a sync job.
      if (
        !shouldMarkPending ||
        attribution.kind !== "ASSIGN" ||
        existing.status === "REVERSED" ||
        existing.status === "DEBT"
      ) {
        return;
      }

      await tx.partnerCommission.update({
        where: {
          id: existing.id,
        },
        data: {
          businessId: submission.createdBusinessId,
          currency: attribution.payment.currency,
          eligibleAt: addUtcDays(attribution.payment.paidAt ?? submission.createdAt, INITIAL_COMMISSION_HOLD_DAYS),
          paymentId: attribution.payment.id,
          status:
            existing.status === "PAID" || existing.status === "RESERVED"
              ? existing.status
              : "PENDING",
          stripeCheckoutSessionId: attribution.payment.stripeCheckoutSessionId,
          stripePaymentIntentId: attribution.payment.stripePaymentIntentId,
        },
      });

      return;
    }

    const attribution = resolveInitialCommissionAttribution({
      existingPaymentId: null,
      paidInitialPayments: submission.payments,
    });
    const shouldMarkPending =
      submission.paymentStatus === "PAID" &&
      (submission.status === "APPROVED" || submission.status === "PUBLISHED") &&
      attribution.kind === "ASSIGN";
    const initialPayment = attribution.kind === "ASSIGN" ? attribution.payment : null;

    await tx.partnerCommission.create({
      data: {
        amountCents: submission.commissionCents || getPartnerCommissionCents(),
        businessId: submission.createdBusinessId,
        businessSubmissionId: submission.id,
        currency: initialPayment?.currency || "eur",
        earnedAt: submission.payLaterInvitation ? initialPayment?.paidAt ?? submission.createdAt : submission.createdAt,
        eligibleAt: shouldMarkPending ? addUtcDays(initialPayment?.paidAt ?? submission.createdAt, INITIAL_COMMISSION_HOLD_DAYS) : null,
        partnerUserId: submission.user.id,
        paymentId: initialPayment?.id ?? null,
        sourceEventId: params.sourceEventId,
        sourceEventType: params.sourceEventType,
        sourceKey: buildSubmissionCommissionSourceKey(submission.id),
        status: "PENDING",
        stripeCheckoutSessionId: initialPayment?.stripeCheckoutSessionId ?? null,
        stripePaymentIntentId: initialPayment?.stripePaymentIntentId ?? null,
        type: "COMMISSION",
      },
    });

    created = true;
  });

  if (created && params.revalidatePaths !== false) {
    revalidatePartnerLedgerPaths();
  }
}

export async function syncPendingPartnerCommissionsForUser(
  userId: string,
  options: {
    force?: boolean;
    minIntervalMs?: number;
  } = {},
) {
  return runThrottledServerTask({
    force: options.force,
    key: userId,
    minIntervalMs: options.minIntervalMs ?? PARTNER_COMMISSION_SYNC_MIN_INTERVAL_MS,
    task: async () => {
      const submissions = await prisma.businessSubmission.findMany({
        where: {
          commissionCents: {
            gt: 0,
          },
          paymentMethod: {
            not: null,
          },
          status: {
            not: "DRAFT",
          },
          userId,
          user: {
            role: "GETTER",
          },
        },
        select: {
          id: true,
        },
      });

      for (const submission of submissions) {
        await ensurePendingPartnerCommissionForSubmission({
          businessSubmissionId: submission.id,
        });
      }

      return submissions.length;
    },
    taskName: "partner-commission-sync",
  });
}

export async function getPartnerOutstandingCommissionItems(
  userId: string,
): Promise<PartnerOutstandingCommissionItem[]> {
  const commissions = await prisma.partnerCommission.findMany({
    where: {
      amountCents: {
        gt: 0,
      },
      partnerUserId: userId,
      status: {
        in: ["PENDING", "AVAILABLE"],
      },
      type: "COMMISSION",
      payment: { is: { stripeLivemode: true } },
    },
    orderBy: [
      {
        createdAt: "desc",
      },
    ],
    select: {
      amountCents: true,
      business: {
        select: {
          name: true,
        },
      },
      businessSubmission: {
        select: {
          businessName: true,
          createdBusiness: {
            select: {
              name: true,
            },
          },
        },
      },
      createdAt: true,
      id: true,
      status: true,
    },
  });

  return commissions.map((commission) => ({
    amountCents: commission.amountCents,
    businessName:
      commission.business?.name ||
      commission.businessSubmission?.createdBusiness?.name ||
      commission.businessSubmission?.businessName ||
      "Partner submission",
    id: commission.id,
    status: commission.status as PartnerOutstandingCommissionItem["status"],
  }));
}

export async function getPartnerPayoutHistory(userId: string) {
  return prisma.partnerPayout.findMany({
    where: {
      partnerUserId: userId,
    },
    orderBy: {
      initiatedAt: "desc",
    },
    take: 12,
    select: {
      amountCents: true,
      attemptCount: true,
      bankAccountLast4: true,
      bankName: true,
      commissions: { select: { payment: { select: { stripeLivemode: true } } } },
      failureMessage: true,
      id: true,
      initiatedAt: true,
      paidAt: true,
      payoutMethod: true,
      providerBatchId: true,
      providerReference: true,
      status: true,
      updatedAt: true,
    },
  });
}

export async function ensurePartnerCommissionForSubmission(params: {
  businessSubmissionId: string;
  sourceEventId: string;
  sourceEventType: string;
}, dependencies: { revalidatePaths?: () => void } = {}) {
  await prisma.$transaction(async (tx) => {
    const submission = await tx.businessSubmission.findUnique({
      where: {
        id: params.businessSubmissionId,
      },
      include: {
        createdBusiness: {
          select: {
            id: true,
          },
        },
        payments: {
          where: {
            status: "PAID",
            purpose: "INITIAL_MEMBERSHIP",
          },
          orderBy: {
            paidAt: "asc",
          },
          // See resolveInitialCommissionAttribution: an ambiguous initial
          // payment history must never be resolved by selecting the latest.
          take: 2,
        },
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    if (
      !submission ||
      submission.user.role !== "GETTER" ||
      submission.paymentStatus !== "PAID" ||
      (submission.status !== "PUBLISHED" && submission.status !== "APPROVED")
    ) {
      return;
    }

    const existing = await tx.partnerCommission.findUnique({
      where: {
        sourceKey: buildSubmissionCommissionSourceKey(submission.id),
      },
      select: {
        id: true,
        paymentId: true,
        status: true,
      },
    });

    if (existing?.status === "REVERSED" || existing?.status === "DEBT") {
      return;
    }

    const attribution = resolveInitialCommissionAttribution({
      existingPaymentId: existing?.paymentId ?? null,
      paidInitialPayments: submission.payments,
    });

    if (attribution.kind === "PRESERVE" || attribution.kind === "CONFLICT" || attribution.kind === "UNRESOLVED") {
      return;
    }

    const payment = attribution.payment;

    const nextStatus =
      existing?.status === "PAID"
        ? "PAID"
        : existing?.status === "RESERVED"
          ? "RESERVED"
          : "PENDING";

    if (existing) {
      await tx.partnerCommission.update({
        where: {
          id: existing.id,
        },
        data: {
          businessId: submission.createdBusiness?.id ?? null,
          currency: payment.currency,
          eligibleAt: addUtcDays(payment.paidAt ?? new Date(), INITIAL_COMMISSION_HOLD_DAYS),
          paymentId: payment.id,
          status: nextStatus,
          stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
          stripePaymentIntentId: payment.stripePaymentIntentId,
        },
      });
      return;
    }

    await tx.partnerCommission.create({
      data: {
        amountCents: submission.commissionCents || getPartnerCommissionCents(),
        businessId: submission.createdBusiness?.id ?? null,
        businessSubmissionId: submission.id,
        currency: payment.currency,
        earnedAt: payment.paidAt ?? new Date(),
        eligibleAt: addUtcDays(payment.paidAt ?? new Date(), INITIAL_COMMISSION_HOLD_DAYS),
        partnerUserId: submission.user.id,
        paymentId: payment.id,
        sourceEventId: params.sourceEventId,
        sourceEventType: params.sourceEventType,
        sourceKey: buildSubmissionCommissionSourceKey(submission.id),
        status: "PENDING",
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        type: "COMMISSION",
      },
    });
  });

  (dependencies.revalidatePaths ?? revalidatePartnerLedgerPaths)();
}

export async function reversePartnerCommissionForPayment(params: {
  eventType: "charge.dispute.created" | "charge.dispute.closed" | "charge.refunded" | "transfer.reversed";
  reason: string;
  sourceEventId: string;
  paymentId?: string;
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
}, dependencies: {
  db?: Pick<typeof prisma, "$transaction">;
  revalidatePaths?: () => void;
} = {}) {
  const db = dependencies.db ?? prisma;

  await db.$transaction(async (tx) => {
    const candidate = await tx.partnerCommission.findFirst({
      where: {
        type: "COMMISSION",
        ...(params.paymentId ? { paymentId: params.paymentId } : { OR: [
          ...(params.stripePaymentIntentId
            ? [{ stripePaymentIntentId: params.stripePaymentIntentId }]
            : []),
          ...(params.stripeChargeId ? [{ stripeChargeId: params.stripeChargeId }] : []),
        ] }),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!candidate) {
      return;
    }

    // Serialize with Stage 1 withdrawal creation/cancellation and the legacy
    // batch reservation, then re-read the commission after acquiring the lock.
    await tx.localPartnerProfile.updateMany({
      where: { userId: candidate.partnerUserId }, data: { updatedAt: new Date() },
    });
    const original = await tx.partnerCommission.findUnique({ where: { id: candidate.id } });
    if (!original) return;

    // Stripe can emit more than one event for the same final refund/dispute.
    // The commission (not delivery event) is the reversal idempotency target.
    const reversalKey = `commission:reversal:${original.id}`;
    const existingReversal = await tx.partnerCommission.findUnique({
      where: {
        sourceKey: reversalKey,
      },
      select: {
        id: true,
      },
    });

    if (existingReversal) {
      return;
    }

    const { invalidateWithdrawalForReversal } = await import("@/lib/partner-withdrawals");
    const reversedAt = new Date();
    const priorRecoveryCount = await tx.partnerDebtRecovery.count({
      where: { creditCommissionId: original.id, voidedAt: null },
    });
    await invalidateWithdrawalForReversal(
      tx, original.partnerUserId, original.id,
      original.status === "PAID" || priorRecoveryCount > 0, reversedAt, params.sourceEventId,
    );
    // A credit that previously recovered debt is no longer valid after its
    // payment is refunded. Keep the allocation history, but reopen that debt.
    await tx.partnerDebtRecovery.updateMany({
      where: { creditCommissionId: original.id, voidedAt: null },
      data: { voidedAt: reversedAt, voidReason: "credit_commission_reversed" },
    });

    const reversalStatus =
      original.status === "PAID" ? ("DEBT" as const) : ("REVERSED" as const);

    if (original.status !== "PAID") {
      await tx.partnerCommission.update({
        where: {
          id: original.id,
        },
        data: {
          payoutId: null,
          status: "REVERSED",
        },
      });
    }

    await tx.partnerCommission.create({
      data: {
        amountCents: -Math.abs(original.amountCents),
        businessId: original.businessId,
        businessSubmissionId: original.businessSubmissionId,
        currency: original.currency,
        partnerUserId: original.partnerUserId,
        paymentId: original.paymentId,
        reversedAt,
        reversalReason: params.reason,
        sourceEventId: params.sourceEventId,
        sourceEventType: params.eventType,
        sourceKey: reversalKey,
        status: reversalStatus,
        stripeChargeId: params.stripeChargeId ?? original.stripeChargeId,
        stripeCheckoutSessionId: original.stripeCheckoutSessionId,
        stripePaymentIntentId: params.stripePaymentIntentId ?? original.stripePaymentIntentId,
        type: "REVERSAL",
      },
    });
  });

  (dependencies.revalidatePaths ?? revalidatePartnerLedgerPaths)();
}

export async function reserveAvailablePartnerCommissions(params: {
  partnerUserId: string;
  payoutRunId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const profile = await tx.localPartnerProfile.findUnique({
      where: {
        userId: params.partnerUserId,
      },
      select: {
        id: true,
        preferredLanguage: true,
        preferredPayoutMethod: true,
        paypalPayoutEmail: true,
        bankPayoutAccountLast4: true,
        bankPayoutAccountHolder: true,
        stripeConnectedAccountId: true,
        stripePayoutAccountLast4: true,
        stripePayoutBankName: true,
        user: {
          select: {
            email: true,
            id: true,
          },
        },
      },
    });

    if (!profile) {
      return null;
    }

    await tx.localPartnerProfile.update({
      where: { userId: params.partnerUserId }, data: { updatedAt: new Date() },
    });

    // A Partner using the new request/debt ledger must never also enter the
    // old all-commission batch. The batch cannot represent partial debt use.
    const [withdrawalCount, recoveryCount, debtCount] = await Promise.all([
      tx.partnerWithdrawal.count({ where: { partnerUserId: params.partnerUserId } }),
      tx.partnerDebtRecovery.count({ where: { partnerUserId: params.partnerUserId } }),
      tx.partnerCommission.count({ where: { partnerUserId: params.partnerUserId, type: "REVERSAL", status: "DEBT" } }),
    ]);
    if (withdrawalCount || recoveryCount || debtCount) return null;

    const commissions = await tx.partnerCommission.findMany({
      where: {
        ...payableCommissionWhere(new Date()),
        partnerUserId: params.partnerUserId,
      },
      orderBy: {
        eligibleAt: "asc",
      },
      select: {
        amountCents: true,
        businessId: true,
        businessSubmissionId: true,
        id: true,
        payment: { select: { businessId: true, businessSubmissionId: true } },
        business: {
          select: {
            name: true,
            membership: { select: { originatingPartnerUserId: true } },
          },
        },
        businessSubmission: {
          select: {
            businessName: true,
            userId: true,
            createdBusiness: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (commissions.some((commission) => !commission.payment || !commission.businessId ||
      commission.payment.businessId !== commission.businessId ||
      commission.payment.businessSubmissionId !== commission.businessSubmissionId ||
      commission.businessSubmission?.userId !== params.partnerUserId ||
      commission.business?.membership?.originatingPartnerUserId !== params.partnerUserId)) {
      throw new Error("commission_payment_attribution_conflict");
    }

    const amountCents = commissions.reduce((sum, commission) => sum + commission.amountCents, 0);

    if (amountCents < getPartnerMinimumPayoutCents()) {
      return null;
    }

    const payout = await tx.partnerPayout.create({
      data: {
        amountCents,
        attemptCount: 0,
        bankAccountLast4: profile.preferredPayoutMethod === "STRIPE" ? profile.stripePayoutAccountLast4 : profile.bankPayoutAccountLast4,
        bankName: profile.preferredPayoutMethod === "STRIPE" ? profile.stripePayoutBankName : profile.preferredPayoutMethod,
        currency: "eur",
        localPartnerProfileId: profile.id,
        partnerUserId: params.partnerUserId,
        payoutRunId: params.payoutRunId,
        status: "SCHEDULED",
        payoutMethod: profile.preferredPayoutMethod,
        stripeConnectedAccountId: profile.preferredPayoutMethod === "STRIPE" ? profile.stripeConnectedAccountId : null,
      },
    });

    const reservation = await tx.partnerCommission.updateMany({
      where: {
        id: { in: commissions.map((commission) => commission.id) },
        ...payableCommissionWhere(new Date()),
      },
      data: { payoutId: payout.id, status: "RESERVED" },
    });
    if (reservation.count !== commissions.length) {
      throw new Error("commission_reservation_changed");
    }

    return {
      businessCount: commissions.length,
      businessNames: commissions.map((commission) => getCommissionBusinessName(commission)),
      email: profile.user.email,
      locale: getLocale(profile.preferredLanguage),
      paypalPayoutEmail: profile.paypalPayoutEmail,
      payout,
    };
  });
}

async function recordPayoutNotSent(params: {
  amountCents: number;
  bankAccountLast4?: string | null;
  bankName?: string | null;
  localPartnerProfileId?: string | null;
  locale: Locale;
  partnerUserId: string;
  payoutRunId: string;
  payoutMethod?: "STRIPE" | "PAYPAL" | "POSTEPAY" | "HYPE";
  reason: "bank-account-not-connected" | "bank-account-not-ready" | "paypal-not-configured" | "sepa-rail-unavailable";
  stripeConnectedAccountId?: string | null;
}) {
  const failureMessage = getPayoutNotSentMessage(params.locale, params.reason);
  const existing = await prisma.partnerPayout.findFirst({
    where: {
      attemptCount: 0,
      partnerUserId: params.partnerUserId,
      payoutRunId: params.payoutRunId,
      status: "ACTION_REQUIRED",
      stripePayoutId: null,
      stripeTransferId: null,
    },
    select: {
      id: true,
    },
  });

  const data = {
    actionRequiredAt: new Date(),
    amountCents: params.amountCents,
    bankAccountLast4: params.bankAccountLast4 ?? null,
    bankName: params.bankName ?? null,
    failureMessage,
    localPartnerProfileId: params.localPartnerProfileId ?? null,
    payoutMethod: params.payoutMethod ?? "STRIPE",
    stripeConnectedAccountId: params.stripeConnectedAccountId ?? null,
  };

  if (existing) {
    return prisma.partnerPayout.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.partnerPayout.create({
    data: {
      ...data,
      attemptCount: 0,
      currency: "eur",
      partnerUserId: params.partnerUserId,
      payoutRunId: params.payoutRunId,
      status: "ACTION_REQUIRED",
    },
  });
}

async function retryReservedPartnerPayout(payout: Pick<
  PartnerPayout,
  | "amountCents"
  | "attemptCount"
  | "currency"
  | "id"
  | "partnerUserId"
  | "stripeConnectedAccountId"
>) {
  await assertPartnerPayoutHasOnlyLivePayments(payout.id);
  if (!payout.stripeConnectedAccountId) {
    return null;
  }

  const stripe = getStripe();
  const nextAttemptCount = payout.attemptCount + 1;
  const stripePayout = await stripe.payouts.create(
    {
      amount: payout.amountCents,
      currency: payout.currency,
      metadata: {
        partnerPayoutId: payout.id,
        partnerUserId: payout.partnerUserId,
      },
    },
    {
      idempotencyKey: `partner-payout-retry-${payout.id}-${nextAttemptCount}`,
      stripeAccount: payout.stripeConnectedAccountId,
    },
  );

  return prisma.partnerPayout.update({
    where: {
      id: payout.id,
    },
    data: {
      attemptCount: nextAttemptCount,
      failureMessage: null,
      initiatedAt: new Date(),
      status: "PROCESSING",
      stripePayoutId: stripePayout.id,
    },
  });
}

async function settleInFlightSandboxPayouts() {
  const payouts = await prisma.partnerPayout.findMany({
    where: {
      status: {
        in: ["PROCESSING", "SCHEDULED"],
      },
    },
    include: {
      localPartnerProfile: {
        select: {
          preferredLanguage: true,
          preferredPayoutMethod: true,
          payoutSetupStatus: true,
          paypalPayoutEmail: true,
          bankPayoutAccountLast4: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  });

  for (const payout of payouts) {
    try { await assertPartnerPayoutHasOnlyLivePayments(payout.id); }
    catch { continue; }
    await settleSandboxPartnerPayout({
      email: payout.localPartnerProfile?.user.email ?? "",
      locale: getLocale(payout.localPartnerProfile?.preferredLanguage),
      payout,
    });
  }
}

async function syncPendingPaypalPayouts() {
  if (!isPaypalPayoutConfigured()) return;
  const payouts = await prisma.partnerPayout.findMany({
    where: { payoutMethod: "PAYPAL", providerBatchId: { not: null }, status: "PROCESSING" },
    select: { id: true, providerBatchId: true },
  });
  for (const payout of payouts) {
    try {
      await assertPartnerPayoutHasOnlyLivePayments(payout.id);
      const paypal = await getPaypalPayoutBatch(payout.providerBatchId!);
      if (paypal.itemStatus === "SUCCESS") {
        await prisma.$transaction(async (tx) => {
          await tx.partnerPayout.update({ where: { id: payout.id }, data: { paidAt: new Date(), providerPayoutId: paypal.itemId, status: "PAID" } });
          await tx.partnerCommission.updateMany({ where: { payoutId: payout.id, status: "RESERVED" }, data: { paidAt: new Date(), status: "PAID" } });
        });
      } else if (["FAILED", "RETURNED", "DENIED", "BLOCKED"].includes(paypal.itemStatus)) {
        await prisma.$transaction(async (tx) => {
          await tx.partnerPayout.update({ where: { id: payout.id }, data: { actionRequiredAt: new Date(), failureMessage: "PayPal could not complete this payout.", providerPayoutId: paypal.itemId, status: "ACTION_REQUIRED" } });
          await tx.partnerCommission.updateMany({ where: { payoutId: payout.id, status: "RESERVED" }, data: { payoutId: null, status: "AVAILABLE" } });
        });
      }
    } catch (error) {
      console.error("[partner-payout:paypal-sync]", { error, payoutId: payout.id });
    }
  }
}

async function createTransferAndPayout(params: {
  email: string;
  locale: Locale;
  paypalPayoutEmail?: string | null;
  payout: PartnerPayout;
}) {
  await assertPartnerPayoutHasOnlyLivePayments(params.payout.id);
  if (params.payout.payoutMethod === "PAYPAL") {
    if (!params.paypalPayoutEmail) throw new Error("missing_paypal_email");
    try {
      const paypal = await createPaypalPayout({
        amountCents: params.payout.amountCents,
        payoutId: params.payout.id,
        recipientEmail: params.paypalPayoutEmail,
      });
      await prisma.partnerPayout.update({
        where: { id: params.payout.id },
        data: {
          attemptCount: 1,
          providerBatchId: paypal.batchId,
          providerReference: paypal.providerReference,
          status: "PROCESSING",
        },
      });
      await sendPartnerPayoutEmailSafely({ amountCents: params.payout.amountCents, email: params.email, locale: params.locale, partnerUserId: params.payout.partnerUserId, payoutId: params.payout.id, status: "initiated" });
      return true;
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.partnerPayout.update({ where: { id: params.payout.id }, data: { failedAt: new Date(), failureMessage: getFriendlyPayoutFailureMessage(params.locale), status: "FAILED" } });
        await tx.partnerCommission.updateMany({ where: { payoutId: params.payout.id, status: "RESERVED" }, data: { payoutId: null, status: "AVAILABLE" } });
      });
      console.error("[partner-payout:paypal]", error);
      return false;
    }
  }
  if (!params.payout.stripeConnectedAccountId) {
    throw new Error("missing_connected_account");
  }

  await syncPendingPaypalPayouts();
  if (isStripeSandboxMode()) {
    await settleSandboxPartnerPayout({
      email: params.email,
      locale: params.locale,
      payout: {
        amountCents: params.payout.amountCents,
        attemptCount: params.payout.attemptCount,
        bankAccountLast4: params.payout.bankAccountLast4,
        bankName: params.payout.bankName,
        id: params.payout.id,
        partnerUserId: params.payout.partnerUserId,
        stripePayoutId: params.payout.stripePayoutId,
        stripeTransferId: params.payout.stripeTransferId,
      },
    });

    return true;
  }

  const stripe = getStripe();
  let createdTransferId = "";

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: params.payout.amountCents,
        currency: params.payout.currency,
        destination: params.payout.stripeConnectedAccountId,
        metadata: {
          partnerPayoutId: params.payout.id,
          partnerUserId: params.payout.partnerUserId,
        },
        transfer_group: params.payout.id,
      },
      {
        idempotencyKey: `partner-transfer-${params.payout.id}`,
      },
    );
    createdTransferId = transfer.id;

    const stripePayout = await stripe.payouts.create(
      {
        amount: params.payout.amountCents,
        currency: params.payout.currency,
        metadata: {
          partnerPayoutId: params.payout.id,
          partnerUserId: params.payout.partnerUserId,
        },
      },
      {
        idempotencyKey: `partner-payout-${params.payout.id}-1`,
        stripeAccount: params.payout.stripeConnectedAccountId,
      },
    );

    await prisma.$transaction(async (tx) => {
      await tx.partnerPayout.update({
        where: {
          id: params.payout.id,
        },
        data: {
          attemptCount: 1,
          status: "PROCESSING",
          stripePayoutId: stripePayout.id,
          stripeTransferId: transfer.id,
        },
      });

      await tx.partnerCommission.updateMany({
        where: {
          payoutId: params.payout.id,
          status: "RESERVED",
        },
        data: {
          stripePayoutId: stripePayout.id,
          stripeTransferId: transfer.id,
          transferredAt: new Date(),
        },
      });
    });

    await sendPartnerPayoutEmailSafely({
      amountCents: params.payout.amountCents,
      email: params.email,
      locale: params.locale,
      partnerUserId: params.payout.partnerUserId,
      payoutId: params.payout.id,
      status: "initiated",
    });

    return true;
  } catch (error) {
    if (isStripeSandboxMode() && isStripeInsufficientBalanceError(error)) {
      const simulatedTransferId =
        createdTransferId || `sandbox-transfer-${params.payout.id}`;
      const simulatedPayoutId = `sandbox-payout-${params.payout.id}`;
      const settledAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.partnerPayout.update({
          where: {
            id: params.payout.id,
          },
          data: {
            attemptCount: 1,
            failedAt: null,
            failureMessage: null,
            initiatedAt: settledAt,
            paidAt: settledAt,
            status: "PAID",
            stripePayoutId: simulatedPayoutId,
            stripeTransferId: simulatedTransferId,
          },
        });

        await tx.partnerCommission.updateMany({
          where: {
            payoutId: params.payout.id,
            status: "RESERVED",
          },
          data: {
            paidAt: settledAt,
            status: "PAID",
            stripePayoutId: simulatedPayoutId,
            stripeTransferId: simulatedTransferId,
            transferredAt: settledAt,
          },
        });
      });

      console.warn("[partner-payout:sandbox-simulated]", {
        message:
          error instanceof Error ? error.message : "Simulated payout after Stripe sandbox failure",
        partnerUserId: params.payout.partnerUserId,
        payoutId: params.payout.id,
      });

      await sendPartnerPayoutEmailSafely({
        amountCents: params.payout.amountCents,
        email: params.email,
        locale: params.locale,
        partnerUserId: params.payout.partnerUserId,
        payoutId: params.payout.id,
        status: "paid",
      });

      return true;
    }

    if (createdTransferId) {
      try {
        await stripe.transfers.createReversal(
          createdTransferId,
          {
            amount: params.payout.amountCents,
            description: "Partner payout setup failed before bank payout creation",
          },
          {
            idempotencyKey: `partner-transfer-reversal-${params.payout.id}`,
          },
        );
      } catch {
        // Preserve the original failure while still keeping a traceable payout record.
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.partnerPayout.update({
        where: {
          id: params.payout.id,
        },
        data: {
          failureMessage: getFriendlyPayoutFailureMessage(params.locale),
          failedAt: new Date(),
          status: "FAILED",
          stripeTransferId: createdTransferId || null,
        },
      });

      await tx.partnerCommission.updateMany({
        where: {
          payoutId: params.payout.id,
          status: "RESERVED",
        },
        data: {
          payoutId: null,
          status: "AVAILABLE",
          stripePayoutId: null,
          stripeTransferId: null,
          transferredAt: null,
        },
      });
    });

    console.error("[partner-payout:create]", error);
    await sendPartnerPayoutEmailSafely({
      amountCents: params.payout.amountCents,
      email: params.email,
      locale: params.locale,
      partnerUserId: params.payout.partnerUserId,
      payoutId: params.payout.id,
      status: "action-required",
    });

    return false;
  }
}

async function retryExistingPartnerPayouts(payoutRunId: string) {
  const pendingPayouts = await prisma.partnerPayout.findMany({
    where: {
      payoutRunId,
      status: {
        in: ["FAILED", "ACTION_REQUIRED", "CANCELED"],
      },
      stripeTransferId: {
        not: null,
      },
    },
    include: {
      localPartnerProfile: {
        select: {
          preferredLanguage: true,
          user: {
            select: {
              email: true,
              id: true,
            },
          },
        },
      },
    },
  });

  for (const payout of pendingPayouts) {
    const synced = await syncPartnerStripeAccountStatus(payout.partnerUserId);

    if (synced?.setupState !== "ready") {
      continue;
    }

    await retryReservedPartnerPayout({
      amountCents: payout.amountCents,
      attemptCount: payout.attemptCount,
      currency: payout.currency,
      id: payout.id,
      partnerUserId: payout.partnerUserId,
      stripeConnectedAccountId: payout.stripeConnectedAccountId,
    });
  }
}

export async function runWeeklyPartnerPayouts(params?: {
  force?: boolean;
}) {
  const now = new Date();
  const isManualRun = Boolean(params?.force);
  const targetDate = isManualRun ? now : getNextPartnerPayoutDate(now);
  // The legacy provider path releases reservations after ambiguous failures.
  // Keep history and signed-webhook reconciliation available, but require a
  // separate, explicit execution release until that path is repaired.
  if (process.env.PARTNER_LEGACY_PAYOUT_EXECUTION_ENABLED !== "true" ||
      !areRealPartnerDisbursementsAllowed()) {
    return {
      processedPartners: 0,
      runKey: buildRunKey(targetDate),
      scheduledFor: targetDate,
      status: "skipped-payouts-disabled" as const,
    };
  }
  const isScheduledDay =
    new Intl.DateTimeFormat("en-US", {
      timeZone: getPartnerPayoutTimezone(),
      weekday: "long",
    })
      .format(now)
      .toLowerCase() === getPartnerPayoutDay();

  if (!params?.force && !isScheduledDay) {
    return {
      processedPartners: 0,
      runKey: buildRunKey(targetDate),
      scheduledFor: targetDate,
      status: "skipped" as const,
    };
  }

  const scheduledFor = targetDate;
  const runKey = isManualRun ? `manual-${scheduledFor.toISOString()}` : buildRunKey(scheduledFor);
  const existingRun = await prisma.partnerPayoutRun.findUnique({
    where: {
      runKey,
    },
  });
  const payoutRun =
    existingRun ??
    (await prisma.partnerPayoutRun.create({
      data: {
        runKey,
        scheduledFor,
        status: "RUNNING",
      },
    }));

  if (existingRun && existingRun.status === "COMPLETED") {
    return {
      processedPartners: 0,
      runKey,
      scheduledFor,
      status: "already-completed" as const,
    };
  }

  await prisma.partnerPayoutRun.update({
    where: {
      id: payoutRun.id,
    },
    data: {
      lastError: null,
      startedAt: existingRun?.startedAt ?? new Date(),
      status: "RUNNING",
    },
  });

  if (isStripeSandboxMode()) {
    await settleInFlightSandboxPayouts();
  } else {
    await retryExistingPartnerPayouts(payoutRun.id);
  }

  const partners = await prisma.user.findMany({
    where: {
      partnerCommissions: {
        some: {
          ...payableCommissionWhere(new Date()),
        },
      },
      role: "GETTER",
    },
    select: {
      email: true,
      id: true,
      localPartnerProfile: {
        select: {
          fullName: true,
          id: true,
          preferredLanguage: true,
          preferredPayoutMethod: true,
          paypalPayoutEmail: true,
          bankPayoutAccountLast4: true,
          stripeAccountStatus: true,
          stripeConnectedAccountId: true,
          stripePayoutAccountLast4: true,
          stripePayoutBankName: true,
          stripePayoutsEnabled: true,
        },
      },
    },
  });

  let processedPartners = 0;
  let failedPartners = 0;
  const partnerSummaries: PartnerPayoutRunSummaryItem[] = [];

  for (const partner of partners) {
    const pendingCommissions = await prisma.partnerCommission.findMany({
      where: {
        ...payableCommissionWhere(new Date()),
        partnerUserId: partner.id,
      },
      select: {
        amountCents: true,
        business: {
          select: {
            name: true,
          },
        },
        businessSubmission: {
          select: {
            businessName: true,
            createdBusiness: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!pendingCommissions.length) {
      partnerSummaries.push({
        businessCount: 0,
        businessNames: [],
        failureMessage: null,
        partnerName: partner.localPartnerProfile?.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "skipped-no-commissions",
        stripeTransferId: null,
        totalPaidCents: 0,
      });
      continue;
    }

    const pendingBusinessNames = pendingCommissions.map((commission) =>
      getCommissionBusinessName(commission),
    );
    const pendingAmountCents = pendingCommissions.reduce(
      (total, commission) => total + commission.amountCents,
      0,
    );
    const payoutLocale = getLocale(partner.localPartnerProfile?.preferredLanguage);

    if (pendingAmountCents < getPartnerMinimumPayoutCents()) {
      partnerSummaries.push({
        businessCount: pendingCommissions.length,
        businessNames: pendingBusinessNames,
        failureMessage: "below_minimum_payout",
        partnerName: partner.localPartnerProfile?.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "skipped-below-minimum",
        stripeTransferId: null,
        totalPaidCents: 0,
      });
      continue;
    }

    const partnerProfile = partner.localPartnerProfile;
    if (!partnerProfile) {
      failedPartners += 1;
      partnerSummaries.push({ businessCount: pendingCommissions.length, businessNames: pendingBusinessNames, failureMessage: "missing_partner_profile", partnerName: partner.email || "", partnerUserId: partner.id, status: "skipped-setup-incomplete", stripeTransferId: null, totalPaidCents: 0 });
      continue;
    }
    const payoutMethod = partnerProfile.preferredPayoutMethod;

    if (payoutMethod === "PAYPAL" && (!partnerProfile.paypalPayoutEmail || !isPaypalPayoutConfigured())) {
      await recordPayoutNotSent({
        amountCents: pendingAmountCents,
        locale: payoutLocale,
        localPartnerProfileId: partnerProfile.id,
        partnerUserId: partner.id,
        payoutRunId: payoutRun.id,
        payoutMethod,
        reason: "paypal-not-configured",
      });
      failedPartners += 1;
      partnerSummaries.push({ businessCount: pendingCommissions.length, businessNames: pendingBusinessNames, failureMessage: "paypal_not_configured", partnerName: partnerProfile.fullName || partner.email || "", partnerUserId: partner.id, status: "skipped-setup-incomplete", stripeTransferId: null, totalPaidCents: 0 });
      continue;
    }

    if ((payoutMethod === "POSTEPAY" || payoutMethod === "HYPE")) {
      await recordPayoutNotSent({
        amountCents: pendingAmountCents,
        bankAccountLast4: partnerProfile.bankPayoutAccountLast4,
        bankName: payoutMethod,
        locale: payoutLocale,
        localPartnerProfileId: partnerProfile.id,
        partnerUserId: partner.id,
        payoutRunId: payoutRun.id,
        payoutMethod,
        reason: "sepa-rail-unavailable",
      });
      failedPartners += 1;
      partnerSummaries.push({ businessCount: pendingCommissions.length, businessNames: pendingBusinessNames, failureMessage: "sepa_rail_unavailable", partnerName: partnerProfile.fullName || partner.email || "", partnerUserId: partner.id, status: "skipped-setup-incomplete", stripeTransferId: null, totalPaidCents: 0 });
      continue;
    }

    if (payoutMethod === "STRIPE" && !partnerProfile.stripeConnectedAccountId) {
      await recordPayoutNotSent({
        amountCents: pendingAmountCents,
        locale: payoutLocale,
        localPartnerProfileId: partnerProfile.id,
        partnerUserId: partner.id,
        payoutRunId: payoutRun.id,
        reason: "bank-account-not-connected",
      });
      failedPartners += 1;
      partnerSummaries.push({
        businessCount: pendingCommissions.length,
        businessNames: pendingBusinessNames,
        failureMessage: "missing_connected_account",
        partnerName: partnerProfile.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "skipped-setup-incomplete",
        stripeTransferId: null,
        totalPaidCents: 0,
      });
      continue;
    }

    let synced: Awaited<ReturnType<typeof syncPartnerStripeAccountStatus>> | { setupState: "ready"; payoutsEnabled: boolean } | null;
    try {
      synced = payoutMethod === "STRIPE"
        ? await syncPartnerStripeAccountStatus(partner.id, { force: true })
        : { setupState: "ready", payoutsEnabled: true };
    } catch (error) {
      console.error("[partner-payout:eligibility-check]", error);
      synced = null;
    }

    if (synced?.setupState !== "ready" || !synced?.payoutsEnabled) {
      await recordPayoutNotSent({
        amountCents: pendingAmountCents,
        bankAccountLast4: partnerProfile.stripePayoutAccountLast4,
        bankName: partnerProfile.stripePayoutBankName,
        locale: payoutLocale,
        localPartnerProfileId: partnerProfile.id,
        partnerUserId: partner.id,
        payoutRunId: payoutRun.id,
        reason: "bank-account-not-ready",
        stripeConnectedAccountId: partnerProfile.stripeConnectedAccountId,
      });
      failedPartners += 1;
      partnerSummaries.push({
        businessCount: pendingCommissions.length,
        businessNames: pendingBusinessNames,
        failureMessage: synced?.setupState ?? "payout_readiness_unavailable",
        partnerName: partnerProfile.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "skipped-setup-incomplete",
        stripeTransferId: null,
        totalPaidCents: 0,
      });
      continue;
    }

    const reserved = await reserveAvailablePartnerCommissions({
      partnerUserId: partner.id,
      payoutRunId: payoutRun.id,
    });

    if (!reserved) {
      partnerSummaries.push({
        businessCount: pendingCommissions.length,
        businessNames: pendingBusinessNames,
        failureMessage: "below_minimum_payout",
        partnerName: partnerProfile.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "skipped-below-minimum",
        stripeTransferId: null,
        totalPaidCents: 0,
      });
      continue;
    }

    processedPartners += 1;
    const success = await createTransferAndPayout({
      email: reserved.email ?? "",
      locale: reserved.locale,
      paypalPayoutEmail: reserved.paypalPayoutEmail,
      payout: reserved.payout,
    });

    if (!success) {
      failedPartners += 1;
      const failedPayout = await prisma.partnerPayout.findUnique({
        where: {
          id: reserved.payout.id,
        },
        select: {
          failureMessage: true,
          stripeTransferId: true,
        },
      });
      partnerSummaries.push({
        businessCount: reserved.businessCount,
        businessNames: reserved.businessNames,
        failureMessage: failedPayout?.failureMessage ?? "payout_failed",
        partnerName: partnerProfile.fullName || partner.email || "",
        partnerUserId: partner.id,
        status: "failed",
        stripeTransferId: failedPayout?.stripeTransferId ?? null,
        totalPaidCents: 0,
      });
      continue;
    }

    const createdPayout = await prisma.partnerPayout.findUnique({
      where: {
        id: reserved.payout.id,
      },
      select: {
        status: true,
        stripeTransferId: true,
      },
    });
    partnerSummaries.push({
      businessCount: reserved.businessCount,
      businessNames: reserved.businessNames,
      failureMessage: null,
        partnerName: partnerProfile.fullName || partner.email || "",
      partnerUserId: partner.id,
      status: createdPayout?.status === "PAID" ? "paid" : "processing",
      stripeTransferId: createdPayout?.stripeTransferId ?? null,
      totalPaidCents: reserved.payout.amountCents,
    });
  }

  await prisma.partnerPayoutRun.update({
    where: {
      id: payoutRun.id,
    },
    data: {
      completedAt: new Date(),
      status:
        failedPartners > 0
          ? processedPartners > failedPartners
            ? "PARTIAL"
            : "FAILED"
          : "COMPLETED",
      summary: {
        failedPartners,
        minimumPayoutCents: getPartnerMinimumPayoutCents(),
        partnerSummaries,
        processedPartners,
        scheduledFor: formatPayoutDate(scheduledFor, "en"),
      },
    },
  });

  revalidatePartnerLedgerPaths();

  const status =
    failedPartners > 0
      ? processedPartners > 0
        ? ("partial" as const)
        : ("failed" as const)
      : ("completed" as const);

  return {
    failedPartners,
    partnerSummaries,
    processedPartners,
    runKey,
    scheduledFor,
    status,
  };
}

export async function handleConnectedPayoutEvent(params: {
  bankAccountLast4?: string | null;
  bankName?: string | null;
  eventType: "payout.canceled" | "payout.failed" | "payout.paid";
  payoutId: string;
}) {
  const payout = await prisma.partnerPayout.findFirst({
    where: {
      stripePayoutId: params.payoutId,
    },
    include: {
      localPartnerProfile: {
        select: {
          preferredLanguage: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  });

  if (!payout) {
    return;
  }

  // A duplicate or late provider event must not reopen an already settled payout.
  if (payout.status === "PAID") return;

  const locale = getLocale(payout.localPartnerProfile?.preferredLanguage);
  const email = payout.localPartnerProfile?.user.email;

  if (params.eventType === "payout.paid") {
    await assertPartnerPayoutHasOnlyLivePayments(payout.id);
    await prisma.$transaction(async (tx) => {
      await tx.partnerPayout.update({
        where: {
          id: payout.id,
        },
        data: {
          bankAccountLast4: params.bankAccountLast4 ?? payout.bankAccountLast4,
          bankName: params.bankName ?? payout.bankName,
          paidAt: new Date(),
          status: "PAID",
        },
      });

      await tx.partnerCommission.updateMany({
        where: {
          payoutId: payout.id,
          status: "RESERVED",
        },
        data: {
          paidAt: new Date(),
          status: "PAID",
        },
      });
    });

    await sendPartnerPayoutEmailSafely({
      amountCents: payout.amountCents,
      email,
      locale,
      partnerUserId: payout.partnerUserId,
      payoutId: payout.id,
      status: "paid",
    });
  } else {
    const nextStatus: PartnerPayoutStatus =
      params.eventType === "payout.canceled" ? "CANCELED" : "ACTION_REQUIRED";

    await prisma.partnerPayout.update({
      where: {
        id: payout.id,
      },
      data: {
        actionRequiredAt: new Date(),
        bankAccountLast4: params.bankAccountLast4 ?? payout.bankAccountLast4,
        bankName: params.bankName ?? payout.bankName,
        failureMessage: getFriendlyPayoutFailureMessage(locale),
        status: nextStatus,
      },
    });

    await sendPartnerPayoutEmailSafely({
      amountCents: payout.amountCents,
      email,
      locale,
      partnerUserId: payout.partnerUserId,
      payoutId: payout.id,
      status: "action-required",
    });
  }

  revalidatePartnerLedgerPaths();
}

export async function getPartnerPayoutAdminOverview(selectedRunKey?: string | null) {
  const [profiles, payouts, runs, webhooks, commissions, partners, selectedRun] = await Promise.all([
    prisma.localPartnerProfile.findMany({
      where: {
        user: {
          role: "GETTER",
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 12,
      select: {
        fullName: true,
        stripeAccountStatus: true,
        stripePayoutsEnabled: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            username: true,
          },
        },
      },
    }),
    prisma.partnerPayout.findMany({
      orderBy: {
        initiatedAt: "desc",
      },
      take: 12,
      select: {
        amountCents: true,
        failureMessage: true,
        initiatedAt: true,
        paidAt: true,
        payoutMethod: true,
        providerBatchId: true,
        providerReference: true,
        partnerUser: {
          select: {
            username: true,
          },
        },
        status: true,
      },
    }),
    prisma.partnerPayoutRun.findMany({
      orderBy: {
        scheduledFor: "desc",
      },
      take: 8,
    }),
    prisma.stripeWebhookEvent.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 12,
    }),
    prisma.partnerCommission.findMany({
      where: {
        amountCents: {
          gt: 0,
        },
        payment: { is: { stripeLivemode: true } },
        type: "COMMISSION",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        amountCents: true,
        partnerUserId: true,
        status: true,
        business: {
          select: {
            name: true,
          },
        },
        businessSubmission: {
          select: {
            businessName: true,
            createdBusiness: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        role: "GETTER",
      },
      select: {
        email: true,
        id: true,
        username: true,
        localPartnerProfile: {
          select: {
            fullName: true,
            preferredPayoutMethod: true,
            stripeAccountStatus: true,
            stripeConnectedAccountId: true,
            stripePayoutsEnabled: true,
          },
        },
        partnerPayouts: {
          orderBy: {
            initiatedAt: "desc",
          },
          select: {
            initiatedAt: true,
            paidAt: true,
          },
          take: 1,
        },
      },
    }),
    selectedRunKey
      ? prisma.partnerPayoutRun.findUnique({
          where: {
            runKey: selectedRunKey,
          },
        })
      : Promise.resolve(null),
  ]);

  const pendingByPartner = new Map<
    string,
    {
      amountCents: number;
      businessCount: number;
      businessNames: string[];
    }
  >();
  const paidTotalsByPartner = new Map<string, number>();

  for (const commission of commissions) {
    if (commission.status === "PAID") {
      paidTotalsByPartner.set(
        commission.partnerUserId,
        (paidTotalsByPartner.get(commission.partnerUserId) ?? 0) + commission.amountCents,
      );
      continue;
    }

    if (!shouldCountAsToBePaid(commission.status)) {
      continue;
    }

    const current = pendingByPartner.get(commission.partnerUserId) ?? {
      amountCents: 0,
      businessCount: 0,
      businessNames: [],
    };
    current.amountCents += commission.amountCents;
    current.businessCount += 1;
    current.businessNames.push(getCommissionBusinessName(commission));
    pendingByPartner.set(commission.partnerUserId, current);
  }

  const partnerSummaries = partners
    .map((partner) => {
      const pending = pendingByPartner.get(partner.id) ?? {
        amountCents: 0,
        businessCount: 0,
        businessNames: [],
      };
      return {
        email: partner.email,
        fullName: partner.localPartnerProfile?.fullName || partner.username,
        lastPayoutDate:
          partner.partnerPayouts[0]?.paidAt ??
          partner.partnerPayouts[0]?.initiatedAt ??
          null,
        nextPayoutBusinesses: pending.businessNames,
        paidAmountCents: paidTotalsByPartner.get(partner.id) ?? 0,
        pendingAmountCents: pending.amountCents,
        pendingCommissionCount: pending.businessCount,
        stripeAccountStatus: partner.localPartnerProfile?.stripeAccountStatus ?? "NOT_STARTED",
        stripePayoutsEnabled: partner.localPartnerProfile?.stripePayoutsEnabled ?? false,
        payoutMethod: partner.localPartnerProfile?.preferredPayoutMethod ?? "STRIPE",
        username: partner.username,
      };
    })
    .sort(
      (left, right) =>
        right.pendingAmountCents - left.pendingAmountCents ||
        left.fullName.localeCompare(right.fullName),
    );

  return {
    partnerSummaries,
    profiles,
    payouts,
    runs,
    selectedRun: selectedRunKey ? selectedRun : (runs[0] ?? null),
    webhooks,
  };
}
