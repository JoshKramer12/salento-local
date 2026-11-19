import type Stripe from "stripe";
import { configuredStripeMode, getStripe } from "@/lib/stripe";

export type TransferEvidence = {
  id: string; amountCents: number; currency: string; destination: string;
  livemode: boolean; withdrawalId: string; payoutId: string;
  amountReversedCents: number;
};
export type PayoutEvidence = {
  id: string; amountCents: number; currency: string; connectedAccountId: string;
  livemode: boolean; withdrawalId: string; payoutId: string;
  attemptId: string; status: string; destinationExternalAccountId: string | null;
  failureBalanceTransactionId: string | null;
};
export type AccountEvidence = {
  id: string; payoutsEnabled: boolean; detailsSubmitted: boolean; livemode: boolean;
  externalAccountId: string | null; externalAccountLast4: string | null;
  accountType: string | null; country: string | null; transfersCapability: string | null;
  requirementsClear: boolean; manualPayoutSchedule: boolean; payoutStatusEnabled: boolean;
};

export interface WithdrawalProvider {
  account(connectedAccountId: string): Promise<AccountEvidence>;
  createTransfer(input: { withdrawalId: string; payoutId: string; amountCents: number; currency: string; connectedAccountId: string; idempotencyKey: string }): Promise<TransferEvidence>;
  createPayout(input: { withdrawalId: string; payoutId: string; attemptId: string; amountCents: number; currency: string; connectedAccountId: string; externalAccountId: string; idempotencyKey: string }): Promise<PayoutEvidence>;
  findTransfers(withdrawalId: string): Promise<TransferEvidence[]>;
  findPayouts(connectedAccountId: string, since: Date, withdrawalId: string, attemptId: string): Promise<PayoutEvidence[]>;
  retrieveTransfer(id: string): Promise<TransferEvidence>;
  retrievePayout(connectedAccountId: string, id: string): Promise<PayoutEvidence>;
  reverseTransfer(input: { transferId: string; amountCents: number; idempotencyKey: string }): Promise<{ reversalId: string; transfer: TransferEvidence }>;
}

function transferEvidence(value: Stripe.Transfer): TransferEvidence {
  return {
    id: value.id, amountCents: value.amount, currency: value.currency,
    destination: typeof value.destination === "string" ? value.destination : value.destination?.id ?? "",
    livemode: value.livemode, withdrawalId: value.metadata?.partnerWithdrawalId ?? "",
    payoutId: value.metadata?.partnerPayoutId ?? "", amountReversedCents: value.amount_reversed,
  };
}

export function payoutEvidence(value: Stripe.Payout, connectedAccountId: string): PayoutEvidence {
  return {
    id: value.id, amountCents: value.amount, currency: value.currency,
    connectedAccountId, livemode: value.livemode,
    withdrawalId: value.metadata?.partnerWithdrawalId ?? "",
    payoutId: value.metadata?.partnerPayoutId ?? "",
    attemptId: value.metadata?.partnerWithdrawalAttemptId ?? "", status: value.status,
    destinationExternalAccountId: typeof value.destination === "string"
      ? value.destination : value.destination?.id ?? null,
    failureBalanceTransactionId: typeof value.failure_balance_transaction === "string"
      ? value.failure_balance_transaction : value.failure_balance_transaction?.id ?? null,
  };
}

export const stripeWithdrawalProvider: WithdrawalProvider = {
  async account(connectedAccountId) {
    const stripe = getStripe();
    const [account, balanceSettings] = await Promise.all([
      stripe.accounts.retrieve(connectedAccountId, { expand: ["external_accounts"] }),
      stripe.balanceSettings.retrieve({}, { stripeAccount: connectedAccountId }),
    ]);
    const externalAccounts = account.external_accounts;
    const defaultEuroBanks = externalAccounts?.data.filter((item) =>
      item.object === "bank_account" && item.currency === "eur" && item.default_for_currency) ?? [];
    // A partial or ambiguous account list cannot establish the exact payout destination.
    const external = !externalAccounts?.has_more && defaultEuroBanks.length === 1
      ? defaultEuroBanks[0] : null;
    return {
      id: account.id, payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted, livemode: configuredStripeMode() === "live",
      externalAccountId: external?.id ?? null,
      externalAccountLast4: external?.last4 ?? null,
      // Accounts v2 can expose `type: none` through the v1 compatibility API.
      accountType: account.controller?.stripe_dashboard?.type ?? account.type ?? null,
      country: account.country ?? null,
      transfersCapability: account.capabilities?.transfers ?? null,
      requirementsClear: Boolean(account.requirements) && !account.requirements?.disabled_reason &&
        !account.requirements?.currently_due?.length &&
        !account.requirements?.past_due?.length &&
        !account.requirements?.pending_verification?.length,
      manualPayoutSchedule: balanceSettings.payments.payouts?.schedule?.interval === "manual",
      payoutStatusEnabled: balanceSettings.payments.payouts?.status === "enabled",
    };
  },
  async createTransfer(input) {
    const result = await getStripe().transfers.create({
      amount: input.amountCents, currency: input.currency, destination: input.connectedAccountId,
      transfer_group: input.withdrawalId,
      metadata: { partnerWithdrawalId: input.withdrawalId, partnerPayoutId: input.payoutId },
    }, { idempotencyKey: input.idempotencyKey });
    return transferEvidence(result);
  },
  async createPayout(input) {
    const result = await getStripe().payouts.create({
      amount: input.amountCents, currency: input.currency, destination: input.externalAccountId,
      metadata: { partnerWithdrawalId: input.withdrawalId, partnerPayoutId: input.payoutId,
        partnerWithdrawalAttemptId: input.attemptId },
    }, { idempotencyKey: input.idempotencyKey, stripeAccount: input.connectedAccountId });
    return payoutEvidence(result, input.connectedAccountId);
  },
  async findTransfers(withdrawalId) {
    const result = await getStripe().transfers.list({ transfer_group: withdrawalId, limit: 100 });
    return result.data.map(transferEvidence);
  },
  async findPayouts(connectedAccountId, since, withdrawalId, attemptId) {
    const result: PayoutEvidence[] = [];
    const lowerBound = Math.floor((since.getTime() - 5 * 60 * 1000) / 1000);
    const payouts = getStripe().payouts.list({ created: { gte: lowerBound }, limit: 100 }, { stripeAccount: connectedAccountId });
    let scanned = 0;
    for await (const payout of payouts) {
      if (payout.metadata?.partnerWithdrawalId === withdrawalId &&
          payout.metadata?.partnerWithdrawalAttemptId === attemptId) {
        result.push(payoutEvidence(payout, connectedAccountId));
      }
      if (++scanned >= 1000) break;
    }
    return result;
  },
  async retrieveTransfer(id) {
    return transferEvidence(await getStripe().transfers.retrieve(id));
  },
  async retrievePayout(connectedAccountId, id) {
    return payoutEvidence(await getStripe().payouts.retrieve(id, {}, { stripeAccount: connectedAccountId }), connectedAccountId);
  },
  async reverseTransfer(input) {
    const reversal = await getStripe().transfers.createReversal(input.transferId, {
      amount: input.amountCents,
      description: "Confirmed withdrawal bank payout did not occur",
    }, { idempotencyKey: input.idempotencyKey });
    const transfer = await getStripe().transfers.retrieve(input.transferId);
    return { reversalId: reversal.id, transfer: transferEvidence(transfer) };
  },
};
