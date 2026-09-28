import type { InitialRefundState } from "@/lib/self-service-refunds";
import type { Locale } from "@/lib/i18n";

export type RefundDisplayState = "eligible" | "processing" | "support_pending" | "needs_attention" | "completed" | "closed_without_refund" | "start_failed" | "unavailable";
export type RefundDisplayPayment = {
  status: string; method?: string; amountCents?: number; currency?: string;
  refundRequestedAt: Date | string | null; refundStatus: string | null;
  stripeRefundId?: string | null; selfServiceRefundedAt?: Date | string | null;
  refundedAt?: Date | string | null; refundedAmountCents?: number | null;
};

/** Presentation only. URL notices cannot establish a request or financial completion. */
export function getRefundDisplayState({ state, payment, attemptFailed = false }: {
  state?: InitialRefundState; payment?: RefundDisplayPayment | null; attemptFailed?: boolean;
}): RefundDisplayState {
  if (payment?.status === "REFUNDED" || payment?.selfServiceRefundedAt) return "completed";
  const recorded = Boolean(payment?.refundRequestedAt || payment?.stripeRefundId);
  if (recorded) {
    if (payment?.refundStatus === "support_closed") return "closed_without_refund";
    if (["failed", "canceled", "requires_action"].includes(payment?.refundStatus ?? "")) return "needs_attention";
    if (payment?.method === "BANK_TRANSFER") return "support_pending";
    return "processing";
  }
  if (attemptFailed) return "start_failed";
  return state === "AVAILABLE" ? "eligible" : "unavailable";
}

export function refundTone(state: RefundDisplayState): "red" | "amber" | "neutral" {
  return state === "completed" ? "red" : ["processing", "support_pending", "needs_attention", "start_failed"].includes(state) ? "amber" : "neutral";
}

export function refundAmount(locale: Locale, cents: number, currency = "EUR") {
  return new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function refundDate(locale: Locale, value: Date | string, exact = false) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "long", ...(exact ? { timeStyle: "short" as const } : {}), timeZone: "Europe/Rome",
  }).format(new Date(value));
}
