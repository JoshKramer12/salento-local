import assert from "node:assert/strict";
import { test } from "node:test";
import { compareCashoutInventory } from "../src/lib/partner-cashout-independent-reconciliation";
import { emptyControlState, missingRunIncidents, reconcileAlerts } from "../src/lib/partner-cashout-operations";

const local = {
  id: "withdrawal-1", status: "PAID", requestedAmountCents: 5000, currency: "eur",
  stripeConnectedAccountId: "acct_test", payout: {
    id: "payout-ledger-1", stripeTransferId: "tr_test", stripePayoutId: "po_test",
  },
  attempts: [
    { operation: "TRANSFER", providerObjectId: "tr_test" },
    { operation: "PAYOUT", providerObjectId: "po_test" },
  ],
  commissions: [{ amountCents: 5000, releasedAt: null, commission: { status: "PAID" } }],
};
const transfer = { id: "tr_test", amount: 5000, amount_reversed: 0, currency: "eur",
  destination: "acct_test", livemode: false, withdrawalId: "withdrawal-1", payoutId: "payout-ledger-1" };
const payout = { id: "po_test", amount: 5000, currency: "eur", connectedAccountId: "acct_test",
  livemode: false, withdrawalId: "withdrawal-1", payoutId: "payout-ledger-1", status: "paid" };

test("provider inventory matches exact durable transfer, payout and reservation", () => {
  assert.deepEqual(compareCashoutInventory({ withdrawals: [local], transfers: [transfer], payouts: [payout], livemode: false }), []);
});

test("provider-first inventory exposes unexpected objects, reversal and payout failure", () => {
  const incidents = compareCashoutInventory({
    withdrawals: [local], livemode: false,
    transfers: [transfer, { ...transfer, id: "tr_unexpected", amount_reversed: 100 }],
    payouts: [{ ...payout, status: "failed" }, { ...payout, id: "po_unexpected", withdrawalId: "" }],
  });
  assert.deepEqual(new Set(incidents.map((item) => item.code)), new Set([
    "unexpected_transfer", "transfer_reversal_review", "unexpected_payout",
    "payout_failure_review", "paid_evidence_mismatch",
  ]));
});

test("a genuine-looking reversal remains an incident after the local hold is recorded", () => {
  const incidents = compareCashoutInventory({
    withdrawals: [{ ...local, status: "ACTION_REQUIRED" }], livemode: false,
    transfers: [{ ...transfer, amount_reversed: 1 }], payouts: [payout],
  });
  assert.deepEqual(incidents.map((item) => item.code), ["transfer_reversal_review"]);
});

test("a recorded connected account absent from the active provider mode is critical", () => {
  const incidents = compareCashoutInventory({ withdrawals: [local], transfers: [transfer],
    payouts: [payout], livemode: false, providerAccountIds: ["acct_other"] });
  assert.deepEqual(incidents.map((item) => item.code), ["connected_account_missing_at_provider"]);
});

test("provider-paid payout cannot look reconciled while the local withdrawal is processing", () => {
  const incidents = compareCashoutInventory({ withdrawals: [{ ...local, status: "PROCESSING" }],
    transfers: [transfer], payouts: [payout], livemode: false });
  assert.deepEqual(incidents.map((item) => item.code), ["provider_paid_local_unsettled"]);
});

test("terminal cancellation requires released allocations", () => {
  const incidents = compareCashoutInventory({ withdrawals: [{ ...local, status: "CANCELED" }],
    transfers: [transfer], payouts: [payout], livemode: false });
  assert.ok(incidents.some((item) => item.code === "reservation_total_mismatch"));
});

test("missing-run alerts are deduplicated, retried after delivery failure and reopened after resolution", () => {
  const state = emptyControlState();
  const now = new Date("2026-11-19T00:00:00.000Z");
  const incidents = missingRunIncidents(state, now, { worker: true, reconciliation: true, maximumGapMinutes: 10 });
  assert.equal(incidents.length, 2);
  assert.equal(reconcileAlerts(state, incidents, now).length, 2);
  assert.equal(reconcileAlerts(state, incidents, now).length, 2); // still undelivered
  state.alerts[incidents[0].key].deliveredAt = now.toISOString();
  assert.equal(reconcileAlerts(state, incidents, now).length, 1);
  reconcileAlerts(state, [], now);
  assert.ok(state.alerts[incidents[0].key].resolvedAt);
  assert.equal(reconcileAlerts(state, incidents, now).length, 2);
});

test("failed provider scan does not silently resolve existing provider incident", () => {
  const state = emptyControlState();
  const now = new Date("2026-11-19T00:00:00.000Z");
  const incident = { key: "cashout:provider:tr_test:unexpected_transfer", code: "unexpected_transfer", severity: "critical" as const };
  reconcileAlerts(state, [incident], now);
  reconcileAlerts(state, [], now, ["cashout:provider:"]);
  assert.equal(state.alerts[incident.key].resolvedAt, null);
});
