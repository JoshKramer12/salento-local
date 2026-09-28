import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { addUtcDays, isBusinessMembershipPublic } from "@/lib/business-membership";
import { finalizeMembershipRenewalPayment } from "@/lib/membership-renewal";
import { ensurePartnerRefundRepurchaseCommissionForPayment, INITIAL_COMMISSION_HOLD_DAYS, payableCommissionWhere } from "@/lib/partner-ledger";
import { INITIAL_REFUND_DAYS, initialRefundState, requestInitialRefund } from "@/lib/self-service-refunds";
import { LEGAL_DOCUMENTS } from "@/lib/legal";

const paidAt = new Date("2026-09-01T12:00:00.000Z");
const base = { amountCents: 10000, businessId: "business-1", paidAt, purpose: "INITIAL_MEMBERSHIP" as const, refundRequestedAt: null, refundStatus: null, selfServiceRefundedAt: null, status: "PAID", stripePaymentIntentId: "pi-1" };

test("initial refund window includes day 0 and day 13 but excludes exact paidAt + 14 days", () => {
  assert.equal(INITIAL_REFUND_DAYS, 14);
  assert.equal(initialRefundState(base, paidAt), "AVAILABLE");
  assert.equal(initialRefundState(base, addUtcDays(paidAt, 13)), "AVAILABLE");
  assert.equal(initialRefundState(base, new Date(addUtcDays(paidAt, 14).getTime() - 1)), "AVAILABLE");
  assert.equal(initialRefundState(base, addUtcDays(paidAt, 14)), "UNAVAILABLE");
  assert.equal(initialRefundState(base, addUtcDays(paidAt, 15)), "UNAVAILABLE");
});

test("only a paid, linked initial payment can be requested and processing cannot be requested twice", () => {
  const now = addUtcDays(paidAt, 1);
  assert.equal(initialRefundState({ ...base, status: "PENDING_PAYMENT" }, now), "UNAVAILABLE");
  assert.equal(initialRefundState({ ...base, status: "REFUNDED" }, now), "REFUNDED");
  assert.equal(initialRefundState({ ...base, purpose: "ANNUAL_RENEWAL" }, now), "UNAVAILABLE");
  assert.equal(initialRefundState({ ...base, purpose: "REACTIVATION" }, now), "UNAVAILABLE");
  assert.equal(initialRefundState({ ...base, businessId: null }, now), "UNAVAILABLE");
  assert.equal(initialRefundState({ ...base, stripePaymentIntentId: null }, now), "UNAVAILABLE");
  assert.equal(initialRefundState({ ...base, refundRequestedAt: now, refundStatus: "requested" }, now), "PROCESSING");
  assert.equal(initialRefundState({ ...base, refundRequestedAt: now, refundStatus: "failed" }, now), "FAILED");
});

