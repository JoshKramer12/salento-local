import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;
type Credit = { partnerUserId: string; amountCents: number; sourceEventType: string | null;
  sourceEventId: string | null; sourceKey: string };

export function bankReturnCreditSourceKey(returnId: string) {
  return `bank-return-credit:${returnId}`;
}

/** A return credit is a recovery of previously paid funds, never earnings.
 * Any refund, dispute, debt, or broken original payout relationship holds it. */
export async function bankReturnCreditSafe(db: Db, credit: Credit, visited = new Set<string>()): Promise<boolean> {
  if (credit.sourceEventType !== "VERIFIED_BANK_RETURN" || !credit.sourceEventId ||
      credit.sourceKey !== bankReturnCreditSourceKey(credit.sourceEventId) || credit.amountCents <= 0 ||
      visited.has(credit.sourceEventId)) return false;
  const path = new Set(visited).add(credit.sourceEventId);
  const [returned, debt] = await Promise.all([
    db.partnerManualBankReturn.findUnique({ where: { id: credit.sourceEventId }, include: {
      withdrawalRequest: { include: { payout: { include: { commissions: {
        where: { type: { in: ["COMMISSION", "ADJUSTMENT"] }, amountCents: { gt: 0 } },
        include: { payment: { include: { partnerDisputes: true } } },
      } } } } },
    } }),
    db.partnerCommission.count({ where: { partnerUserId: credit.partnerUserId, amountCents: { lt: 0 }, OR: [
      { status: "DEBT" }, { type: "REVERSAL", status: "REVERSED", payoutId: { not: null } },
    ] } }),
  ]);
  if (!returned || debt || returned.withdrawalRequest.partnerUserId !== credit.partnerUserId ||
      returned.withdrawalRequest.status !== "PAID" || returned.withdrawalRequest.payout.status !== "PAID" ||
      returned.amountCents !== credit.amountCents || returned.amountCents > returned.withdrawalRequest.amountCents) return false;
  const originals = returned.withdrawalRequest.payout.commissions;
  if (!originals.length || originals.reduce((sum, row) => sum + row.amountCents, 0) !== returned.withdrawalRequest.amountCents) return false;
  for (const row of originals) {
    if (row.partnerUserId !== credit.partnerUserId || row.status !== "PAID") return false;
    if (row.type === "ADJUSTMENT") {
      if (!await bankReturnCreditSafe(db, row, path)) return false;
    } else if (row.type !== "COMMISSION" || row.payment?.status !== "PAID" || !row.payment.paidAt ||
        row.payment.refundRequestedAt && row.payment.refundStatus !== "support_closed" ||
        row.payment.partnerDisputes.some((dispute) => dispute.holdActive)) return false;
  }
  return true;
}
