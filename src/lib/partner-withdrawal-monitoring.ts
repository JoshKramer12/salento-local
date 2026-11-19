import type { PartnerWithdrawalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CashoutIncident = {
  key: string;
  severity: "warning" | "critical";
  code: string;
  withdrawalId?: string;
};

type WithdrawalSnapshot = {
  id: string;
  status: PartnerWithdrawalStatus;
  createdAt: Date;
  updatedAt: Date;
  providerStartedAt: Date | null;
  lastReconciledAt: Date | null;
  requestedAmountCents: number;
  payout: { id: string; status: string; stripeTransferId: string | null; stripePayoutId: string | null } | null;
  commissions: { amountCents: number; releasedAt: Date | null; commission: { status: string; payoutId: string | null } }[];
  attempts: { operation: string; status: string; providerObjectId: string | null }[];
};

const minute = 60_000;

function threshold(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 1 && value <= 30 * 24 * 60 ? value * minute : fallback * minute;
}

function incident(id: string, code: string, severity: CashoutIncident["severity"]): CashoutIncident {
  // The key is stable across scans so an external alert sink can deduplicate it.
  return { key: `cashout:${id}:${code}`, severity, code, withdrawalId: id };
}

export function assessWithdrawalHealth(item: WithdrawalSnapshot, now = new Date()): CashoutIncident[] {
  const results: CashoutIncident[] = [];
  const age = now.getTime() - item.createdAt.getTime();
  const statusAge = now.getTime() - item.updatedAt.getTime();
  const providerAge = now.getTime() - (item.providerStartedAt ?? item.createdAt).getTime();
  const payoutAttemptStarted = item.attempts.some((attempt) => attempt.operation === "PAYOUT");
  if (["REQUESTED", "READY_FOR_PROCESSING"].includes(item.status) &&
      age >= threshold("PARTNER_CASHOUT_REQUEST_STALE_MINUTES", 60)) {
    results.push(incident(item.id, "request_stuck", "warning"));
  }
  if (item.status === "PROCESSING" && !payoutAttemptStarted &&
      statusAge >= threshold("PARTNER_CASHOUT_PROCESSING_STALE_MINUTES", 10)) {
    results.push(incident(item.id, "processing_stuck", "critical"));
  }
  if (item.status === "OUTCOME_UNKNOWN") results.push(incident(item.id, "outcome_unknown", "critical"));
  if (item.status === "ACTION_REQUIRED") results.push(incident(item.id, "action_required", "critical"));
  if (item.providerStartedAt && item.status === "PROCESSING" &&
      providerAge >= threshold("PARTNER_CASHOUT_PAYOUT_PENDING_MINUTES", 3 * 24 * 60) &&
      payoutAttemptStarted) {
    results.push(incident(item.id, "payout_pending_too_long", "critical"));
  }
  if (item.providerStartedAt && ["PROCESSING", "OUTCOME_UNKNOWN", "ACTION_REQUIRED"].includes(item.status) &&
      now.getTime() - (item.lastReconciledAt ?? item.providerStartedAt).getTime() >=
        threshold("PARTNER_CASHOUT_RECONCILIATION_STALE_MINUTES", 6 * 60)) {
    results.push(incident(item.id, "reconciliation_stale", "warning"));
  }
  const active = item.commissions.filter((entry) => !entry.releasedAt);
  if (["REQUESTED", "READY_FOR_PROCESSING", "PROCESSING", "OUTCOME_UNKNOWN", "ACTION_REQUIRED"].includes(item.status) &&
      (active.length === 0 || active.reduce((sum, entry) => sum + entry.amountCents, 0) !== item.requestedAmountCents ||
        active.some((entry) => !["RESERVED", "REVERSED", "PAID"].includes(entry.commission.status) ||
          (entry.commission.status === "RESERVED" &&
            entry.commission.payoutId !== (item.payout?.id ?? null))))) {
    results.push(incident(item.id, "reservation_discrepancy", "critical"));
  }
  if (item.status === "PAID" && (item.payout?.status !== "PAID" || !item.payout.stripeTransferId ||
      !item.payout.stripePayoutId)) {
    results.push(incident(item.id, "paid_evidence_discrepancy", "critical"));
  }
  return results;
}

type LegacyPayoutSnapshot = {
  id: string; status: string; attemptCount: number;
  stripeTransferId: string | null; stripePayoutId: string | null;
  providerBatchId: string | null;
};

export function assessLegacyPayoutHealth(item: LegacyPayoutSnapshot): CashoutIncident[] {
  const providerEvidence = item.attemptCount > 0 || Boolean(item.stripeTransferId ||
    item.stripePayoutId || item.providerBatchId);
  if (item.status === "ACTION_REQUIRED" && !providerEvidence) return [];
  if (!["FAILED", "CANCELED", "PROCESSING", "SCHEDULED", "ACTION_REQUIRED"].includes(item.status)) return [];
  const incidents: CashoutIncident[] = [{ key: `cashout:legacy:${item.id}:unresolved`,
    code: "legacy_payout_unresolved", severity: "critical" }];
  if (item.stripePayoutId && item.status === "FAILED") incidents.push({
    key: `cashout:legacy:${item.id}:provider_payout`,
    code: "legacy_provider_payout_requires_reconciliation", severity: "critical",
  });
  return incidents;
}

/** Read-only local evidence scan. It never calls Stripe or sends an alert. */
export async function scanPartnerCashoutHealth(now = new Date()) {
  const withdrawals = await prisma.partnerWithdrawal.findMany({
    where: { status: { in: ["REQUESTED", "READY_FOR_PROCESSING", "PROCESSING", "OUTCOME_UNKNOWN", "ACTION_REQUIRED", "PAID"] } },
    orderBy: { createdAt: "desc" }, take: 501,
    include: {
      payout: { select: { id: true, status: true, stripeTransferId: true, stripePayoutId: true } },
      commissions: { select: { amountCents: true, releasedAt: true, commission: { select: { status: true, payoutId: true } } } },
      attempts: { select: { operation: true, status: true, providerObjectId: true } },
    },
  });
  const webhooks = await prisma.stripeWebhookEvent.findMany({
    where: { endpointType: "CONNECT", status: { in: ["FAILED", "PROCESSING"] } },
    select: { stripeEventId: true, status: true, updatedAt: true }, take: 501,
  });
  const legacyPayouts = await prisma.partnerPayout.findMany({
    where: { withdrawal: null, status: { in: ["FAILED", "CANCELED", "PROCESSING", "SCHEDULED", "ACTION_REQUIRED"] } },
    select: { id: true, status: true, attemptCount: true, stripeTransferId: true,
      stripePayoutId: true, providerBatchId: true }, take: 501,
  });
  const incidents = withdrawals.slice(0, 500).flatMap((item) => assessWithdrawalHealth(item, now));
  incidents.push(...legacyPayouts.slice(0, 500).flatMap(assessLegacyPayoutHealth));
  for (const item of webhooks.slice(0, 500)) {
    if (item.status === "FAILED" || now.getTime() - item.updatedAt.getTime() >= 10 * minute) {
      incidents.push({ key: `cashout:webhook:${item.stripeEventId}`, code: "connect_webhook_failed_or_stuck", severity: "critical" });
    }
  }
  if (withdrawals.length > 500 || webhooks.length > 500 || legacyPayouts.length > 500) {
    incidents.push({ key: "cashout:scan:truncated", code: "health_scan_truncated", severity: "critical" });
  }
  return { scannedWithdrawals: Math.min(withdrawals.length, 500),
    scannedWebhooks: Math.min(webhooks.length, 500), scannedLegacyPayouts: Math.min(legacyPayouts.length, 500), incidents };
}
