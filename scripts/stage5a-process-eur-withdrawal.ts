import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { processPartnerWithdrawal } from "@/lib/partner-withdrawal-processing";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXlICGlpyfRSSMc";
const WITHDRAWAL_ID = "cmw0zq4ap0003otw8kbwoian8";
const SETTLEMENT_TRANSACTION_ID = "txn_3UXlsVGlpy5eeaBP1vaBH5rK";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const stripe = getStripe();
    const [balance, transaction, account, withdrawal] = await Promise.all([
      stripe.balance.retrieve(),
      stripe.balanceTransactions.retrieve(SETTLEMENT_TRANSACTION_ID),
      stripe.accounts.retrieve(CONNECTED_ID),
      prisma.partnerWithdrawal.findUnique({ where: { id: WITHDRAWAL_ID } }),
    ]);
    const availableEurCents = balance.available
      .filter((entry) => entry.currency === "eur")
      .reduce((total, entry) => total + entry.amount, 0);
    if (balance.livemode !== false || transaction.currency !== "eur" ||
        transaction.net < 5000 || transaction.status !== "available" ||
        availableEurCents < 5000) {
      throw new Error("stage5a_eur_funds_not_available");
    }
    if (account.id !== CONNECTED_ID || !account.details_submitted ||
        !account.payouts_enabled || account.capabilities?.transfers !== "active" ||
        account.requirements?.currently_due?.length ||
        !withdrawal || withdrawal.partnerUserId !== PARTNER_ID ||
        withdrawal.stripeConnectedAccountId !== CONNECTED_ID ||
        withdrawal.requestedAmountCents !== 5000 || withdrawal.currency !== "eur" ||
        !["REQUESTED", "PROCESSING", "OUTCOME_UNKNOWN", "ACTION_REQUIRED", "PAID"].includes(withdrawal.status)) {
      throw new Error("stage5a_eur_provider_preflight_mismatch");
    }
    const result = await processPartnerWithdrawal(WITHDRAWAL_ID);
    const [after, attempts] = await Promise.all([
      prisma.partnerWithdrawal.findUnique({ where: { id: WITHDRAWAL_ID }, include: { payout: true } }),
      prisma.partnerWithdrawalAttempt.findMany({ where: { withdrawalId: WITHDRAWAL_ID },
        orderBy: [{ operation: "asc" }, { sequence: "asc" }] }),
    ]);
    if (!after || after.requestedAmountCents !== 5000) {
      throw new Error("stage5a_eur_after_processing_mismatch");
    }
    console.log(JSON.stringify({ withdrawalId: WITHDRAWAL_ID, availableEurCents,
      result, status: after.status, payoutId: after.payoutId,
      stripeTransferId: after.payout?.stripeTransferId,
      stripePayoutId: after.payout?.stripePayoutId,
      attempts: attempts.map((attempt) => ({ operation: attempt.operation,
        status: attempt.status, providerObjectId: attempt.providerObjectId })) }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_eur_processing_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
