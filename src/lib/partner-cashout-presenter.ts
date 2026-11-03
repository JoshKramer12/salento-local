import type { CashoutView } from "@/lib/partner-cashout-view";

export function cashoutBlockReason(view: CashoutView) {
  if (!view.requestEnabled || !view.disbursementsAllowed) return "paused";
  if (view.activeWithdrawalId) return "active";
  if (view.unresolvedLegacyPayoutId) return "review";
  if (view.debtCents > 0) return "debt";
  if (!view.destinationReady) return "destination";
  if (view.availableCents < view.minimumCents) return view.pendingCents > 0 ? "pending" : "minimum";
  return null;
}
