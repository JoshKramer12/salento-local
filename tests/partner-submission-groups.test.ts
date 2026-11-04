import assert from "node:assert/strict";
import test from "node:test";

import { isAwaitingPartnerPayment } from "../src/lib/partner-submission-groups";

const base = {
  status: "DRAFT",
  paymentMethod: null,
  paymentStatus: "NOT_REQUIRED",
  payLaterInvitation: null,
};

test("active owner invitations enter the payment workspace, independent of draft progress", () => {
  assert.equal(isAwaitingPartnerPayment({ ...base, payLaterInvitation: { revokedAt: null, declinedAt: null, completedAt: null } }), true);
  assert.equal(isAwaitingPartnerPayment({ ...base, payLaterInvitation: { revokedAt: new Date(), declinedAt: null, completedAt: null } }), false);
  assert.equal(isAwaitingPartnerPayment({ ...base, payLaterInvitation: { revokedAt: null, declinedAt: new Date(), completedAt: null } }), false);
  assert.equal(isAwaitingPartnerPayment({ ...base, payLaterInvitation: { revokedAt: null, declinedAt: null, completedAt: new Date() } }), false);
});

test("payment states stay distinct from unfinished and refunded drafts", () => {
  assert.equal(isAwaitingPartnerPayment({ ...base, status: "AWAITING_PAYMENT" }), true);
  assert.equal(isAwaitingPartnerPayment({ ...base, paymentMethod: "BANK_TRANSFER", paymentStatus: "AWAITING_BANK_TRANSFER" }), true);
  assert.equal(isAwaitingPartnerPayment({ ...base, paymentMethod: "ONLINE", paymentStatus: "FAILED" }), true);
  assert.equal(isAwaitingPartnerPayment({ ...base, paymentMethod: "ONLINE", paymentStatus: "REFUNDED" }), false);
  assert.equal(isAwaitingPartnerPayment(base), false);
});
