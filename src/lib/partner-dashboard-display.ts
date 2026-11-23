import type { PaymentPurpose, PaymentStatus } from "@prisma/client";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";
import { addUtcDays } from "@/lib/business-membership";

type PaidBusinessCandidate = {
  createdBusiness: { id: string } | null;
  payments: {
    amountCents: number;
    businessId: string | null;
    purpose: PaymentPurpose;
    status: PaymentStatus;
  }[];
};

/** A durable Business and a successful membership Payment on its exact
 * submission establish paid history. Expiry and later refunds retain it.
 * Legacy null Payment.businessId links use the submission relation; conflicting
 * non-null links never qualify. Submission UI statuses are not payment evidence.
 */
export function selectPartnerPaidBusinesses<T extends PaidBusinessCandidate>(submissions: T[]): T[] {
  return submissions.filter((submission) => {
    const businessId = submission.createdBusiness?.id;
    return Boolean(businessId && submission.payments.some((payment) =>
      payment.amountCents > 0 &&
      ["INITIAL_MEMBERSHIP", "ANNUAL_RENEWAL", "REACTIVATION"].includes(payment.purpose) &&
      (payment.status === "PAID" || payment.status === "REFUNDED") &&
      (!payment.businessId || payment.businessId === businessId),
    ));
  });
}

/** Pre-payment commission placeholders are not dashboard earnings. Filter
 * before limiting recent rows so they cannot crowd out legitimate history. */
export function selectPartnerPaidBusinessCommissions<T extends { businessId: string | null; businessSubmissionId: string | null }>(
  commissions: T[],
  paidBusinesses: { id: string; createdBusiness: { id: string } | null }[],
): T[] {
  const submissionIds = new Set(paidBusinesses.map((entry) => entry.id));
  const businessIds = new Set(paidBusinesses.flatMap((entry) => entry.createdBusiness ? [entry.createdBusiness.id] : []));
  return commissions.filter((entry) => entry.businessId
    ? businessIds.has(entry.businessId)
    : Boolean(entry.businessSubmissionId && submissionIds.has(entry.businessSubmissionId)));
}

export type DashboardCommission = {
  id: string;
  amountCents: number;
  sourceKey: string;
  status: string;
  type: string;
  payment: { paidAt?: Date | null; purpose: PaymentPurpose; status: PaymentStatus; refundRequestedAt: Date | null; refundStatus: string | null; stripeLivemode?: boolean | null } | null;
};

/** A visual countdown for verified live initial payments only. Payout status
 * remains governed by payableCommissionWhere and getPartnerCommissionDisplay. */
export function getPartnerInitialHoldProgress(
  entry: DashboardCommission & { eligibleAt: Date | null },
  now: Date,
  holdDays: number,
): { days: number; percent: number; holdEndsAt: Date } | null {
  const payment = entry.payment;
  if (!payment || payment.purpose !== "INITIAL_MEMBERSHIP" || payment.status !== "PAID" ||
    payment.stripeLivemode !== true || !payment.paidAt || !entry.eligibleAt ||
    (payment.refundRequestedAt && payment.refundStatus !== "support_closed") ||
    !["PENDING", "AVAILABLE"].includes(entry.status)) return null;
  const holdEndsAt = addUtcDays(payment.paidAt, holdDays);
  if (now >= holdEndsAt) return null;
  const days = Math.max(0, Math.floor((now.getTime() - payment.paidAt.getTime()) / 86_400_000));
  return { days: Math.min(holdDays, days), percent: Math.max(0, Math.min(100, (now.getTime() - payment.paidAt.getTime()) / (holdDays * 86_400_000) * 100)), holdEndsAt };
}

/** Availability comes from payableCommissionWhere on the server, including its
 * paidAt safeguard, refund holds, payout reservation and exact 14-day boundary.
 * This helper only describes existing ledger state; it never changes it.
 */
export function getPartnerCommissionDisplay(
  entry: DashboardCommission,
  ledger: DashboardCommission[],
  payableIds: ReadonlySet<string>,
  locale: Locale,
  paymentLivemode = true,
): { tone: "green" | "yellow" | "red"; state: "reversed" | "refund-pending" | "hold" | "excluded" | "paid" | "eligible" | "reserved" | "pending"; label: string } {
  const it = locale === "it";
  const amount = formatCurrencyFromCents(entry.amountCents, locale);
  const excludedLabel = entry.payment?.stripeLivemode === false && paymentLivemode
    ? (it ? "TEST · Non pagabile" : "TEST · Not payable")
    : entry.payment?.stripeLivemode == null
      ? (it ? "Storico/non verificato · Non pagabile" : "Historical/unverified · Not payable")
      : entry.payment?.stripeLivemode !== paymentLivemode
        ? (it ? "Modalità non valida · Non pagabile" : "Other payment mode · Not payable") : null;
  const modeLabel = excludedLabel ? `${excludedLabel} · ` : "";
  const reversal = ledger.some((row) => row.type === "REVERSAL" &&
    row.sourceKey === `commission:reversal:${entry.id}` && ["REVERSED", "DEBT"].includes(row.status));
  if (entry.status === "REVERSED" || entry.status === "DEBT" || reversal) {
    return { tone: "red", state: "reversed", label: `${amount} · ${modeLabel}${entry.payment?.status === "REFUNDED" ? (it ? "Rimborsata · commissione annullata" : "Refunded · commission cancelled") : (it ? "Commissione annullata" : "Commission cancelled")}` };
  }
  if (entry.payment?.refundRequestedAt && entry.payment.refundStatus !== "support_closed") {
    return { tone: "yellow", state: "refund-pending", label: `${amount} · ${modeLabel}${it ? "Richiesta di rimborso in sospeso" : "Refund request pending"}` };
  }
  // A refunded payment alone cannot establish that its commission was reversed.
  if (entry.payment?.status === "REFUNDED") {
    return { tone: "yellow", state: "hold", label: `${amount} · ${modeLabel}${it ? "In sospeso" : "On hold"}` };
  }
  if (excludedLabel) return { tone: "yellow", state: "excluded", label: `${amount} · ${excludedLabel}` };
  if (entry.status === "PAID") return { tone: "green", state: "paid", label: `${amount} · ${it ? "Pagata" : "Paid"}` };
  if (payableIds.has(entry.id)) return { tone: "green", state: "eligible", label: `${amount} · ${it ? "Disponibile" : "Available"}` };
  if (entry.status === "RESERVED") return { tone: "yellow", state: "reserved", label: `${amount} · ${it ? "Pagamento in corso" : "Payout processing"}` };
  return { tone: "yellow", state: "pending", label: `${amount} · ${it ? "In attesa" : "Pending"}` };
}
