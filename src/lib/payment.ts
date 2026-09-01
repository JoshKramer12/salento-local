import type {
  PaymentMethod,
  PaymentRecordMethod,
  PaymentStatus,
  SubmissionStatus,
  UserRole,
} from "@prisma/client";

import { buildBankTransferReference, formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";
import { LISTING_OFFER } from "@/lib/listing-offer";

export const DEFAULT_LISTING_PRICE_CENTS = LISTING_OFFER.firstYearPriceCents;
export const DEFAULT_COMMISSION_CENTS = 5000;
export const DEFAULT_PLATFORM_SHARE_CENTS =
  DEFAULT_LISTING_PRICE_CENTS - DEFAULT_COMMISSION_CENTS;
export const DEFAULT_CURRENCY = "eur";
const supportedStripeEuBankTransferCountries = ["DE", "FR", "IE", "NL"] as const;

export type StripeEuBankTransferCountry =
  (typeof supportedStripeEuBankTransferCountries)[number];

export function getAppUrl() {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();

  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}`.replace(/\/+$/, "");
  }

  return "http://localhost:3000";
}

export function getBankTransferDetails() {
  return {
    bankName: process.env.SALENTO_LOCAL_BANK_NAME?.trim() || "",
    beneficiary: process.env.SALENTO_LOCAL_BANK_BENEFICIARY?.trim() || "",
    iban: process.env.SALENTO_LOCAL_IBAN?.trim() || "",
  };
}

export function getStripeEuBankTransferCountry(): StripeEuBankTransferCountry {
  const configured = process.env.STRIPE_BANK_TRANSFER_EU_COUNTRY?.trim().toUpperCase();

  if (
    configured &&
    supportedStripeEuBankTransferCountries.includes(
      configured as StripeEuBankTransferCountry,
    )
  ) {
    return configured as StripeEuBankTransferCountry;
  }

  return "IE";
}

export function getPartnerUserIdForSubmission(
  viewer: { id: string; role: UserRole } | null | undefined,
) {
  return viewer?.role === "GETTER" ? viewer.id : null;
}

export function getListingPayerEmail(params: {
  ownerEmail?: string | null;
  submissionUserId: string;
  viewer: { email?: string | null; id: string; role: UserRole };
}) {
  const ownerEmail = params.ownerEmail?.trim();

  if (ownerEmail) {
    return ownerEmail;
  }

  // A Local Partner only creates the submission; they are never the listing
  // customer. Direct publishers can use their authenticated account email when
  // no separate owner email was collected.
  if (params.viewer.role !== "GETTER" && params.viewer.id === params.submissionUserId) {
    return params.viewer.email?.trim() || undefined;
  }

  return undefined;
}

export function getBankTransferReference(submissionId: string) {
  return buildBankTransferReference(submissionId);
}

export function getSubmissionOwnerUserIdForPublication(
  viewer: { id: string; role: UserRole } | null | undefined,
) {
  return viewer?.role === "BUSINESS_OWNER" ? viewer.id : null;
}

export function canPublishSubmission(paymentStatus: PaymentStatus) {
  return paymentStatus === "PAID";
}

export function getStatusAfterPayment() {
  return "PUBLISHED" as const satisfies SubmissionStatus;
}

export function getStatusAfterSubmit() {
  return "AWAITING_PAYMENT" as const satisfies SubmissionStatus;
}

export function getPendingPaymentCopy(locale: Locale) {
  return locale === "it"
    ? "Il pagamento deve essere effettuato direttamente a Salento Local. I Local Partner non sono autorizzati a raccogliere contanti o accettare pagamenti."
    : "Payment must be made directly to Salento Local. Local Partners are not allowed to collect cash or accept payment.";
}

export function getReviewAfterPaymentCopy(locale: Locale) {
  return locale === "it"
    ? "La tua scheda verra pubblicata dopo la conferma del pagamento."
    : "Your listing will be published after payment has been confirmed.";
}

// The QR card-payment flow is handed to the business owner in Italian. Keep
// this separate from the website locale so Stripe Checkout cannot inherit an
// English browser cookie while its own Checkout locale is Italian.
export function getOwnerStripeCheckoutCopy(businessName: string) {
  return {
    description: "La tua attività verrà pubblicata dopo la conferma del pagamento.",
    name: `Pubblicazione su Salento Local: ${businessName}`,
  };
}

export function formatPaymentAmount(amountCents: number, locale: Locale) {
  return formatCurrencyFromCents(amountCents, locale);
}

export function buildStripeCheckoutMetadata(params: {
  businessId?: string | null;
  businessSubmissionId: string;
  partnerId?: string | null;
  paymentFlow?: "BANK_TRANSFER" | "CHECKOUT";
  userId: string;
}) {
  return {
    businessId: params.businessId ?? "",
    businessSubmissionId: params.businessSubmissionId,
    partnerId: params.partnerId ?? "",
    paymentFlow: params.paymentFlow ?? "CHECKOUT",
    userId: params.userId,
  };
}

export function isCommissionEligible(params: {
  paymentStatus: PaymentStatus;
  status: SubmissionStatus;
}) {
  return (
    params.paymentStatus === "PAID" &&
    (params.status === "APPROVED" || params.status === "PUBLISHED")
  );
}

export function resolvePaymentMethodRecord(
  paymentMethod: PaymentMethod | null | undefined,
) : PaymentRecordMethod {
  return paymentMethod === "BANK_TRANSFER" ? "BANK_TRANSFER" : "STRIPE_CHECKOUT";
}
