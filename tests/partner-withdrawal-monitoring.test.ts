import assert from "node:assert/strict";
import test from "node:test";
import { assessWithdrawalHealth } from "@/lib/partner-withdrawal-monitoring";

const now = new Date("2026-11-18T12:00:00Z");
const past = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

function snapshot(status: "REQUESTED" | "PROCESSING" | "OUTCOME_UNKNOWN" | "ACTION_REQUIRED" | "PAID") {
  return {
    id: "withdrawal-1", status, createdAt: past(61), updatedAt: past(11),
    providerStartedAt: status === "REQUESTED" ? null : past(61), lastReconciledAt: null,
    requestedAmountCents: 5000,
    payout: status === "PAID" ? { id: "payout-1", status: "PAID", stripeTransferId: "tr_1", stripePayoutId: "po_1" } : null,
    commissions: [{ amountCents: 5000, releasedAt: null, commission: { status: "RESERVED", payoutId: null } }],
    attempts: [] as { operation: string; status: string; providerObjectId: string | null }[],
  };
}

test("stable incident keys detect delayed requests, processing, and manual holds", () => {
  assert.deepEqual(assessWithdrawalHealth(snapshot("REQUESTED"), now).map((item) => item.code), ["request_stuck"]);
  assert.deepEqual(assessWithdrawalHealth(snapshot("PROCESSING"), now).map((item) => item.code), ["processing_stuck"]);
  const unknown = assessWithdrawalHealth(snapshot("OUTCOME_UNKNOWN"), now);
  assert.equal(unknown[0].key, "cashout:withdrawal-1:outcome_unknown");
  assert.equal(unknown[0].severity, "critical");
  assert.equal(assessWithdrawalHealth(snapshot("ACTION_REQUIRED"), now)[0].code, "action_required");
  const pending = snapshot("PROCESSING");
  pending.attempts.push({ operation: "PAYOUT", status: "SUCCEEDED", providerObjectId: "po_1" });
  assert.ok(!assessWithdrawalHealth(pending, now).some((item) => item.code === "processing_stuck"));
});

test("reservation and paid evidence discrepancies are surfaced", () => {
  const processing = snapshot("PROCESSING");
  processing.commissions[0].amountCents = 4000;
  assert.ok(assessWithdrawalHealth(processing, now).some((item) => item.code === "reservation_discrepancy"));
  const paid = snapshot("PAID");
  paid.payout!.stripePayoutId = "";
  assert.ok(assessWithdrawalHealth(paid, now).some((item) => item.code === "paid_evidence_discrepancy"));
});
