import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { configuredStripeMode, getStripe } from "@/lib/stripe";
import type { CashoutIncident } from "@/lib/partner-withdrawal-monitoring";

type LocalWithdrawal = {
  id: string;
  status: string;
  requestedAmountCents: number;
  currency: string;
  stripeConnectedAccountId: string;
  destinationExternalAccountId: string | null;
  payout: { id: string; stripeTransferId: string | null; stripePayoutId: string | null } | null;
  attempts: { operation: string; providerObjectId: string | null }[];
  commissions: { amountCents: number; releasedAt: Date | null; commission: { status: string } }[];
};
type ProviderTransfer = {
  id: string; amount: number; amount_reversed: number; currency: string; destination: string;
  livemode: boolean; withdrawalId: string; payoutId: string;
};
type ProviderPayout = {
  id: string; amount: number; currency: string; connectedAccountId: string;
  destinationExternalAccountId: string; failureBalanceTransactionId: string | null;
  livemode: boolean; withdrawalId: string; payoutId: string; status: string;
};

function incident(key: string, code: string): CashoutIncident {
  return { key: `cashout:provider:${key}:${code}`, code, severity: "critical" };
}

/** Compare independently enumerated provider inventory with local durable intents.
 * No local or provider write is possible from this function. */
export function compareCashoutInventory(input: {
  withdrawals: LocalWithdrawal[];
  transfers: ProviderTransfer[];
  payouts: ProviderPayout[];
  livemode: boolean;
  providerAccountIds?: string[];
}) {
  const results: CashoutIncident[] = [];
  const localById = new Map(input.withdrawals.map((item) => [item.id, item]));
  const transferById = new Map(input.transfers.map((item) => [item.id, item]));
  const payoutById = new Map(input.payouts.map((item) => [item.id, item]));
  for (const transfer of input.transfers) {
    const local = localById.get(transfer.withdrawalId);
    if (!local || !transfer.withdrawalId || !local.payout ||
        local.payout.stripeTransferId !== transfer.id ||
        local.payout.id !== transfer.payoutId ||
        local.stripeConnectedAccountId !== transfer.destination ||
        local.requestedAmountCents !== transfer.amount || local.currency !== transfer.currency ||
        transfer.livemode !== input.livemode ||
        !local.attempts.some((attempt) => attempt.operation === "TRANSFER" && attempt.providerObjectId === transfer.id)) {
      results.push(incident(transfer.id, "unexpected_transfer"));
    }
    if (transfer.amount_reversed > 0) {
      results.push(incident(transfer.id, "transfer_reversal_review"));
    }
  }
  for (const payout of input.payouts) {
    const local = localById.get(payout.withdrawalId);
    if (!local || !payout.withdrawalId || !local.payout ||
        local.payout.stripePayoutId !== payout.id ||
        local.payout.id !== payout.payoutId ||
        local.stripeConnectedAccountId !== payout.connectedAccountId ||
        local.requestedAmountCents !== payout.amount || local.currency !== payout.currency ||
        payout.livemode !== input.livemode ||
        !local.attempts.some((attempt) => attempt.operation === "PAYOUT" && attempt.providerObjectId === payout.id)) {
      results.push(incident(payout.id, "unexpected_payout"));
    }
    if (payout.status === "failed" || payout.status === "canceled") {
      results.push(incident(payout.id, "payout_failure_review"));
    }
    if (local && (!local.destinationExternalAccountId ||
        local.destinationExternalAccountId !== payout.destinationExternalAccountId)) {
      results.push(incident(payout.id, "payout_destination_mismatch"));
    }
    if (payout.failureBalanceTransactionId) {
      results.push(incident(payout.id, "payout_returned_funds_review"));
    }
    if (local?.status === "PAID" && ["failed", "canceled"].includes(payout.status)) {
      results.push(incident(payout.id, "payout_late_failure_review"));
    }
    if (payout.status === "paid" && local &&
        local.status !== "PAID" && local.status !== "ACTION_REQUIRED") {
      results.push(incident(payout.id, "provider_paid_local_unsettled"));
    }
  }
  for (const local of input.withdrawals) {
    if (input.providerAccountIds && !input.providerAccountIds.includes(local.stripeConnectedAccountId)) {
      results.push(incident(local.id, "connected_account_missing_at_provider"));
    }
    if (local.payout?.stripeTransferId && !transferById.has(local.payout.stripeTransferId)) {
      results.push(incident(local.id, "transfer_missing_at_provider"));
    }
    if (local.payout?.stripePayoutId && !payoutById.has(local.payout.stripePayoutId)) {
      results.push(incident(local.id, "payout_missing_at_provider"));
    }
    const activeTotal = local.commissions.filter((allocation) => !allocation.releasedAt)
      .reduce((sum, allocation) => sum + allocation.amountCents, 0);
    const shouldReserve = local.status !== "CANCELED" && local.status !== "FAILED_CONFIRMED";
    if (activeTotal !== (shouldReserve ? local.requestedAmountCents : 0)) {
      results.push(incident(local.id, "reservation_total_mismatch"));
    }
    if (local.status === "PAID" &&
        (local.commissions.some((allocation) => allocation.commission.status !== "PAID") ||
          !local.payout?.stripeTransferId || !local.payout.stripePayoutId ||
          payoutById.get(local.payout.stripePayoutId)?.status !== "paid")) {
      results.push(incident(local.id, "paid_evidence_mismatch"));
    }
  }
  return results;
}

