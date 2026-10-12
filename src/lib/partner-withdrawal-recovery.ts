import type { PartnerWithdrawalDashboard } from "@/lib/partner-withdrawal-dashboard";

export function recoverAcceptedWithdrawal(data: PartnerWithdrawalDashboard, key: string) {
  return data.history.find((row) => row.idempotencyKey === key) ?? null;
}

export function createWithdrawalIdempotencyKey(uuid: string) {
  return `cashout_${uuid.replaceAll("-", "")}`;
}
