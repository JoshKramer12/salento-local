import type {
  BusinessSubmission,
  PaymentMethod,
  PaymentStatus,
  SubmissionStatus,
  UserRole,
} from "@prisma/client";

import type { Locale as SiteLocale } from "@/lib/i18n";

const paymentStatusLabels: Record<PaymentStatus, Record<SiteLocale, string>> = {
  NOT_REQUIRED: {
    it: "Non richiesto",
    en: "Not required",
  },
  PENDING_PAYMENT: {
    it: "In attesa del pagamento",
    en: "Pending payment",
  },
  AWAITING_BANK_TRANSFER: {
    it: "In attesa del bonifico",
    en: "Awaiting bank transfer",
  },
  PAID: {
    it: "Pagato",
    en: "Paid",
  },
  FAILED: {
    it: "Pagamento non riuscito",
    en: "Payment failed",
  },
  REFUNDED: {
    it: "Rimborsato",
    en: "Refunded",
  },
};

export function formatCurrencyFromCents(value: number, locale: SiteLocale) {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", {
    currency: "EUR",
    style: "currency",
  }).format(value / 100);
}

export function getSubmissionStatusLabel(status: SubmissionStatus, locale: SiteLocale) {
  const labels: Record<SubmissionStatus, Record<SiteLocale, string>> = {
    DRAFT: { it: "Bozza", en: "Draft" },
    AWAITING_VERIFICATION: { it: "In attesa di verifica", en: "Awaiting verification" },
    VERIFIED: { it: "Verificata", en: "Verified" },
    AWAITING_PAYMENT: { it: "Pagamento in attesa", en: "Pending payment" },
    PAID: { it: "Pagata", en: "Paid" },
    PAYMENT_PENDING: { it: "Pagamento in attesa", en: "Pending payment" },
    PAYMENT_CONFIRMED: { it: "Pagamento confermato", en: "Payment confirmed" },
    PENDING_REVIEW: { it: "In revisione", en: "Pending review" },
    APPROVED: { it: "Approvata", en: "Approved" },
    READY_TO_PUBLISH: { it: "Pronto per la pubblicazione", en: "Ready to publish" },
    PUBLISHED: { it: "Pubblicato", en: "Published" },
    NEEDS_REVIEW: { it: "Da rivedere", en: "Needs review" },
    REJECTED: { it: "Respinto", en: "Rejected" },
  };

  return labels[status][locale];
}

export function getSubmissionStatusTone(status: SubmissionStatus) {
  switch (status) {
    case "PUBLISHED":
    case "APPROVED":
    case "PAYMENT_CONFIRMED":
    case "PAID":
    case "READY_TO_PUBLISH":
    case "VERIFIED":
      return "pill-success";
    case "AWAITING_VERIFICATION":
    case "AWAITING_PAYMENT":
    case "PENDING_REVIEW":
    case "PAYMENT_PENDING":
    case "NEEDS_REVIEW":
      return "pill-accent";
    case "REJECTED":
      return "pill-muted";
    default:
      return "pill";
  }
}

export function getPaymentMethodLabel(
  method: PaymentMethod | null | undefined,
  locale: SiteLocale,
) {
  if (!method) {
    return locale === "it" ? "Da definire" : "To be decided";
  }

  const labels: Record<PaymentMethod, Record<SiteLocale, string>> = {
    ONLINE: { it: "QR / carta", en: "QR / card" },
    CASH: { it: "Contanti", en: "Cash" },
    BANK_TRANSFER: { it: "Bonifico", en: "Bank transfer" },
    OTHER: { it: "Altro", en: "Other" },
  };

  return labels[method][locale];
}

export function getEmptyDisplayLabel(locale: SiteLocale) {
  return locale === "it" ? "Nessuno" : "None";
}

export function getAwaitingApprovalLabel(locale: SiteLocale) {
  return locale === "it" ? "In attesa di approvazione" : "Awaiting Approval";
}

export function buildBankTransferReference(submissionId: string) {
  return `SL-${submissionId.slice(-8).toUpperCase()}`;
}

export function buildPaymentStatusForMethod(
  paymentMethod: PaymentMethod | null | undefined,
): PaymentStatus {
  if (paymentMethod === "ONLINE") {
    return "PENDING_PAYMENT";
  }

  if (paymentMethod === "BANK_TRANSFER") {
    return "AWAITING_BANK_TRANSFER";
  }

  return "NOT_REQUIRED";
}

export function getPaymentStatusLabel(
  paymentStatus: PaymentStatus,
  locale: SiteLocale,
  reference?: string | null,
) {
  const label = paymentStatusLabels[paymentStatus][locale];
  return reference ? `${label} · ${reference}` : label;
}

export function isDraftLikeSubmission(submission: {
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: PaymentStatus;
  status: SubmissionStatus;
}) {
  return (
    submission.status === "DRAFT" ||
    submission.status === "AWAITING_PAYMENT" ||
    (submission.paymentMethod != null &&
      submission.paymentStatus !== "PAID" &&
      submission.status !== "PUBLISHED")
  );
}

export function getSubmissionPaymentSummary(
  submission: {
    amountOwedCents: number;
    amountPaidCents: number;
    bankTransferReference?: string | null;
    paymentMethod?: PaymentMethod | null;
    paymentStatus: PaymentStatus;
    status: SubmissionStatus;
  },
  locale: SiteLocale,
) {
  const isDraft = isDraftLikeSubmission(submission);

  if (!isDraft) {
    return {
      method: getPaymentMethodLabel(submission.paymentMethod, locale),
      paid: formatCurrencyFromCents(submission.amountPaidCents, locale),
      payment: getPaymentStatusLabel(
        submission.paymentStatus,
        locale,
        submission.bankTransferReference,
      ),
    };
  }

  if (!submission.paymentMethod) {
    const none = getEmptyDisplayLabel(locale);

    return {
      method: none,
      paid: none,
      payment: none,
    };
  }

  return {
    method: getPaymentMethodLabel(submission.paymentMethod, locale),
    paid: formatCurrencyFromCents(
      submission.amountPaidCents > 0 ? submission.amountPaidCents : submission.amountOwedCents,
      locale,
    ),
    payment: getAwaitingApprovalLabel(locale),
  };
}

export function buildSubmissionTotals(submissions: Pick<
  BusinessSubmission,
  | "amountOwedCents"
  | "amountPaidCents"
  | "commissionCents"
  | "paymentMethod"
  | "paymentStatus"
  | "status"
>[], role: UserRole | "USER" = "USER") {
  return submissions.reduce(
    (totals, submission) => {
      const isDraft = isDraftLikeSubmission(submission);
      const commissionEligible =
        submission.paymentStatus === "PAID" &&
        (submission.status === "APPROVED" || submission.status === "PUBLISHED");

      if (role === "GETTER") {
        if (commissionEligible) {
          totals.earned += submission.commissionCents;
        }
      } else {
        totals.paid += submission.amountPaidCents;
        totals.owed += submission.amountOwedCents;
        if (commissionEligible) {
          totals.earned += submission.commissionCents;
        }
      }

      if (isDraft) {
        totals.drafts += 1;
      }

      if (
        !isDraft &&
        submission.status !== "REJECTED" &&
        submission.status !== "PUBLISHED" &&
        submission.paymentStatus !== "PAID"
      ) {
        totals.awaitingPayment += 1;
      }

      if (submission.status === "PUBLISHED") {
        totals.published += 1;
      }

      return totals;
    },
    {
      awaitingPayment: 0,
      drafts: 0,
      earned: 0,
      owed: 0,
      paid: 0,
      published: 0,
    },
  );
}
