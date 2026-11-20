import { addUtcDays } from "@/lib/business-membership";

export type EarningsCommission = {
  id: string;
  amountCents: number;
  eligibleAt: Date | null;
  status: string;
  payout?: { paidAt: Date | null } | null;
  payment: {
    paidAt?: Date | null;
    purpose: string;
    status: string;
    refundRequestedAt: Date | null;
    refundStatus: string | null;
    stripeLivemode?: boolean | null;
  } | null;
};

/** Display projection only. The server's payableCommissionWhere remains authoritative. */
export function expectedEligibilityAt(entry: EarningsCommission, now: Date, holdDays: number): Date | null {
  const payment = entry.payment;
  if (!payment || payment.stripeLivemode !== true || payment.status !== "PAID" ||
    !["PENDING", "AVAILABLE"].includes(entry.status) || entry.amountCents <= 0 ||
    !entry.eligibleAt || entry.eligibleAt <= now ||
    (payment.refundRequestedAt && payment.refundStatus !== "support_closed")) return null;
  if (payment.purpose === "INITIAL_MEMBERSHIP") {
    if (!payment.paidAt || addUtcDays(payment.paidAt, holdDays) > entry.eligibleAt) return null;
  } else if (!["ANNUAL_RENEWAL", "REACTIVATION"].includes(payment.purpose)) return null;
  return entry.eligibleAt;
}

export function nextPendingEligibility(entries: EarningsCommission[], now: Date, holdDays: number) {
  const upcoming = entries.map((entry) => ({ entry, date: expectedEligibilityAt(entry, now, holdDays) }))
    .filter((item): item is { entry: EarningsCommission; date: Date } => item.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (!upcoming.length) return null;
  const first = upcoming[0].date;
  const firstDay = first.toISOString().slice(0, 10);
  return { date: first, amountCents: upcoming.filter((item) => item.date.toISOString().slice(0, 10) === firstDay)
    .reduce((sum, item) => sum + item.entry.amountCents, 0) };
}

export function commissionDisplayStatus(entry: EarningsCommission, payableIds: ReadonlySet<string>, reversedIds: ReadonlySet<string>) {
  if (entry.status === "REVERSED" || entry.status === "DEBT" || reversedIds.has(entry.id)) return "reversed";
  if (entry.status === "PAID") return entry.payout?.paidAt ? "paid" : "action";
  if (entry.payment?.stripeLivemode !== true || entry.payment.status !== "PAID" ||
    (entry.payment.refundRequestedAt && entry.payment.refundStatus !== "support_closed")) return "action";
  if (entry.status === "RESERVED") return "processing";
  return payableIds.has(entry.id) ? "available" : "pending";
}
