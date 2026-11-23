import type { Prisma } from "@prisma/client";
import { getPartnerCommissionDisplay, type DashboardCommission } from "@/lib/partner-dashboard-display";
import type { Locale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";

export type RecentTransaction = {
  id: string;
  kind: "commission" | "reversal" | "request" | "completed" | "issue" | "canceled";
  amountCents: number;
  balanceEffect: "credit" | "debit" | "none";
  status: string;
  tone: "green" | "yellow" | "red" | "neutral";
  occurredAt: string;
  businessName: string | null;
  withdrawalId: string | null;
};

export type TransactionCommission = DashboardCommission & {
  business: { name: string } | null;
  businessSubmission: { businessName: string } | null;
  createdAt: Date;
  earnedAt: Date | null;
  reversedAt: Date | null;
  currency: string;
};

export type TransactionWithdrawal = {
  id: string;
  requestedAmountCents: number;
  status: string;
  createdAt: Date;
  currency: string;
};

export type TransactionStatusEvent = {
  id: string;
  withdrawalId: string;
  toStatus: string;
  createdAt: Date;
  withdrawal: TransactionWithdrawal;
};

type Projection = {
  commissions: TransactionCommission[];
  reversals: TransactionCommission[];
  withdrawals: TransactionWithdrawal[];
  statusEvents: TransactionStatusEvent[];
  payableIds: ReadonlySet<string>;
  paymentLivemode: boolean;
  locale: Locale;
  limit?: number;
};

const statusWords = {
  en: { reversed: "Reversed", hold: "On hold", paid: "Paid", eligible: "Eligible",
    reserved: "Processing", pending: "Pending", requested: "Requested", processing: "Processing",
    action: "Action required", unknown: "Under review", failed: "Failed", canceled: "Canceled" },
  it: { reversed: "Annullata", hold: "In sospeso", paid: "Pagato", eligible: "Disponibile",
    reserved: "In elaborazione", pending: "In attesa", requested: "Richiesto", processing: "In elaborazione",
    action: "Azione richiesta", unknown: "In verifica", failed: "Non riuscito", canceled: "Annullato" },
} as const;

function belongsToPaymentMode(row: TransactionCommission, mode: boolean) {
  return row.currency === "eur" && row.payment?.stripeLivemode === mode &&
    ["PAID", "REFUNDED"].includes(row.payment.status);
}

/** Projects existing ledger and withdrawal state changes; it never writes balances. */
export function projectRecentTransactions(input: Projection): RecentTransaction[] {
  const words = statusWords[input.locale];
  const credits = input.commissions.filter((row) => row.type === "COMMISSION" &&
    row.amountCents > 0 && row.status !== "REVERSED" && belongsToPaymentMode(row, input.paymentLivemode));
  const reversals = input.reversals.filter((row) => row.type === "REVERSAL" &&
    row.amountCents < 0 && ["REVERSED", "DEBT"].includes(row.status) &&
    belongsToPaymentMode(row, input.paymentLivemode));
  const ledger = [...credits, ...reversals];
  const rows: RecentTransaction[] = [];
  const seenCommissions = new Set<string>();
  for (const entry of credits) {
    if (seenCommissions.has(entry.id)) continue;
    seenCommissions.add(entry.id);
    const display = getPartnerCommissionDisplay(entry, ledger, input.payableIds, input.locale, input.paymentLivemode);
    if (display.state === "excluded") continue;
    const status = display.state === "reversed" ? words.reversed :
      display.state === "refund-pending" || display.state === "hold" ? words.hold :
      words[display.state];
    rows.push({ id: `commission:${entry.id}`, kind: "commission", amountCents: entry.amountCents,
      balanceEffect: "credit", status, tone: display.tone,
      occurredAt: (entry.payment?.paidAt ?? entry.earnedAt ?? entry.createdAt).toISOString(),
      businessName: entry.business?.name ?? entry.businessSubmission?.businessName ?? null,
      withdrawalId: null });
  }
  const seenReversals = new Set<string>();
  for (const entry of reversals) {
    if (seenReversals.has(entry.id)) continue;
    seenReversals.add(entry.id);
    rows.push({ id: `reversal:${entry.id}`, kind: "reversal", amountCents: entry.amountCents,
      balanceEffect: "debit", status: words.reversed, tone: "red",
      occurredAt: (entry.reversedAt ?? entry.createdAt).toISOString(),
      businessName: entry.business?.name ?? entry.businessSubmission?.businessName ?? null,
      withdrawalId: null });
  }
  const seenRequests = new Set<string>();
  for (const entry of input.withdrawals) {
    if (seenRequests.has(entry.id) || entry.currency !== "eur" || entry.requestedAmountCents <= 0) continue;
    seenRequests.add(entry.id);
    const processing = ["READY_FOR_PROCESSING", "PROCESSING"].includes(entry.status);
    rows.push({ id: `request:${entry.id}`, kind: "request", amountCents: entry.requestedAmountCents,
      balanceEffect: "debit", status: processing ? words.processing : words.requested,
      tone: "yellow", occurredAt: entry.createdAt.toISOString(), businessName: null,
      withdrawalId: entry.id });
  }
  // State events are durable and can be replayed. Keep one current outcome per
  // withdrawal, while the request and completion retain the same withdrawal ID.
  const seenOutcomes = new Set<string>();
  for (const event of [...input.statusEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))) {
    const withdrawal = event.withdrawal;
    if (event.toStatus !== withdrawal.status || withdrawal.currency !== "eur" ||
        withdrawal.requestedAmountCents <= 0 || seenOutcomes.has(withdrawal.id)) continue;
    const kind = event.toStatus === "PAID" ? "completed" : event.toStatus === "CANCELED" ? "canceled" : "issue";
    const status = event.toStatus === "PAID" ? words.paid : event.toStatus === "ACTION_REQUIRED" ? words.action :
      event.toStatus === "OUTCOME_UNKNOWN" ? words.unknown : event.toStatus === "CANCELED" ? words.canceled : words.failed;
    const tone = event.toStatus === "PAID" ? "green" : event.toStatus === "ACTION_REQUIRED" ||
      event.toStatus === "OUTCOME_UNKNOWN" ? "yellow" : event.toStatus === "CANCELED" ? "neutral" : "red";
    seenOutcomes.add(withdrawal.id);
    rows.push({ id: `outcome:${withdrawal.id}:${kind}`, kind, amountCents: withdrawal.requestedAmountCents,
      balanceEffect: "none", status, tone, occurredAt: event.createdAt.toISOString(),
      businessName: null, withdrawalId: withdrawal.id });
  }
  return rows.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
    .slice(0, input.limit ?? 5);
}

