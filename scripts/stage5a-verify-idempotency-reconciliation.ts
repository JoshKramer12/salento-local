import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { processPartnerWithdrawal, reconcilePartnerWithdrawal } from "@/lib/partner-withdrawal-processing";
import { stripeWithdrawalProvider } from "@/lib/partner-withdrawal-provider";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXlICGlpyfRSSMc";
const REQUEST_KEY = "stage5a-eur-withdrawal-0001";
const TRANSFER_ID = "tr_1UcmehGlpy5eeaBPjPa9DOOl";
const PAYOUT_ID = "po_1UcmeiGlpyfRSSMcI8W9hkLC";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const withdrawal = await prisma.partnerWithdrawal.findUnique({ where: {
      partnerUserId_requestKey: { partnerUserId: PARTNER_ID, requestKey: REQUEST_KEY },
    }, include: { payout: true } });
    if (!withdrawal || withdrawal.status !== "PAID" ||
        withdrawal.stripeConnectedAccountId !== CONNECTED_ID ||
        withdrawal.requestedAmountCents !== 5000 ||
        !withdrawal.payoutId || !withdrawal.destinationExternalAccountId ||
        withdrawal.payout?.stripeTransferId !== TRANSFER_ID ||
        withdrawal.payout.stripePayoutId !== PAYOUT_ID) {
      throw new Error("stage5a_reconciliation_start_mismatch");
    }
    const attempts = await prisma.partnerWithdrawalAttempt.findMany({
      where: { withdrawalId: withdrawal.id }, orderBy: { operation: "asc" },
    });
    const transferAttempt = attempts.find((item) => item.operation === "TRANSFER");
    const payoutAttempt = attempts.find((item) => item.operation === "PAYOUT");
    if (attempts.length !== 2 || !transferAttempt || !payoutAttempt ||
        transferAttempt.status !== "SUCCEEDED" || payoutAttempt.status !== "SUCCEEDED" ||
        transferAttempt.providerObjectId !== TRANSFER_ID ||
        payoutAttempt.providerObjectId !== PAYOUT_ID) {
      throw new Error("stage5a_reconciliation_attempts_mismatch");
    }
    const beforeTransfers = await stripeWithdrawalProvider.findTransfers(withdrawal.id);
    const beforePayouts = await stripeWithdrawalProvider.findPayouts(
      CONNECTED_ID, new Date(0), withdrawal.id, payoutAttempt.id);
    if (beforeTransfers.length !== 1 || beforePayouts.length !== 1) {
      throw new Error("stage5a_reconciliation_provider_count_mismatch");
    }
    const transferRetry = await stripeWithdrawalProvider.createTransfer({
      withdrawalId: withdrawal.id, payoutId: withdrawal.payoutId,
      amountCents: 5000, currency: "eur", connectedAccountId: CONNECTED_ID,
      idempotencyKey: transferAttempt.idempotencyKey,
    });
    const payoutRetry = await stripeWithdrawalProvider.createPayout({
      withdrawalId: withdrawal.id, payoutId: withdrawal.payoutId,
      attemptId: payoutAttempt.id, amountCents: 5000, currency: "eur",
      connectedAccountId: CONNECTED_ID,
      externalAccountId: withdrawal.destinationExternalAccountId,
      idempotencyKey: payoutAttempt.idempotencyKey,
    });
    if (transferRetry.id !== TRANSFER_ID || payoutRetry.id !== PAYOUT_ID ||
        transferRetry.livemode !== false || payoutRetry.livemode !== false) {
      throw new Error("stage5a_reconciliation_idempotency_mismatch");
    }
    const workerRetryA = await processPartnerWithdrawal(withdrawal.id);
    const workerRetryB = await processPartnerWithdrawal(withdrawal.id);
    const reconciliationA = await reconcilePartnerWithdrawal(withdrawal.id);
    const reconciliationB = await reconcilePartnerWithdrawal(withdrawal.id);
    const [afterTransfers, afterPayouts, after, commission, payment, paidEvents, balance] = await Promise.all([
      stripeWithdrawalProvider.findTransfers(withdrawal.id),
      stripeWithdrawalProvider.findPayouts(CONNECTED_ID, new Date(0), withdrawal.id, payoutAttempt.id),
      prisma.partnerWithdrawal.findUnique({ where: { id: withdrawal.id }, include: { payout: true } }),
      prisma.partnerCommission.findUnique({ where: { id: "commission-stage5a-eur" } }),
      prisma.payment.findUnique({ where: { id: "payment-stage5a-eur" } }),
      prisma.partnerWithdrawalEvent.count({ where: { withdrawalId: withdrawal.id, toStatus: "PAID" } }),
      getStripe().balance.retrieve(),
    ]);
    const availableEurCents = balance.available.filter((item) => item.currency === "eur")
      .reduce((sum, item) => sum + item.amount, 0);
    if (workerRetryA !== "terminal" || workerRetryB !== "terminal" ||
        reconciliationA !== "paid" || reconciliationB !== "paid" ||
        afterTransfers.length !== 1 || afterPayouts.length !== 1 ||
        after?.status !== "PAID" || after.payout?.status !== "PAID" ||
        after.payout.stripeTransferId !== TRANSFER_ID ||
        after.payout.stripePayoutId !== PAYOUT_ID ||
        commission?.status !== "PAID" || commission.amountCents !== 5000 ||
        commission.stripeTransferId !== TRANSFER_ID ||
        commission.stripePayoutId !== PAYOUT_ID ||
        payment?.stripeLivemode !== false || payment.status !== "PAID" ||
        paidEvents !== 1 || balance.livemode !== false || availableEurCents !== 4685) {
      throw new Error("stage5a_reconciliation_result_mismatch");
    }
    console.log(JSON.stringify({ withdrawalId: withdrawal.id, status: after.status,
      transferId: TRANSFER_ID, payoutId: PAYOUT_ID, transferCount: afterTransfers.length,
      connectedPayoutCount: afterPayouts.length, transferRetrySameId: true,
      payoutRetrySameId: true, workerRetries: [workerRetryA, workerRetryB],
      reconciliations: [reconciliationA, reconciliationB], paidEvents,
      commissionStatus: commission.status, platformEurAvailableCents: availableEurCents }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_reconciliation_verification_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
