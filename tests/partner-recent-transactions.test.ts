import assert from "node:assert/strict";
import test from "node:test";
import { projectRecentTransactions, type TransactionCommission, type TransactionStatusEvent,
  type TransactionWithdrawal } from "@/lib/partner-recent-transactions";

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
function commission(id: string, day: number, mode: boolean | null = true): TransactionCommission {
  return { id, amountCents: 5000, currency: "eur", type: "COMMISSION", status: "PENDING",
    sourceKey: `commission:${id}`, business: { name: `Business ${id}` }, businessSubmission: null,
    createdAt: at(day), earnedAt: at(day), reversedAt: null,
    payment: { paidAt: at(day), purpose: "INITIAL_MEMBERSHIP", status: "PAID",
      refundRequestedAt: null, refundStatus: null, stripeLivemode: mode } };
}
function withdrawal(id: string, day: number, status = "REQUESTED"): TransactionWithdrawal {
  return { id, requestedAmountCents: 10000, currency: "eur", status, createdAt: at(day) };
}
function event(id: string, row: TransactionWithdrawal, day: number, status = row.status): TransactionStatusEvent {
  return { id, withdrawalId: row.id, toStatus: status, createdAt: at(day), withdrawal: row };
}
function project(input: Partial<Parameters<typeof projectRecentTransactions>[0]> = {}) {
  return projectRecentTransactions({ commissions: [], reversals: [], withdrawals: [], statusEvents: [],
    payableIds: new Set(), paymentLivemode: true, locale: "en", ...input });
}

test("empty feed and pending, eligible, and multiple verified commissions", () => {
  assert.deepEqual(project(), []);
  const a = commission("a", 7);
  const b = commission("b", 8);
  assert.deepEqual(project({ commissions: [a] }).map((row) => [row.kind, row.status, row.amountCents]),
    [["commission", "Pending", 5000]]);
  assert.equal(project({ commissions: [a], payableIds: new Set([a.id]) })[0].status, "Eligible");
  assert.deepEqual(project({ commissions: [a, b], payableIds: new Set([a.id, b.id]) }).map((row) => row.businessName),
    ["Business b", "Business a"]);
  assert.equal(project({ commissions: [{ ...a, status: "RESERVED" }] })[0].status, "Processing");
});

test("request and processing states debit once; paid completion is a separate non-debit event", () => {
  const processing = withdrawal("w1", 20, "PROCESSING");
  assert.deepEqual(project({ withdrawals: [processing] }).map((row) => [row.kind, row.status, row.balanceEffect]),
    [["request", "Processing", "debit"]]);
  const paid = withdrawal("w1", 20, "PAID");
  const rows = project({ withdrawals: [paid], statusEvents: [event("paid-event", paid, 21)] });
  assert.deepEqual(rows.map((row) => [row.kind, row.status, row.balanceEffect]),
    [["completed", "Paid", "none"], ["request", "Requested", "debit"]]);
  assert.equal(rows[0].withdrawalId, rows[1].withdrawalId);
  assert.equal(rows.filter((row) => row.balanceEffect === "debit").length, 1);
});

test("failed and action-required states use current backend outcome without implying a refund", () => {
  for (const [status, label, tone] of [
    ["ACTION_REQUIRED", "Action required", "yellow"], ["OUTCOME_UNKNOWN", "Under review", "yellow"],
    ["FAILED_CONFIRMED", "Failed", "red"], ["INVALIDATED", "Failed", "red"],
  ]) {
    const row = withdrawal(`w-${status}`, 20, status);
    const rows = project({ withdrawals: [row], statusEvents: [event(status, row, 21)] });
    assert.deepEqual([rows[0].kind, rows[0].status, rows[0].tone, rows[0].balanceEffect],
      ["issue", label, tone, "none"]);
  }
  const paid = withdrawal("resolved", 20, "PAID");
  assert.equal(project({ withdrawals: [paid], statusEvents: [event("old-error", paid, 21, "ACTION_REQUIRED")] })
    .some((row) => row.kind === "issue"), false);
});

test("real reversal ledger row is the only negative commission adjustment", () => {
  const original = commission("source", 7);
  const reversal = { ...commission("reverse", 21), type: "REVERSAL", amountCents: -5000,
    status: "REVERSED", sourceKey: `commission:reversal:${original.id}`, reversedAt: at(21) };
  const rows = project({ commissions: [{ ...original, status: "REVERSED" }], reversals: [reversal, reversal] });
  assert.deepEqual(rows.map((row) => [row.kind, row.amountCents, row.status]), [["reversal", -5000, "Reversed"]]);
  assert.deepEqual(project({ commissions: [original], reversals: [] }).map((row) => row.kind), ["commission"]);
});

test("payment provenance excludes TEST and unverified history from LIVE feed", () => {
  const live = commission("live", 8, true);
  const testMode = commission("test", 9, false);
  const unknown = commission("unknown", 10, null);
  const rows = project({ commissions: [live, testMode, unknown] });
  assert.deepEqual(rows.map((row) => row.id), ["commission:live"]);
  const simulated = project({ commissions: [live, testMode, unknown], paymentLivemode: false });
  assert.deepEqual(simulated.map((row) => row.id), ["commission:test"]);
});

test("mixed events sort by event time with deterministic ties and no replay duplicates", () => {
  const a = commission("a", 20);
  const b = commission("b", 20);
  const paid = withdrawal("w", 21, "PAID");
  const rows = project({ commissions: [b, a, a], withdrawals: [paid, paid],
    statusEvents: [event("first", paid, 23), event("replay", paid, 23)], limit: 5 });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].kind, "completed");
  assert.equal(rows[1].kind, "request");
  assert.deepEqual(rows.slice(2).map((row) => row.id), ["commission:a", "commission:b"]);
  assert.equal(project({ ...{ commissions: [a, b], withdrawals: [paid], statusEvents: [event("paid", paid, 23)] }, limit: 2 }).length, 2);
});

test("Italian uses localized financial statuses without changing event identity", () => {
  const eligible = commission("it", 7);
  const paid = withdrawal("w-it", 20, "PAID");
  const rows = project({ commissions: [eligible], payableIds: new Set([eligible.id]),
    withdrawals: [paid], statusEvents: [event("paid-it", paid, 21)], locale: "it" });
  assert.deepEqual(rows.map((row) => row.status), ["Pagato", "Richiesto", "Disponibile"]);
  assert.deepEqual(rows.map((row) => row.id), ["outcome:w-it:completed", "request:w-it", "commission:it"]);
});