export async function getPartnerRecentTransactions(input: {
  partnerUserId: string;
  commissions: TransactionCommission[];
  payableIds: ReadonlySet<string>;
  paymentLivemode: boolean;
  locale: Locale;
}): Promise<RecentTransaction[]> {
  const mode = input.paymentLivemode;
  const verifiedAllocation: Prisma.PartnerWithdrawalCommissionWhereInput = {
    commission: { is: { payment: { is: { stripeLivemode: mode } } } },
  };
  const withdrawalWhere: Prisma.PartnerWithdrawalWhereInput = {
    partnerUserId: input.partnerUserId, currency: "eur",
    commissions: { some: verifiedAllocation, every: verifiedAllocation },
  };
  const [reversals, withdrawals, statusEvents] = await Promise.all([
    prisma.partnerCommission.findMany({ where: { partnerUserId: input.partnerUserId,
      type: "REVERSAL", amountCents: { lt: 0 }, status: { in: ["REVERSED", "DEBT"] },
      currency: "eur", payment: { is: { stripeLivemode: mode } } },
      orderBy: [{ reversedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 12,
      select: { id: true, amountCents: true, status: true, type: true, sourceKey: true,
        currency: true, createdAt: true, earnedAt: true, reversedAt: true,
        business: { select: { name: true } }, businessSubmission: { select: { businessName: true } },
        payment: { select: { paidAt: true, purpose: true, status: true,
          refundRequestedAt: true, refundStatus: true, stripeLivemode: true } } } }),
    prisma.partnerWithdrawal.findMany({ where: withdrawalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12,
      select: { id: true, requestedAmountCents: true, status: true, createdAt: true, currency: true } }),
    prisma.partnerWithdrawalEvent.findMany({ where: { withdrawal: { is: withdrawalWhere },
      toStatus: { in: ["PAID", "ACTION_REQUIRED", "OUTCOME_UNKNOWN", "FAILED_CONFIRMED", "INVALIDATED", "CANCELED"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 24,
      select: { id: true, withdrawalId: true, toStatus: true, createdAt: true,
        withdrawal: { select: { id: true, requestedAmountCents: true, status: true,
          createdAt: true, currency: true } } } }),
  ]);
  return projectRecentTransactions({ ...input, reversals, withdrawals, statusEvents });
}
