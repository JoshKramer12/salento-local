import assert from "node:assert/strict";
import test from "node:test";
import { getPartnerInitialHoldProgress, type DashboardCommission } from "@/lib/partner-dashboard-display";

type HoldEntry = DashboardCommission & { eligibleAt: Date | null };
const paidAt = new Date("2026-10-01T12:00:00Z");
const eligibleAt = new Date("2026-10-15T12:00:00Z");
function commission(changes: Partial<HoldEntry> = {}): HoldEntry {
  return {
    id: "commission-1", amountCents: 5000, sourceKey: "commission:submission:1", status: "PENDING", type: "COMMISSION", eligibleAt,
    payment: { paidAt, purpose: "INITIAL_MEMBERSHIP", status: "PAID", refundRequestedAt: null, refundStatus: null, stripeLivemode: true },
    ...changes,
  };
}

test("initial live commission shows its own 14-day hold, ending at the exact payment boundary", () => {
  assert.deepEqual(getPartnerInitialHoldProgress(commission(), new Date("2026-10-06T12:00:00Z"), 14),
    { days: 5, percent: 5 / 14 * 100, holdEndsAt: eligibleAt });
  assert.equal(getPartnerInitialHoldProgress(commission(), eligibleAt, 14), null);
});

test("test, unverified, refunded, blocked and renewal commissions never show a payout countdown", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  for (const mode of [false, null]) {
    assert.equal(getPartnerInitialHoldProgress(commission({ payment: { ...commission().payment!, stripeLivemode: mode } }), now, 14), null);
  }
  assert.equal(getPartnerInitialHoldProgress(commission({ payment: { ...commission().payment!, status: "REFUNDED" } }), now, 14), null);
  assert.equal(getPartnerInitialHoldProgress(commission({ payment: { ...commission().payment!, refundRequestedAt: now } }), now, 14), null);
  assert.equal(getPartnerInitialHoldProgress(commission({ status: "REVERSED" }), now, 14), null);
  assert.equal(getPartnerInitialHoldProgress(commission({ payment: { ...commission().payment!, purpose: "ANNUAL_RENEWAL" } }), now, 14), null);
});