function createRefundRequestHarness(options: { authorized?: boolean; failStripe?: boolean; subscriptionId?: string; historicalCheckout?: boolean; mismatchedCharge?: boolean; mismatchedSession?: boolean } = {}) {
  const calls: { refunds: Array<{ amount: number; payment_intent: string; key: string }>; subscriptionCancels: string[]; membershipUpdates: number; paymentUpdates: number; reconciled: number } = { refunds: [], subscriptionCancels: [], membershipUpdates: 0, paymentUpdates: 0, reconciled: 0 };
  const payment = { ...base, id: "payment-1", businessSubmissionId: "submission-1", currency: "eur", stripeCheckoutSessionId: options.historicalCheckout ? "cs-1" : null, stripeRefundId: null, stripeSubscriptionId: options.historicalCheckout ? null : options.subscriptionId ?? null };
  const membership = { id: "membership-1", stripeSubscriptionId: options.subscriptionId ?? null, originatingPartnerUserId: null };
  const dependencies = {
    sandbox: true,
    authorize: async () => options.authorized !== false,
    findCandidate: async () => ({ deadline: addUtcDays(paidAt, 14), payment, state: "AVAILABLE" as const }),
    db: {
      user: { findUnique: async () => ({ email: "owner@example.test", role: "BUSINESS_OWNER" }) },
      businessMembership: { findUnique: async () => membership, update: async () => { calls.membershipUpdates++; return membership; } },
      partnerCommission: { findFirst: async () => null },
      payment: { updateMany: async () => { calls.paymentUpdates++; return { count: 1 }; } },
    },
    reconcile: async () => { calls.reconciled++; return true; },
    stripe: {
      paymentIntents: { retrieve: async () => ({ id: "pi-1", status: "succeeded", amount_received: 10000, currency: "eur", latest_charge: "ch-1" }) },
      charges: { retrieve: async () => ({ payment_method_details: { type: "card" }, paid: true, amount: options.mismatchedCharge ? 1500 : 10000, amount_refunded: 0 }) },
      checkout: { sessions: { retrieve: async () => ({ id: "cs-1", subscription: options.mismatchedSession ? "sub-other" : options.subscriptionId }) } },
      subscriptions: { retrieve: async () => ({ id: options.subscriptionId, status: "active" }), cancel: async (id: string) => { calls.subscriptionCancels.push(id); return {}; } },
      refunds: {
        create: async (args: { amount: number; payment_intent: string }, requestOptions: { idempotencyKey: string }) => {
          calls.refunds.push({ amount: args.amount, payment_intent: args.payment_intent, key: requestOptions.idempotencyKey });
          if (options.failStripe) throw new Error("stripe_unavailable");
          return { id: "re-1", status: "succeeded" };
        },
      },
    },
  };
  return { calls, dependencies: dependencies as never };
}

test("refund request rejects an unauthorized owner before any Stripe operation", async () => {
  const { calls, dependencies } = createRefundRequestHarness({ authorized: false });
  await assert.rejects(requestInitialRefund({ businessId: "business-1", userId: "another-owner" }, dependencies), /refund_not_authorized/);
  assert.equal(calls.refunds.length, 0);
});

test("manual refund uses the exact server-side amount and payment intent with a stable Stripe key", async () => {
  const { calls, dependencies } = createRefundRequestHarness();
  const result = await requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls.refunds, [{ amount: 10000, payment_intent: "pi-1", key: "salento-initial-refund-payment-1" }]);
  assert.equal(calls.reconciled, 1);
  assert.equal(calls.membershipUpdates, 0);
});

test("a failed Stripe refund leaves the paid membership untouched", async () => {
  const { calls, dependencies } = createRefundRequestHarness({ failStripe: true });
  await assert.rejects(requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies), /stripe_unavailable/);
  assert.equal(calls.membershipUpdates, 0);
  assert.equal(calls.reconciled, 0);
});

test("automatic initial refund cancels the exact subscription before requesting a refund", async () => {
  const { calls, dependencies } = createRefundRequestHarness({ subscriptionId: "sub-1" });
  await requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies);
  assert.deepEqual(calls.subscriptionCancels, ["sub-1"]);
  assert.equal(calls.membershipUpdates, 1);
  assert.equal(calls.refunds.length, 1);
});

test("historical Checkout subscription is resolved by its saved session before cancellation", async () => {
  const { calls, dependencies } = createRefundRequestHarness({ subscriptionId: "sub-1", historicalCheckout: true });
  await requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies);
  assert.deepEqual(calls.subscriptionCancels, ["sub-1"]);
});

test("a mismatched subscription or charge is rejected before Stripe is asked to refund", async () => {
  for (const options of [{ subscriptionId: "sub-1", historicalCheckout: true, mismatchedSession: true }, { subscriptionId: "sub-1", mismatchedCharge: true }]) {
    const { calls, dependencies } = createRefundRequestHarness(options);
    await assert.rejects(requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies), /refund_subscription_mismatch|refund_charge_not_fully_available/);
    assert.equal(calls.refunds.length, 0);
    assert.equal(calls.subscriptionCancels.length, 0);
    assert.equal(calls.membershipUpdates, 0);
  }
});

