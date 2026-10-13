import type { PartnerPayoutMethod, PartnerWithdrawalStatus } from "@prisma/client";
import { getPartnerMinimumPayoutCents } from "@/lib/partner-connect";
import { getPartnerBalanceSummary } from "@/lib/partner-ledger";
import { decryptPayoutDestination, isPaypalPayoutConfigured, isValidItalianIban } from "@/lib/partner-payout-methods";
import { partnerCashoutRequestsEnabled } from "@/lib/partner-payout-mode";
import { cashoutBlockReason, maskWithdrawalDestination } from "@/lib/partner-withdrawal-view";
import { prisma } from "@/lib/prisma";

const unresolved: PartnerWithdrawalStatus[] = ["REQUESTED", "PROCESSING", "ACTION_REQUIRED", "FAILED"];

export function withdrawalProcessingEnabled() {
  return partnerCashoutRequestsEnabled() && process.env.PARTNER_CASHOUT_PROCESSING_ENABLED === "true";
}

function safeMask(method: PartnerPayoutMethod, encrypted: string) {
  try { return maskWithdrawalDestination(method, decryptPayoutDestination(encrypted)); }
  catch { return "••••"; }
}

/** Read-only, Partner-scoped view. Amounts come from the ledger summary. */
export async function getPartnerWithdrawalDashboard(userId: string) {
  const [balances, profile, requests, contingentDebt, recent] = await Promise.all([
    getPartnerBalanceSummary(userId),
    prisma.localPartnerProfile.findUnique({ where: { userId }, select: {
      preferredPayoutMethod: true, payoutSetupStatus: true, stripeConnectedAccountId: true,
      stripeAccountStatus: true, stripePayoutsEnabled: true, stripePayoutAccountLast4: true,
      paypalPayoutEmail: true, bankPayoutIbanEncrypted: true, bankPayoutAccountLast4: true,
    } }),
    prisma.partnerWithdrawalRequest.findMany({ where: { partnerUserId: userId }, orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, idempotencyKey: true, amountCents: true, payoutMethod: true, destinationSnapshotEncrypted: true,
        status: true, createdAt: true, settlementVerifiedAt: true, failureReason: true,
        manualBankReturn: { select: { amountCents: true } } } }),
    prisma.partnerCommission.count({ where: { partnerUserId: userId, amountCents: { lt: 0 }, OR: [
      { status: "DEBT" }, { type: "REVERSAL", status: "REVERSED", payoutId: { not: null } },
    ] } }),
    prisma.partnerCommission.findMany({ where: { partnerUserId: userId, type: "COMMISSION", amountCents: { gt: 0 },
      status: { not: "REVERSED" }, payment: { is: { status: "PAID", paidAt: { not: null } } } },
      orderBy: { createdAt: "desc" }, take: 5, select: { id: true, amountCents: true, createdAt: true,
        business: { select: { name: true } }, businessSubmission: { select: { businessName: true } } } }),
  ]);
  const method = profile?.preferredPayoutMethod ?? "STRIPE";
  let validBankIban = false;
  if (profile?.bankPayoutIbanEncrypted) {
    try { validBankIban = isValidItalianIban(decryptPayoutDestination(profile.bankPayoutIbanEncrypted)); }
    catch { validBankIban = false; }
  }
  const setupReady = Boolean(profile && (method === "STRIPE"
    ? profile.stripeConnectedAccountId?.startsWith("acct_") && profile.stripeAccountStatus === "READY" && profile.stripePayoutsEnabled
    : method === "PAYPAL"
      ? profile.payoutSetupStatus === "READY" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.paypalPayoutEmail?.trim() ?? "") && isPaypalPayoutConfigured()
      : profile.payoutSetupStatus === "READY" && validBankIban && profile.bankPayoutAccountLast4));
  const destinationMasked = method === "PAYPAL" && profile?.paypalPayoutEmail
    ? maskWithdrawalDestination(method, profile.paypalPayoutEmail)
    : method === "STRIPE"
      ? `•••• ${profile?.stripePayoutAccountLast4 ?? profile?.stripeConnectedAccountId?.slice(-4) ?? ""}`
      : `•••• ${profile?.bankPayoutAccountLast4 ?? ""}`;
  const minimumCents = getPartnerMinimumPayoutCents();
  const blockReason = cashoutBlockReason({ enabled: partnerCashoutRequestsEnabled(), available: balances.available,
    minimum: minimumCents, setupReady, unresolved: requests.some((row) => unresolved.includes(row.status)),
    debt: contingentDebt > 0, held: balances.held });
  return {
    availableCents: balances.available, pendingCents: balances.pending, processingCents: balances.processing,
    paidCents: balances.paid, grossPaidCents: balances.grossPaid, returnedCents: balances.returned,
    heldCents: balances.held, debtCents: balances.debt, minimumCents,
    method, destinationMasked, blockReason, canRequest: blockReason === null,
    history: requests.map((row) => ({ id: row.id, idempotencyKey: row.idempotencyKey, amountCents: row.amountCents,
      method: row.payoutMethod, destinationMasked: safeMask(row.payoutMethod, row.destinationSnapshotEncrypted),
      status: row.status, requestedAt: row.createdAt.toISOString(), settledAt: row.settlementVerifiedAt?.toISOString() ?? null,
      returnedCents: row.manualBankReturn?.amountCents ?? 0,
      needsSupport: row.status === "FAILED" || row.status === "ACTION_REQUIRED" || Boolean(row.failureReason && row.status === "PAID") })),
    recentEarnings: recent.map((row) => ({ id: row.id, amountCents: row.amountCents,
      businessName: row.business?.name ?? row.businessSubmission?.businessName ?? "Salento Local",
      date: row.createdAt.toISOString() })),
  };
}

export type PartnerWithdrawalDashboard = Awaited<ReturnType<typeof getPartnerWithdrawalDashboard>>;
