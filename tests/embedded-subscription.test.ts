import assert from "node:assert/strict";
import test from "node:test";

import { EMBEDDED_SUBSCRIPTION_FLOW, ensureEmbeddedSubscription, getVerifiedInitialSubscriptionInvoice, reconcileEmbeddedSubscriptionOperation } from "@/lib/embedded-subscription";

function fixture(failOnceOn?: "stripeProductId" | "stripeCustomerId" | "stripeSubscriptionId") {
  const submission = {
    id: "submission-1", userId: "partner-1", user: { role: "GETTER" },
    ownerEmail: "owner@example.com", ownerName: "Owner", ownerPhone: "+393331234567",
    businessName: "Test business", amountOwedCents: 10000,
    automaticRenewalAtAcceptance: true, paymentMethod: "ONLINE", paymentStatus: "PENDING_PAYMENT",
    status: "AWAITING_PAYMENT", agreementSignature: "signed", signedAt: new Date(), businessTermsAcceptedAt: new Date(),
  };
  let payment: Record<string, unknown> | null = null;
  let fail = failOnceOn;
  const created = { product: 0, customer: 0, subscription: 0 };
  const setupMetadata: Record<string, unknown> = {};
  const idempotent = new Map<string, unknown>();
  const product = { id: "prod_1", deleted: false, metadata: { paymentId: "initial-element:submission-1", paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW } };
  const customer = { id: "cus_1", deleted: false, email: submission.ownerEmail, metadata: { paymentId: "initial-element:submission-1", paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW } };
  const invoice = {
    id: "in_1", amount_due: 10000, amount_paid: 0, currency: "eur", status: "open",
    confirmation_secret: { client_secret: "pi_1_secret_test" },
    payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" }, status: "open" }] },
  };
  const subscription = {
    id: "sub_1", customer: customer.id, status: "incomplete", cancel_at_period_end: false,
    metadata: { paymentId: "initial-element:submission-1", paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW },
    items: { data: [{ quantity: 1, price: { product: product.id, currency: "eur", unit_amount: 10000,
      recurring: { interval: "year", interval_count: 1 } } }] },
    latest_invoice: invoice,
  };
  function once<T>(key: string, kind: keyof typeof created, value: T): T {
    if (!idempotent.has(key)) { created[kind]++; idempotent.set(key, value); }
    return idempotent.get(key) as T;
  }
  const db = {
    businessSubmission: { findUnique: async () => submission },
    payment: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async ({ where }: { where: { stripeInvoiceId?: string } }) =>
        payment && (!where.stripeInvoiceId || payment.stripeInvoiceId === where.stripeInvoiceId)
          ? { ...payment, businessSubmission: submission } : null,
      findUniqueOrThrow: async () => { if (!payment) throw Error("missing"); return { ...payment }; },
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        payment ??= {
          ...create, purpose: "INITIAL_MEMBERSHIP", stripeCheckoutSessionId: null,
          stripeProductId: null, stripeCustomerId: null, stripeSubscriptionId: null,
          stripeInvoiceId: null, stripePaymentIntentId: null, stripeSetupOperation: null,
          stripeSetupStartedAt: null, stripeSetupGeneration: 0,
        };
        return { ...payment };
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (!payment) throw Error("missing");
        if (fail && data[fail]) { fail = undefined; throw Error("simulated crash after Stripe response"); }
        for (const [key, value] of Object.entries(data)) {
          payment[key] = typeof value === "object" && value && "increment" in value
            ? Number(payment[key]) + Number(value.increment) : value;
        }
        return { count: 1 };
      },
    },
  };
  const stripe = {
    checkout: { sessions: { retrieve: async () => { throw Error("unexpected checkout"); } } },
    products: {
      create: async (data: { metadata: unknown }, options: { idempotencyKey: string }) => { setupMetadata.product = data.metadata; return once(options.idempotencyKey, "product", product); },
      retrieve: async () => product,
    },
    customers: {
      create: async (data: { metadata: unknown }, options: { idempotencyKey: string }) => { setupMetadata.customer = data.metadata; return once(options.idempotencyKey, "customer", customer); },
      retrieve: async () => customer,
    },
    subscriptions: {
      create: async (_data: unknown, options: { idempotencyKey: string }) => once(options.idempotencyKey, "subscription", subscription),
      retrieve: async () => subscription,
    },
    paymentIntents: {
      retrieve: async () => ({ id: "pi_1", status: "succeeded", amount: 10000, amount_received: 10000,
        currency: "eur", customer: customer.id }),
    },
  };
  const dependencies = { db: db as never, stripe: stripe as never };
  return { created, setupMetadata, dependencies, getPayment: () => payment, invoice, subscription };
}

test("embedded subscription setup persists exact Customer, Subscription, invoice and PaymentIntent IDs", async () => {
  const state = fixture();
  const first = await ensureEmbeddedSubscription("submission-1", state.dependencies);
  assert.equal(first?.stripeCustomerId, "cus_1");
  assert.equal(first?.stripeSubscriptionId, "sub_1");
  assert.equal(first?.stripeInvoiceId, "in_1");
  assert.equal(first?.stripePaymentIntentId, "pi_1");
  await ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) });
  assert.deepEqual(state.created, { product: 1, customer: 1, subscription: 1 });
});