test("payout reservation requires a paid exact payment, elapsed hold, and no refund request", () => {
  const now = addUtcDays(paidAt, 13);
  assert.equal(INITIAL_COMMISSION_HOLD_DAYS, 14);
  const where = payableCommissionWhere(now);
  assert.deepEqual(where.status, { in: ["PENDING", "AVAILABLE"] });
  assert.deepEqual(where.eligibleAt, { lte: now });
  assert.deepEqual(where.OR?.[0], { payment: { is: { purpose: "INITIAL_MEMBERSHIP", status: "PAID", OR: [{ refundRequestedAt: null }, { refundStatus: "support_closed" }], paidAt: { lte: addUtcDays(now, -14) } } } });
  assert.deepEqual(where.OR?.[1], { payment: { is: { purpose: { in: ["ANNUAL_RENEWAL", "REACTIVATION"] }, status: "PAID" } } });
});

test("a refunded membership is hidden while the business record remains eligible for reactivation", () => {
  assert.equal(isBusinessMembershipPublic({ entitlementRevokedAt: addUtcDays(paidAt, 7), graceEndsAt: addUtcDays(paidAt, 379), now: addUtcDays(paidAt, 8) }), false);
});

function createRenewalStore(refunded: boolean) {
  const updates: unknown[] = [];
  const created: unknown[] = [];
  const membership = {
    id: "membership-1", businessId: "business-1", currentPeriodEnd: addUtcDays(paidAt, 365), graceEndsAt: addUtcDays(paidAt, 379), entitlementRevokedAt: refunded ? addUtcDays(paidAt, 7) : null,
    business: { submissions: [{ id: "submission-1", userId: "owner-1" }] },
  };
  const db = {
    businessMembership: { findFirst: async () => membership, update: async (args: unknown) => { updates.push(args); return args; } },
    businessSubmission: { update: async (args: unknown) => { updates.push(args); return args; } },
    payment: {
      findMany: async () => [{ id: "initial-1", status: refunded ? "REFUNDED" : "PAID", selfServiceRefundedAt: refunded ? addUtcDays(paidAt, 7) : null }],
      findFirst: async () => null,
      create: async (args: { data: unknown }) => { created.push(args.data); return { id: "new-payment" }; },
    },
  };
  return { db, created, updates };
}

test("refund repurchase creates a new initial payment on the same Business and reopens its membership", async () => {
  const store = createRenewalStore(true);
  const result = await finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: "business-1", db: store.db as never, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(paidAt, 60), paymentIntentId: "pi-new", sessionId: "cs-new" });
  assert.equal(result?.purpose, "INITIAL_MEMBERSHIP");
  assert.equal((store.created[0] as { businessId: string; purpose: string }).businessId, "business-1");
  assert.equal((store.created[0] as { purpose: string }).purpose, "INITIAL_MEMBERSHIP");
  assert.match(JSON.stringify(store.updates), /"entitlementRevokedAt":null/);
});

test("normal expiration reactivation remains a €15 purpose and never creates a new initial payment", async () => {
  const store = createRenewalStore(false);
  const result = await finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: "business-1", db: store.db as never, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(paidAt, 400), paymentIntentId: "pi-reactivation", sessionId: "cs-reactivation" });
  assert.equal(result?.purpose, "REACTIVATION");
  assert.equal((store.created[0] as { purpose: string }).purpose, "REACTIVATION");
});

