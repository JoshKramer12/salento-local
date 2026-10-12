import { prisma } from "@/lib/prisma";
import { payableCommissionWhere } from "@/lib/partner-ledger";

/** Read-only identifiers for operator review. This never repairs records and
 * deliberately omits names, bank destinations, and other personal details. */
export async function getPartnerFinancialReconciliationReport(partnerUserId: string, now = new Date()) {
  const [commissions, payouts, payable, oldDisputeEvents, trackedDisputes] = await Promise.all([
    prisma.partnerCommission.findMany({
      where: { partnerUserId },
      select: {
        id: true, amountCents: true, type: true, status: true, payoutId: true,
        paymentId: true, businessId: true, businessSubmissionId: true, eligibleAt: true,
        payout: { select: { status: true, partnerUserId: true } },
        payment: { select: { id: true, status: true, purpose: true, businessId: true, businessSubmissionId: true } },
      },
    }),
    prisma.partnerPayout.findMany({
      where: { partnerUserId },
      select: { id: true, amountCents: true, status: true, stripeTransferId: true, stripePayoutId: true, providerBatchId: true },
    }),
    prisma.partnerCommission.findMany({ where: { ...payableCommissionWhere(now), partnerUserId }, select: { id: true } }),
    prisma.stripeWebhookEvent.findMany({
      where: { endpointType: "PLATFORM", eventType: "charge.dispute.created" },
      select: { id: true, stripeObjectId: true },
    }),
    prisma.partnerPaymentDispute.findMany({ select: { stripeDisputeId: true } }),
  ]);
  const payableIds = new Set(payable.map((row) => row.id));
  const trackedIds = new Set(trackedDisputes.map((row) => row.stripeDisputeId));
  const paidCommissionPayoutMismatchIds: string[] = [];
  const invalidPaymentCommissionLinkIds: string[] = [];
  const reservedCommissionMismatchIds: string[] = [];
  const outstandingDebtIds: string[] = [];
  const overlappingCategoryCommissionIds: string[] = [];
  const payoutTotals = new Map<string, number>();
  for (const row of commissions) {
    if (row.status === "DEBT" && row.amountCents < 0) outstandingDebtIds.push(row.id);
    if (row.type !== "COMMISSION" || row.amountCents <= 0) continue;
    if (row.payoutId) payoutTotals.set(row.payoutId, (payoutTotals.get(row.payoutId) ?? 0) + row.amountCents);
    if (row.status === "PAID" && (!row.payoutId || row.payout?.status !== "PAID" || row.payout.partnerUserId !== partnerUserId)) paidCommissionPayoutMismatchIds.push(row.id);
    if (row.status === "RESERVED" && (!row.payoutId || !row.payout || row.payout.status === "PAID")) reservedCommissionMismatchIds.push(row.id);
    if (row.status !== "REVERSED" && (!row.payment || row.paymentId !== row.payment.id ||
        row.payment.businessSubmissionId !== row.businessSubmissionId ||
        row.payment.businessId !== row.businessId || !row.businessId)) invalidPaymentCommissionLinkIds.push(row.id);
    const verifiedPending = row.payment?.status === "PAID" && row.eligibleAt && row.eligibleAt > now;
    if (verifiedPending && payableIds.has(row.id)) overlappingCategoryCommissionIds.push(row.id);
  }
  return {
    partnerUserId,
    paidCommissionPayoutMismatchIds,
    invalidPaymentCommissionLinkIds,
    reservedCommissionMismatchIds,
    outstandingDebtIds,
    overlappingCategoryCommissionIds,
    payoutAmountMismatchIds: payouts.filter((row) =>
      payoutTotals.has(row.id) && payoutTotals.get(row.id) !== row.amountCents).map((row) => row.id),
    unresolvedProviderPayoutIds: payouts.filter((row) =>
      ["SCHEDULED", "PROCESSING", "ACTION_REQUIRED"].includes(row.status) &&
      Boolean(row.stripeTransferId || row.stripePayoutId || row.providerBatchId)).map((row) => row.id),
    // These are platform-wide identifiers because legacy webhook logs do not
    // store a Payment relation. Do not assign them to this Partner by guesswork.
    // A later closed event alone does not establish a safe historical outcome.
    untrackedHistoricalDisputeEventIds: oldDisputeEvents.filter((row) =>
      !row.stripeObjectId || !trackedIds.has(row.stripeObjectId)).map((row) => row.id),
  };
}
