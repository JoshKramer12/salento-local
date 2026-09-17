import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveInitialCommissionAttribution } from "@/lib/partner-ledger";

const ledger = readFileSync("src/lib/partner-ledger.ts", "utf8");

const initialPayment = {
  currency: "eur",
  id: "payment_initial",
  paidAt: new Date("2026-01-01T12:00:00.000Z"),
  stripeCheckoutSessionId: "cs_initial",
  stripePaymentIntentId: "pi_initial",
};

test("initial commission keeps its exact initial-payment attribution through reactivation and later renewal syncs", () => {
  // Initial €100 payment creates the €50 commission attribution.
  const firstSync = resolveInitialCommissionAttribution({
    existingPaymentId: null,
    paidInitialPayments: [initialPayment],
  });
  assert.equal(firstSync.kind, "ASSIGN");
  assert.equal(firstSync.kind === "ASSIGN" ? firstSync.payment.id : null, "payment_initial");

  // A €100 reactivation and a later annual renewal belong to the same
  // submission, but neither is an INITIAL_MEMBERSHIP candidate. Re-running
  // either sync must preserve the original €50 commission link.
  const afterReactivation = resolveInitialCommissionAttribution({
    existingPaymentId: "payment_initial",
    paidInitialPayments: [initialPayment],
  });
  const afterSecondRenewal = resolveInitialCommissionAttribution({
    existingPaymentId: "payment_initial",
    paidInitialPayments: [initialPayment],
  });
  assert.deepEqual(afterReactivation, { kind: "PRESERVE" });
  assert.deepEqual(afterSecondRenewal, { kind: "PRESERVE" });
});

test("a conflicting renewal/reactivation payment never replaces an initial commission link", () => {
  assert.deepEqual(
    resolveInitialCommissionAttribution({
      existingPaymentId: "payment_reactivation",
      paidInitialPayments: [initialPayment],
    }),
    { kind: "CONFLICT" },
  );
});

test("initial commission synchronizers select only paid INITIAL_MEMBERSHIP payments", () => {
  assert.match(ledger, /purpose: "INITIAL_MEMBERSHIP"/);
  assert.match(ledger, /resolveInitialCommissionAttribution\(/);
  assert.doesNotMatch(ledger, /const latestPaidPayment = submission\.payments\[0\]/);
});
