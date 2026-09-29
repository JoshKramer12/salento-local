import type Stripe from "stripe";

let harnessSequence = 0;

/** Isolated Stripe TEST-shaped responses; never calls a provider. */
export function membershipStripeHarness() {
  const intents = new Map<string, Stripe.PaymentIntent>();
  const subscriptions = new Map<string, Stripe.Subscription>();
  const products = new Map<string, Stripe.Product>();
  const customers = new Map<string, Stripe.Customer>();
  const idempotent = new Map<string, unknown>();
  let sequence = 0;
  const namespace = ++harnessSequence;
  let expireCount = 0;
  let checkout: { status: string; payment_status: string } = { status: "open", payment_status: "unpaid" };
  function once<T>(key: string, make: () => T): T {
    if (!idempotent.has(key)) idempotent.set(key, make());
    return idempotent.get(key) as T;
  }
  const stripe = {
    checkout: { sessions: {
      retrieve: async () => ({ ...checkout, id: "cs_test_historical" }),
      expire: async () => { expireCount++; checkout.status = "expired"; },
    } },
    products: {
      create: async (args: Stripe.ProductCreateParams, options: { idempotencyKey: string }) => once(options.idempotencyKey, () => {
        const product = { id: `prod_test_${namespace}_${++sequence}`, metadata: args.metadata, name: args.name } as Stripe.Product;
        products.set(product.id, product); return product;
      }),
      retrieve: async (id: string) => products.get(id)!,
    },
    customers: {
      create: async (args: Stripe.CustomerCreateParams, options: { idempotencyKey: string }) => once(options.idempotencyKey, () => {
        const customer = { id: `cus_test_${namespace}_${++sequence}`, metadata: args.metadata, email: args.email } as Stripe.Customer;
        customers.set(customer.id, customer); return customer;
      }),
      retrieve: async (id: string) => customers.get(id)!,
    },
    paymentIntents: {
      create: async (args: Stripe.PaymentIntentCreateParams, options: { idempotencyKey: string }) => once(options.idempotencyKey, () => {
        const id = `pi_test_${namespace}_${++sequence}`;
        const intent = { ...args, id, client_secret: `${id}_secret_test`, status: "requires_payment_method", amount_received: 0 } as Stripe.PaymentIntent;
        intents.set(id, intent); return intent;
      }),
      retrieve: async (id: string) => { const intent = intents.get(id); if (!intent) throw new Error("missing_test_intent"); return intent; },
    },
    subscriptions: {
      create: async (args: Stripe.SubscriptionCreateParams, options: { idempotencyKey: string }) => once(options.idempotencyKey, () => {
        const id = `sub_test_${namespace}_${++sequence}`;
        const price = args.items![0].price_data!;
        const intentId = `pi_test_${namespace}_${++sequence}`;
        intents.set(intentId, { id: intentId, client_secret: `${intentId}_secret_test`, amount: price.unit_amount!, amount_received: 0,
          currency: price.currency, customer: args.customer, status: "requires_payment_method", metadata: {} } as Stripe.PaymentIntent);
        const invoice = { id: `in_test_${namespace}_${++sequence}`, amount_due: price.unit_amount!, amount_paid: 0,
          customer: args.customer, billing_reason: "subscription_create", currency: price.currency, status: "open",
          confirmation_secret: { client_secret: `${intentId}_secret_test` }, status_transitions: { paid_at: null },
          payments: { data: [{ status: "open", payment: { type: "payment_intent", payment_intent: intentId } }] },
        } as unknown as Stripe.Invoice;
        const subscription = { id, customer: args.customer, metadata: args.metadata, status: "incomplete", cancel_at_period_end: false,
          items: { data: [{ quantity: 1, price: { ...price, recurring: { interval: "year", interval_count: 1 } } }] }, latest_invoice: invoice,
        } as unknown as Stripe.Subscription;
        subscriptions.set(id, subscription); return subscription;
      }),
      retrieve: async (id: string) => subscriptions.get(id)!,
    },
  } as unknown as Stripe;
  return { stripe, intents, subscriptions, products, customers,
    get expireCount() { return expireCount; }, setCheckout: (value: typeof checkout) => { checkout = value; },
    succeed(payment: { stripePaymentIntentId: string | null; stripeSubscriptionId: string | null }, paidAt = new Date()) {
      const intent = intents.get(payment.stripePaymentIntentId!)!;
      intent.status = "succeeded"; intent.amount_received = intent.amount;
      if (payment.stripeSubscriptionId) {
        const subscription = subscriptions.get(payment.stripeSubscriptionId)!;
        subscription.status = "active";
        const invoice = subscription.latest_invoice as Stripe.Invoice;
        invoice.status = "paid"; invoice.amount_paid = invoice.amount_due;
        invoice.status_transitions.paid_at = Math.floor(paidAt.getTime() / 1000);
        invoice.payments!.data[0].status = "paid";
      }
    },
  };
}
