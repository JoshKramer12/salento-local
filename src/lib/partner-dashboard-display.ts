import type { PaymentPurpose, PaymentStatus } from "@prisma/client";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";

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
  payment: { purpose: PaymentPurpose; status: PaymentStatus; refundRequestedAt: Date | null; refundStatus: string | null } | null;
};

/** Availability comes from payableCommissionWhere on the server, including its
 * paidAt safeguard, refund holds, payout reservation and exact 14-day boundary.
 * This helper only describes existing ledger state; it never changes it.
 */
export function getPartnerCommissionDisplay(
  entry: DashboardCommission,
  ledger: DashboardCommission[],
  payableIds: ReadonlySet<string>,
  locale: Locale,
): { tone: "green" | "yellow" | "red"; label: string } {
  const it = locale === "it";
  const amount = formatCurrencyFromCents(entry.amountCents, locale);
  const reversal = ledger.some((row) => row.type === "REVERSAL" &&
    row.sourceKey === `commission:reversal:${entry.id}` && ["REVERSED", "DEBT"].includes(row.status));
  if (entry.status === "REVERSED" || entry.status === "DEBT" || reversal) {
    return { tone: "red", label: `${amount} · ${entry.payment?.status === "REFUNDED" ? (it ? "Rimborsata · commissione annullata" : "Refunded · commission cancelled") : (it ? "Commissione annullata" : "Commission cancelled")}` };
  }
  if (entry.payment?.refundRequestedAt && entry.payment.refundStatus !== "support_closed") {
    return { tone: "yellow", label: `${amount} · ${it ? "Richiesta di rimborso in sospeso" : "Refund request pending"}` };
  }
  // A refunded payment alone cannot establish that its commission was reversed.
  if (entry.payment?.status === "REFUNDED") {
    return { tone: "yellow", label: `${amount} · ${it ? "In sospeso" : "On hold"}` };
  }
  if (entry.status === "PAID") return { tone: "green", label: `${amount} · ${it ? "Pagata" : "Paid"}` };
  if (payableIds.has(entry.id)) return { tone: "green", label: `${amount} · ${it ? "Disponibile" : "Available"}` };
  if (entry.status === "RESERVED") return { tone: "yellow", label: `${amount} · ${it ? "Pagamento in corso" : "Payout processing"}` };
  return { tone: "yellow", label: `${amount} · ${it ? "In attesa" : "Pending"}` };
}