test("a late renewal webhook cannot restore a refunded or refunding payment", async () => {
  for (const status of ["REFUNDED", "PAID"] as const) {
    const store = createRenewalStore(true);
    let updates = 0;
    let created = 0;
    const paymentModel = store.db.payment as Record<string, unknown>;
    paymentModel.findFirst = async (args: { where: { OR?: unknown } }) => args.where.OR ? { id: "old-payment" } : null;
    paymentModel.findUnique = async () => ({ status, purpose: "INITIAL_MEMBERSHIP", refundRequestedAt: status === "PAID" ? addUtcDays(paidAt, 7) : null });
    paymentModel.update = async () => { updates++; return {}; };
    paymentModel.create = async () => { created++; return { id: "unexpected" }; };
    const result = await finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: "business-1", db: store.db as never, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(paidAt, 60), paymentIntentId: "pi-old" });
    assert.equal(result?.duplicate, true);
    assert.equal(updates, 0);
    assert.equal(created, 0);
    assert.equal(store.updates.length, 0);
  }
});

test("a stale Checkout payment waits for an unresolved initial refund before changing the membership", async () => {
  const store = createRenewalStore(false);
  const paymentModel = store.db.payment as Record<string, unknown>;
  paymentModel.findFirst = async (args: { where: { purpose?: string } }) => args.where.purpose ? ({ id: "refunding-initial" }) : null;
  await assert.rejects(finalizeMembershipRenewalPayment({ amountPaidCents: 10000, businessId: "business-1", db: store.db as never, method: "STRIPE_CHECKOUT", paidAt: addUtcDays(paidAt, 7), paymentIntentId: "pi-new" }), /renewal_during_initial_refund_processing/);
  assert.equal(store.created.length, 0);
  assert.equal(store.updates.length, 0);
});

test("refunded repurchase €50 commission is payment-keyed, held 14 days, and idempotent", async () => {
  const created: Array<{ data: Record<string, unknown> }> = [];
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      payment: {
        findUnique: async () => ({ id: "new-payment", businessId: "business-1", businessSubmissionId: "submission-1", currency: "eur", purpose: "INITIAL_MEMBERSHIP", status: "PAID", paidAt: addUtcDays(paidAt, 60), stripeCheckoutSessionId: "cs-new", stripePaymentIntentId: "pi-new", business: { membership: { originatingPartnerUserId: "partner-1" } } }),
        findMany: async () => [{ status: "REFUNDED", selfServiceRefundedAt: addUtcDays(paidAt, 7) }],
      },
      partnerCommission: {
        findFirst: async () => null,
        findUnique: async () => created.length ? { id: "commission-new" } : null,
        create: async (args: { data: Record<string, unknown> }) => { created.push(args); return args; },
      },
    }),
  };
  await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: "new-payment" }, { db: db as never, revalidatePaths: () => {} });
  await ensurePartnerRefundRepurchaseCommissionForPayment({ paymentId: "new-payment" }, { db: db as never, revalidatePaths: () => {} });
  assert.equal(created.length, 1);
  assert.equal(created[0].data.amountCents, 5000);
  assert.equal(created[0].data.sourceKey, "commission:refund-repurchase:new-payment");
  assert.deepEqual(created[0].data.eligibleAt, addUtcDays(paidAt, 74));
});

test("new legal versions apply to future acceptance without changing historical rows", () => {
  assert.equal(LEGAL_DOCUMENTS.businessTerms.version, "business-terms-2026-09-27");
  assert.equal(LEGAL_DOCUMENTS.partnerTerms.version, "partner-terms-2026-09-27");
  const source = readFileSync("src/lib/legal.ts", "utf8");
  assert.match(source, /Nothing in these terms excludes refunds or withdrawal rights where required by applicable law/);
});


test("automatic card action rejects an actual customer-balance charge before refunds.create", async () => {
  const { calls, dependencies } = createRefundRequestHarness();
  dependencies.stripe.charges.retrieve = (async () => ({ paid: true, amount: 10000, amount_refunded: 0, payment_method_details: { type: "customer_balance" } })) as never;
  await assert.rejects(requestInitialRefund({ businessId: "business-1", userId: "owner-1" }, dependencies), /refund_unsupported_payment_method/);
  assert.equal(calls.refunds.length, 0);
});
