"use server";

import { revalidatePath } from "next/cache";
import { cashoutRequestsEnabled, cashoutUiEnabled } from "@/lib/partner-cashout-view";
import { cancelPartnerWithdrawal, getPartnerWithdrawableBalance, requestPartnerWithdrawal } from "@/lib/partner-withdrawals";

export async function submitCashoutRequest(requestKey: string, reviewedAmountCents: number) {
  if (!cashoutRequestsEnabled()) return { kind: "unavailable" as const };
  if (!Number.isSafeInteger(reviewedAmountCents) || reviewedAmountCents < 5000 ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) return { kind: "invalid" as const };
  try {
    const withdrawal = await requestPartnerWithdrawal(requestKey, { expectedAmountCents: reviewedAmountCents });
    if (["CANCELED", "INVALIDATED", "FAILED_CONFIRMED"].includes(withdrawal.status)) {
      const balance = await getPartnerWithdrawableBalance();
      return { kind: "changed" as const, availableCents: balance.netEligibleCents, newKey: true };
    }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/earnings");
    return { kind: "submitted" as const, id: withdrawal.id,
      amountCents: withdrawal.requestedAmountCents, status: withdrawal.status,
      destinationLast4: withdrawal.destinationLast4 };
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    if (code === "partner_withdrawal_not_authorized") return { kind: "unauthorized" as const };
    if (["withdrawal_balance_changed", "partner_withdrawal_below_minimum", "partner_withdrawal_already_active",
      "partner_debt_requires_review", "partner_stripe_destination_not_ready", "partner_real_payouts_paused",
      "partner_legacy_payout_requires_review", "commission_reservation_changed"].includes(code)) {
      const balance = await getPartnerWithdrawableBalance();
      return { kind: "changed" as const, availableCents: balance.netEligibleCents, newKey: false };
    }
    return { kind: "error" as const };
  }
}

export async function cancelCashoutRequest(withdrawalId: string) {
  if (!cashoutUiEnabled()) return { kind: "unavailable" as const };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(withdrawalId)) return { kind: "invalid" as const };
  try {
    const withdrawal = await cancelPartnerWithdrawal(withdrawalId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/earnings");
    return { kind: "canceled" as const, id: withdrawal.id };
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    if (code === "partner_withdrawal_not_authorized") return { kind: "unauthorized" as const };
    if (code === "partner_withdrawal_cannot_cancel") return { kind: "processing" as const };
    return { kind: "error" as const };
  }
}