function transferDestination(value: Stripe.Transfer) {
  return typeof value.destination === "string" ? value.destination : value.destination?.id ?? "";
}

/** Provider-first, read-only inventory scan. A truncation or API failure rejects
 * the entire scan; it is never reported as a clean reconciliation. */
export async function scanCashoutProviderInventory(since: Date) {
  if (Number.isNaN(since.getTime()) || since.getTime() > Date.now() ||
      since.getTime() < Date.UTC(2020, 0, 1)) {
    throw new Error("cashout_inventory_window_invalid");
  }
  const mode = configuredStripeMode();
  if (!mode) throw new Error("cashout_stripe_mode_invalid");
  const stripe = getStripe();
  const sinceUnix = Math.floor(since.getTime() / 1000);
  const withdrawals = await prisma.partnerWithdrawal.findMany({ select: {
      id: true, status: true, createdAt: true, requestedAmountCents: true, currency: true,
      stripeConnectedAccountId: true, destinationExternalAccountId: true,
      payout: { select: { id: true, stripeTransferId: true, stripePayoutId: true } },
      attempts: { select: { operation: true, providerObjectId: true } },
      commissions: { select: { amountCents: true, releasedAt: true, commission: { select: { status: true } } } },
    } });
  if (withdrawals.length > 2000) throw new Error("cashout_inventory_local_limit");
  if (withdrawals.some((item) => item.createdAt < since)) throw new Error("cashout_inventory_window_excludes_local_withdrawal");
  const providerAccounts = new Set<string>();
  const accountIncidents: CashoutIncident[] = [];
  for await (const account of stripe.accounts.list({ limit: 100 })) {
    providerAccounts.add(account.id);
    if (providerAccounts.size > 2000) throw new Error("cashout_inventory_account_limit");
    if (withdrawals.some((item) => item.stripeConnectedAccountId === account.id) &&
        (!account.payouts_enabled || account.capabilities?.transfers !== "active" ||
          Boolean(account.requirements?.disabled_reason) ||
          Boolean(account.requirements?.currently_due?.length))) {
      accountIncidents.push(incident(account.id, "connected_account_verification_failure"));
    }
  }
  const transfers: ProviderTransfer[] = [];
  let scannedTransfers = 0;
  for await (const item of stripe.transfers.list({ created: { gte: sinceUnix }, limit: 100 })) {
    if (++scannedTransfers > 2000) throw new Error("cashout_inventory_transfer_limit");
    const destination = transferDestination(item);
    transfers.push({ id: item.id, amount: item.amount, amount_reversed: item.amount_reversed,
      currency: item.currency, destination, livemode: item.livemode,
      withdrawalId: item.metadata?.partnerWithdrawalId ?? "", payoutId: item.metadata?.partnerPayoutId ?? "" });
  }
  const payouts: ProviderPayout[] = [];
  for (const accountId of providerAccounts) {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error("cashout_inventory_account_invalid");
    for await (const item of stripe.payouts.list({ created: { gte: sinceUnix }, limit: 100 }, { stripeAccount: accountId })) {
      if (payouts.length >= 2000) throw new Error("cashout_inventory_payout_limit");
      payouts.push({ id: item.id, amount: item.amount, currency: item.currency,
        connectedAccountId: accountId, livemode: item.livemode,
        destinationExternalAccountId: typeof item.destination === "string"
          ? item.destination : item.destination?.id ?? "",
        failureBalanceTransactionId: typeof item.failure_balance_transaction === "string"
          ? item.failure_balance_transaction : item.failure_balance_transaction?.id ?? null,
        withdrawalId: item.metadata?.partnerWithdrawalId ?? "", payoutId: item.metadata?.partnerPayoutId ?? "",
        status: item.status });
      if (payouts.length > 2000) throw new Error("cashout_inventory_payout_limit");
    }
  }
  const platformBalance = await stripe.balance.retrieve();
  if (platformBalance.livemode !== (mode === "live")) throw new Error("cashout_inventory_platform_mode_mismatch");
  const balances: { accountId: string; availableEurCents: number; pendingEurCents: number }[] = [];
  for (const accountId of providerAccounts) {
    const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
    if (balance.livemode !== (mode === "live")) throw new Error("cashout_inventory_connected_mode_mismatch");
    balances.push({ accountId, availableEurCents: balance.available.filter((item) => item.currency === "eur").reduce((sum, item) => sum + item.amount, 0),
      pendingEurCents: balance.pending.filter((item) => item.currency === "eur").reduce((sum, item) => sum + item.amount, 0) });
  }
  return {
    asOf: new Date().toISOString(), since: since.toISOString(), mode,
    counts: { withdrawals: withdrawals.length, transfers: transfers.length, payouts: payouts.length, accounts: providerAccounts.size },
    totals: { transferCents: transfers.reduce((sum, item) => sum + item.amount, 0),
      transferReversedCents: transfers.reduce((sum, item) => sum + item.amount_reversed, 0),
      payoutCents: payouts.reduce((sum, item) => sum + item.amount, 0),
      platformAvailableEurCents: platformBalance.available.filter((item) => item.currency === "eur").reduce((sum, item) => sum + item.amount, 0),
      platformPendingEurCents: platformBalance.pending.filter((item) => item.currency === "eur").reduce((sum, item) => sum + item.amount, 0) },
    connectedBalances: balances,
    incidents: [...accountIncidents, ...compareCashoutInventory({ withdrawals, transfers, payouts,
      livemode: mode === "live", providerAccountIds: [...providerAccounts] })],
  };
}
