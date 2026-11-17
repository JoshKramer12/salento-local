import type { CashoutView } from "@/lib/partner-cashout-view";

export const cashoutPreviewScenarios = ["zero", "forty", "fifty", "one-seventy-five", "pending", "debt", "missing-account", "active", "processing", "paid", "canceled", "unknown", "action-required"] as const;
export type CashoutPreviewScenario = typeof cashoutPreviewScenarios[number];

export function cashoutPreviewFixture(scenario: CashoutPreviewScenario): CashoutView {
  const base: CashoutView = {
    availableCents: 0, pendingCents: 0, reservedCents: 0, paidCents: 0,
    grossEarnedCents: 0, debtCents: 0, testCents: 5000, unverifiedCents: 1500,
    destinationReady: true, destinationLast4: "4821", bankName: null,
    activeWithdrawalId: null, activeWithdrawalStatus: null, unresolvedLegacyPayoutId: null,
    requestEnabled: true, disbursementsAllowed: true, minimumCents: 5000,
    history: [], hasMore: false, page: 1, legacyHistory: [],
  };
  const dated = "2026-10-21T12:00:00.000Z";
  const history = (status: string, canCancel = false) => [{
    id: `synthetic-${status.toLowerCase()}`, amountCents: 17500, status,
    requestedAt: dated, completedAt: status === "PAID" ? "2026-10-25T12:00:00.000Z" : null,
    destinationLast4: "4821", canCancel,
  }];
  switch (scenario) {
    case "forty": return { ...base, availableCents: 4000, grossEarnedCents: 4000 };
    case "fifty": return { ...base, availableCents: 5000, grossEarnedCents: 5000 };
    case "one-seventy-five": return { ...base, availableCents: 17500, grossEarnedCents: 17500 };
    case "pending": return { ...base, pendingCents: 5000, grossEarnedCents: 5000 };
    case "debt": return { ...base, availableCents: 2000, grossEarnedCents: 10000, paidCents: 5000, debtCents: 3000 };
    case "missing-account": return { ...base, availableCents: 17500, grossEarnedCents: 17500, destinationReady: false, destinationLast4: null };
    case "active": return { ...base, activeWithdrawalId: "synthetic-requested", activeWithdrawalStatus: "REQUESTED", reservedCents: 17500, grossEarnedCents: 17500, history: history("REQUESTED", true) };
    case "processing": return { ...base, activeWithdrawalId: "synthetic-processing", activeWithdrawalStatus: "PROCESSING", reservedCents: 17500, grossEarnedCents: 17500, history: history("PROCESSING") };
    case "paid": return { ...base, paidCents: 17500, grossEarnedCents: 17500, history: history("PAID") };
    case "canceled": return { ...base, availableCents: 17500, grossEarnedCents: 17500, history: history("CANCELED") };
    case "unknown": return { ...base, activeWithdrawalId: "synthetic-unknown", activeWithdrawalStatus: "OUTCOME_UNKNOWN", reservedCents: 17500, grossEarnedCents: 17500, history: history("OUTCOME_UNKNOWN") };
    case "action-required": return { ...base, activeWithdrawalId: "synthetic-action-required", activeWithdrawalStatus: "ACTION_REQUIRED", reservedCents: 17500, grossEarnedCents: 17500, history: history("ACTION_REQUIRED") };
    default: return base;
  }
}