test("a lost Customer response replays within the idempotency window and fails closed after it", async () => {
  const state = fixture("stripeCustomerId");
  const now = new Date("2026-09-25T10:00:00Z");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now }), /simulated crash/);
  assert.equal(state.getPayment()?.stripeCustomerId, null);
  assert.equal(state.getPayment()?.stripeSetupOperation, "customer");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
  }), /reconciliation_required/);
  assert.equal(state.created.customer, 1);
  const recovered = await ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 60 * 60 * 1000),
  });
  assert.equal(recovered?.stripeCustomerId, "cus_1");
  assert.deepEqual(state.created, { product: 1, customer: 1, subscription: 1 });
});

test("a lost Product response replays one product before creating Customer or Subscription", async () => {
  const state = fixture("stripeProductId");
  const now = new Date("2026-09-25T10:00:00Z");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now }), /simulated crash/);
  assert.equal(state.getPayment()?.stripeSetupOperation, "product");
  const recovered = await ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 60 * 60 * 1000),
  });
  assert.equal(recovered?.stripeProductId, "prod_1");
  assert.deepEqual(state.created, { product: 1, customer: 1, subscription: 1 });
});

test("a lost Subscription response replays the same subscription and persists its invoice", async () => {
  const state = fixture("stripeSubscriptionId");
  const now = new Date("2026-09-25T10:00:00Z");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now }), /simulated crash/);
  assert.equal(state.getPayment()?.stripeCustomerId, "cus_1");
  assert.equal(state.getPayment()?.stripeSubscriptionId, null);
  assert.equal(state.getPayment()?.stripeSetupOperation, "subscription");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
  }), /reconciliation_required/);
  assert.equal(state.created.subscription, 1);
  const recovered = await ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 60 * 60 * 1000),
  });
  assert.equal(recovered?.stripeSubscriptionId, "sub_1");
  assert.equal(recovered?.stripeInvoiceId, "in_1");
  assert.deepEqual(state.created, { product: 1, customer: 1, subscription: 1 });
});

test("an older ambiguous Customer operation can attach only its exact verified Stripe object", async () => {
  const state = fixture("stripeCustomerId");
  const now = new Date("2026-09-25T10:00:00Z");
  await assert.rejects(ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now }), /simulated crash/);
  await assert.rejects(reconcileEmbeddedSubscriptionOperation({
    operation: "customer", paymentId: "initial-element:submission-1", stripeObjectId: "cus_wrong",
  }, state.dependencies), /reconciliation_object_mismatch|reconciliation_state_mismatch/);
  const reconciled = await reconcileEmbeddedSubscriptionOperation({
    operation: "customer", paymentId: "initial-element:submission-1", stripeObjectId: "cus_1",
  }, state.dependencies);
  assert.equal(reconciled.stripeCustomerId, "cus_1");
  const complete = await ensureEmbeddedSubscription("submission-1", {
    ...state.dependencies, now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
  });
  assert.equal(complete?.stripeSubscriptionId, "sub_1");
  assert.equal(state.created.customer, 1);
});

test("verified Product and Subscription IDs recover old interrupted operations without new Stripe objects", async () => {
  for (const [operation, field, stripeObjectId] of [
    ["product", "stripeProductId", "prod_1"],
    ["subscription", "stripeSubscriptionId", "sub_1"],
  ] as const) {
    const state = fixture(field);
    const now = new Date("2026-09-25T10:00:00Z");
    await assert.rejects(ensureEmbeddedSubscription("submission-1", { ...state.dependencies, now }), /simulated crash/);
    await assert.rejects(ensureEmbeddedSubscription("submission-1", {
      ...state.dependencies, now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
    }), /reconciliation_required/);
    const reconciled = await reconcileEmbeddedSubscriptionOperation({
      operation, paymentId: "initial-element:submission-1", stripeObjectId,
    }, state.dependencies);
    assert.equal(reconciled[field], stripeObjectId);
    const complete = await ensureEmbeddedSubscription("submission-1", {
      ...state.dependencies, now: new Date(now.getTime() + 25 * 60 * 60 * 1000),
    });
    assert.equal(complete?.stripeSubscriptionId, "sub_1");
    assert.deepEqual(state.created, { product: 1, customer: 1, subscription: 1 });
  }
});

test("only the exact paid initial invoice can finalize the embedded subscription", async () => {
  const state = fixture();
  await ensureEmbeddedSubscription("submission-1", state.dependencies);
  state.subscription.status = "active";
  const paid = {
    ...state.invoice, status: "paid", amount_paid: 10000, billing_reason: "subscription_create",
    customer: "cus_1", payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_1" } }] },
    parent: { subscription_details: { subscription: "sub_1", metadata: {
      paymentId: "initial-element:submission-1", paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW,
    } } },
  };
  const verified = await getVerifiedInitialSubscriptionInvoice(paid as never, state.dependencies);
  assert.equal(verified?.payment.id, "initial-element:submission-1");
  assert.equal(await getVerifiedInitialSubscriptionInvoice({ ...paid, billing_reason: "subscription_cycle" } as never, state.dependencies), null);
  assert.equal(await getVerifiedInitialSubscriptionInvoice({ ...paid, id: "in_other" } as never, state.dependencies), null);
  state.subscription.items.data[0].price.unit_amount = 9000;
  assert.equal(await getVerifiedInitialSubscriptionInvoice(paid as never, state.dependencies), null);
});


test("initial Product and Customer retry payloads retain historical idempotency parameters", async () => {
  const state = fixture();
  await ensureEmbeddedSubscription("submission-1", state.dependencies);
  const expected = { businessSubmissionId: "submission-1", paymentId: "initial-element:submission-1", paymentFlow: EMBEDDED_SUBSCRIPTION_FLOW };
  assert.deepEqual(state.setupMetadata.product, expected);
  assert.deepEqual(state.setupMetadata.customer, expected);
});
