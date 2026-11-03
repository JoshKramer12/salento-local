import assert from "node:assert/strict";
import test from "node:test";

import {
  ensurePaymentBusinessAssociation,
  markStripePaymentRefunded,
} from "@/lib/stripe-payment-sync";
import { reversePartnerCommissionForPayment } from "@/lib/partner-ledger";

function createPaymentStore(initialBusinessId: string | null) {
  let businessId = initialBusinessId;
  let updateCount = 0;

  return {
    db: {
      payment: {
        async findUnique() {
          return { businessId };
        },
        async updateMany(args: {
          data: { businessId: string };
          where: { businessId: null; id: string };
        }) {
          if (args.where.id !== "payment_123" || businessId !== null) {
            return { count: 0 };
          }

          businessId = args.data.businessId;
          updateCount += 1;
          return { count: 1 };
        },
      },
    },
    getBusinessId: () => businessId,
    getUpdateCount: () => updateCount,
  };
}

test("initial successful payment is linked once, so polling-first and webhook-first retries keep the exact Business", async () => {
  const store = createPaymentStore(null);

  await ensurePaymentBusinessAssociation({
    businessId: "business_123",
    db: store.db as never,
    paymentId: "payment_123",
  });
  await ensurePaymentBusinessAssociation({
    businessId: "business_123",
    db: store.db as never,
    paymentId: "payment_123",
  });

  assert.equal(store.getBusinessId(), "business_123");
  assert.equal(store.getUpdateCount(), 1);
});

test("an already-linked payment is never silently reassigned to another Business", async () => {
  const store = createPaymentStore("business_123");

  await assert.rejects(
    ensurePaymentBusinessAssociation({
      businessId: "business_conflict",
      db: store.db as never,
      paymentId: "payment_123",
    }),
    /payment_business_association_conflict/,
  );

  assert.equal(store.getBusinessId(), "business_123");
  assert.equal(store.getUpdateCount(), 0);
});

function createRefundStore(businessId: string | null) {
  const membershipRevocations: string[] = [];
  let paymentStatus = "PAID";
  let submissionStatus = "PAID";

  const tx = {
    payment: {
      async findFirst() {
        return {
          businessId,
          businessSubmissionId: "submission_123",
          id: "payment_123",
          purpose: "INITIAL_MEMBERSHIP",
        };
      },
      async update() {
        paymentStatus = "REFUNDED";
      },
    },
    businessSubmission: {
      async update() {
        submissionStatus = "REFUNDED";
      },
    },
    businessMembership: {
      async updateMany(args: { where: { businessId: string } }) {
        membershipRevocations.push(args.where.businessId);
        return { count: 1 };
      },
    },
  };

  return {
    db: {
      async $transaction<T>(callback: (client: typeof tx) => Promise<T>) {
        return callback(tx);
      },
    },
    membershipRevocations,
    paymentStatus: () => paymentStatus,
    submissionStatus: () => submissionStatus,
  };
}

test("a full initial-payment refund revokes only the exact linked Business entitlement and keeps business data intact", async () => {
  const store = createRefundStore("business_123");

  await markStripePaymentRefunded({
    revalidatePaths: false,
    revokeMembershipEntitlement: true,
    stripePaymentIntentId: "pi_test_paid",
  }, { db: store.db as never });

  assert.equal(store.paymentStatus(), "REFUNDED");
  assert.equal(store.submissionStatus(), "REFUNDED");
  assert.deepEqual(store.membershipRevocations, ["business_123"]);
});

test("the regression demonstrates why a null initial-payment Business link skips entitlement revocation", async () => {
  const store = createRefundStore(null);

  await markStripePaymentRefunded({
    revalidatePaths: false,
    revokeMembershipEntitlement: true,
    stripePaymentIntentId: "pi_test_paid",
  }, { db: store.db as never });

  assert.deepEqual(store.membershipRevocations, []);
});

test("full refund and lost-dispute commission reversals keep the original €50 commission and are idempotent", async () => {
  const createdReversals: Array<Record<string, unknown>> = [];
  let originalStatus = "PENDING";
  const original = {
    amountCents: 5000,
    businessId: "business_123",
    businessSubmissionId: "submission_123",
    currency: "eur",
    id: "commission_123",
    partnerUserId: "partner_123",
    paymentId: "payment_123",
    sourceKey: "commission:initial:payment_123",
    status: originalStatus,
    stripeChargeId: "ch_123",
    stripeCheckoutSessionId: "cs_123",
    stripePaymentIntentId: "pi_123",
    type: "COMMISSION",
  };
  const db = {
    async $transaction<T>(callback: (tx: unknown) => Promise<T>) {
      return callback({
        partnerCommission: {
          async findFirst() {
            return { ...original, status: originalStatus };
          },
          async findUnique(args: { where: { id?: string; sourceKey?: string } }) {
            if (args.where.id === original.id) return { ...original, status: originalStatus };
            return createdReversals.length ? { id: "reversal_123" } : null;
          },
          async update() {
            originalStatus = "REVERSED";
          },
          async create(args: { data: Record<string, unknown> }) {
            createdReversals.push(args.data);
          },
        },
        localPartnerProfile: { async updateMany() { return { count: 1 }; } },
        partnerDebtRecovery: { async count() { return 0; }, async updateMany() { return { count: 0 }; } },
        partnerWithdrawal: { async findUnique() { return null; } },
      });
    },
  };

  for (const [eventType, reason] of [
    ["charge.refunded", "payment_refunded"],
    ["charge.dispute.closed", "payment_dispute_lost"],
  ] as const) {
    await reversePartnerCommissionForPayment({
      eventType,
      reason,
      sourceEventId: `evt_${reason}`,
      stripeChargeId: "ch_123",
      stripePaymentIntentId: "pi_123",
    }, {
      db: db as never,
      revalidatePaths: () => {},
    });
  }

  assert.equal(originalStatus, "REVERSED");
  assert.equal(createdReversals.length, 1);
  assert.equal(createdReversals[0].amountCents, -5000);
  assert.equal(createdReversals[0].businessId, "business_123");
  assert.equal(createdReversals[0].paymentId, "payment_123");
  assert.equal(createdReversals[0].sourceKey, "commission:reversal:commission_123");
});
