import assert from "node:assert/strict";
import test from "node:test";
import { commissionDisplayStatus, nextPendingEligibility, type EarningsCommission } from "@/lib/partner-earnings-presentation";

const now = new Date("2026-11-20T12:00:00.000Z");
function commission(id: string, changes: Partial<EarningsCommission> = {}): EarningsCommission {
  return {
    id, amountCents: 5000, eligibleAt: new Date("2026-12-04T12:00:00.000Z"), status: "PENDING",
    payment: { paidAt: new Date("2026-11-20T12:00:00.000Z"), purpose: "INITIAL_MEMBERSHIP", status: "PAID",
      refundRequestedAt: null, refundStatus: null, stripeLivemode: true }, ...changes,
  };
}

test("upcoming amount groups the earliest genuine live commissions only", () => {
  const items = [commission("first"), commission("second", { eligibleAt: new Date("2026-12-04T14:00:00.000Z") }), commission("later", { eligibleAt: new Date("2026-12-05T12:00:00.000Z") }),
    commission("test", { payment: { ...commission("x").payment!, stripeLivemode: false } }),
    commission("refund", { payment: { ...commission("x").payment!, refundRequestedAt: now, refundStatus: "requested" } }),
    commission("reversed", { status: "REVERSED" }),
    commission("unresolved", { payment: { ...commission("x").payment!, status: "PENDING" } }),
    commission("early-data", { eligibleAt: new Date("2026-11-25T12:00:00.000Z") }),
  ];
  assert.deepEqual(nextPendingEligibility(items, now, 14), { date: new Date("2026-12-04T12:00:00.000Z"), amountCents: 10000 });
  assert.equal(nextPendingEligibility(items, new Date("2026-12-06T12:00:00.000Z"), 14), null);
});

test("commission labels use payable query and confirmed ledger status", () => {
  const empty = new Set<string>();
  assert.equal(commissionDisplayStatus(commission("one"), empty, empty), "pending");
  assert.equal(commissionDisplayStatus(commission("one"), new Set(["one"]), empty), "available");
  assert.equal(commissionDisplayStatus(commission("one", { status: "PAID", payout: { paidAt: now } }), empty, empty), "paid");
  assert.equal(commissionDisplayStatus(commission("one", { status: "PAID", payout: { paidAt: null } }), empty, empty), "action");
  assert.equal(commissionDisplayStatus(commission("one"), empty, new Set(["one"])), "reversed");
  assert.equal(commissionDisplayStatus(commission("one", { payment: null }), empty, empty), "action");
});
