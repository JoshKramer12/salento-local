import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

async function harness(locale: "en" | "it" = "en", subscription = false, ownerEmail = "owner@example.test") {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://salento.example.test" });
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const destinations: string[] = [];
  const browserWindow = new Proxy(dom.window, { get(target, key) {
    if (key === "location") return { assign: (url: string) => destinations.push(url) };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  Object.assign(globalThis, { window: browserWindow, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  // React Stripe decides whether to mount client Elements when first imported.
  const { Elements } = createRequire(import.meta.url)("@stripe/react-stripe-js");
  const { PaymentForm } = await import("@/components/account/no-email-payment-form");
  type Handler = (event?: unknown) => unknown;
  const mounted: Record<string, { options: Record<string, unknown>; handlers: Map<string, Handler>; emit: (event: string, value?: unknown) => unknown }> = {};
  let submits = 0;
  const confirms: Record<string, unknown>[] = [];
  let submitResult: object = {};
  let confirmResult: object = { error: { message: "Declined" } };
  let confirmImplementation: (() => Promise<object>) | null = null;
  let retrieveResult: object = { paymentIntent: { status: "requires_payment_method" } };
  let retrieveImplementation: (() => Promise<object>) | null = null;
  const elements = {
    create(type: string, options: Record<string, unknown>) {
      const handlers = new Map<string, Handler>();
      const element = { options, handlers, emit: (name: string, event?: unknown) => handlers.get(name)?.(event),
        on: (name: string, callback: Handler) => handlers.set(name, callback), off: (name: string) => handlers.delete(name),
        mount: () => {}, destroy: () => {}, update: () => {},
      };
      mounted[type] = element;
      return element;
    },
    submit: async () => { submits += 1; return submitResult; },
  };
  const stripe = { elements: () => elements, createToken: () => {}, createPaymentMethod: () => {}, confirmCardPayment: () => {},
    confirmPayment: async (params: Record<string, unknown>) => { confirms.push(params); return confirmImplementation ? confirmImplementation() : confirmResult; },
    retrievePaymentIntent: async () => retrieveImplementation ? retrieveImplementation() : retrieveResult,
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const returnUrl = "https://salento.example.test/payment-status";
  await act(async () => root.render(createElement(Elements, { stripe: stripe as never, options: { clientSecret: "pi_test_secret_synthetic" } },
    createElement(PaymentForm, { amount: "€100", clientSecret: "pi_test_secret_synthetic", locale, ownerEmail, returnUrl,
      subscription: subscription ? { amountCents: 10000, managementUrl: "https://salento.example.test/dashboard" } : undefined,
    }))));
  const failed: unknown[] = [];
  const wallet = () => ({ expressPaymentType: "apple_pay", paymentFailed: (value: unknown) => failed.push(value) });
  return { dom, mounted, elements, confirms, destinations, failed, returnUrl,
    submits: () => submits,
    setSubmit: (value: object) => { submitResult = value; },
    setConfirm: (value: object) => { confirmResult = value; },
    setConfirmImplementation: (value: () => Promise<object>) => { confirmImplementation = value; },
    setRetrieve: (value: object) => { retrieveResult = value; },
    setRetrieveImplementation: (value: () => Promise<object>) => { retrieveImplementation = value; },
    emit: async (name: string, value?: unknown) => { await act(async () => { await mounted.expressCheckout.emit(name, value); }); },
    confirm: async () => { await act(async () => { await mounted.expressCheckout.emit("confirm", wallet()); }); },
    card: async () => { await act(async () => { dom.window.document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }); },
    button: () => dom.window.document.querySelector('button[type="submit"]') as HTMLButtonElement,
    teardown: async () => { await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close(); },
  };
}

for (const locale of ["en", "it"] as const) {
  test(`${locale}: wallet availability controls the entire section and localized divider`, async () => {
    const h = await harness(locale);
    try {
      const section = h.dom.window.document.querySelector("[data-payment-wallets]") as HTMLElement;
      assert.equal(section.hidden, true);
      await h.emit("ready", { availablePaymentMethods: undefined });
      assert.equal(section.hidden, true);
      await h.emit("ready", { availablePaymentMethods: { applePay: true, googlePay: false } });
      assert.equal(section.hidden, false);
      assert.ok(section.textContent?.includes(locale === "it" ? "oppure paga con carta" : "or pay by card"));
      await h.emit("availablepaymentmethodschange", { paymentMethods: { applePay: { available: false }, googlePay: { available: false } } });
      assert.equal(section.hidden, true);
      await h.emit("availablepaymentmethodschange", { paymentMethods: { googlePay: { available: true } } });
      assert.equal(section.hidden, false);
      await h.emit("loaderror");
      assert.equal(section.hidden, true);
      assert.equal(h.button().disabled, false);
    } finally { await h.teardown(); }
  });
}

test("official wallet options avoid extra fields, keep editable Italy and prevent duplicate wallets", async () => {
  const h = await harness();
  try {
    const options = h.mounted.expressCheckout.options;
    assert.deepEqual(options.paymentMethods, { applePay: "auto", googlePay: "auto", link: "never", paypal: "never", amazonPay: "never", klarna: "never" });
    // Stripe.js only accepts overflow=never with unlimited rows (maxRows=0).
    assert.deepEqual(options.layout, { maxColumns: 1, maxRows: 0, overflow: "never" });
    for (const key of ["billingAddressRequired", "emailRequired", "phoneNumberRequired", "shippingAddressRequired"]) assert.equal(options[key], false);
    assert.equal(options.applePay, undefined);
    assert.deepEqual(h.mounted.payment.options.defaultValues, { billingDetails: { address: { country: "IT" } } });
    assert.deepEqual(h.mounted.payment.options.fields, { billingDetails: { email: "never" } });
    assert.deepEqual(h.mounted.payment.options.wallets, { applePay: "never", googlePay: "never", link: "never" });
  } finally { await h.teardown(); }
});

test("subscription setup requests Apple merchant tokens with the actual annual amount and management URL", async () => {
  const h = await harness("it", true);
  try {
    assert.deepEqual(h.mounted.expressCheckout.options.buttonType, { applePay: "subscribe", googlePay: "subscribe" });
    assert.deepEqual(h.mounted.expressCheckout.options.applePay, { recurringPaymentRequest: {
      paymentDescription: "Adesione annuale Salento Local", managementURL: "https://salento.example.test/dashboard",
      regularBilling: { amount: 10000, label: "Adesione annuale Salento Local", recurringPaymentIntervalUnit: "year", recurringPaymentIntervalCount: 1 },
    } });
  } finally { await h.teardown(); }
});

test("canceling a wallet sheet unlocks the card without attempting a payment", async () => {
  const h = await harness();
  try {
    let resolved = 0; let rejected = 0;
    const click = { resolve: () => { resolved += 1; }, reject: () => { rejected += 1; } };
    await h.emit("click", click);
    assert.equal(resolved, 1); assert.equal(h.button().disabled, true);
    await h.emit("click", click); assert.equal(rejected, 1);
    await h.card(); assert.equal(h.confirms.length, 0);
    await h.emit("cancel"); assert.equal(h.button().disabled, false);
    assert.equal(h.confirms.length, 0); assert.equal(h.destinations.length, 0);
    await h.card(); assert.equal(h.confirms.length, 1);
  } finally { await h.teardown(); }
});

for (const stage of ["submit", "confirm", "throw"] as const) {
  test(`wallet ${stage} error releases the sheet and permits a card retry`, async () => {
    const h = await harness("it");
    try {
      if (stage === "submit") h.setSubmit({ error: { message: "Wallet validation failed" } });
      if (stage === "throw") h.setConfirmImplementation(async () => { throw new Error("Network failure"); });
      await h.confirm();
      assert.equal(h.failed.length, 1); assert.equal(h.button().disabled, false);
      assert.equal(h.destinations.length, 0);
      assert.match(h.dom.window.document.querySelector('[role="alert"]')!.textContent!, /Pagamento non riuscito/);
      h.setSubmit({}); h.setConfirmImplementation(async () => ({}));
      await h.card(); assert.deepEqual(h.destinations, [h.returnUrl]);
    } finally { await h.teardown(); }
  });
}

test("a lost confirmation response checks Stripe and opens the confirmed payment page", async () => {
  const h = await harness();
  try {
    h.setConfirm({ error: { message: "We are experiencing issues connecting to our payments provider." } });
    h.setRetrieve({ paymentIntent: { status: "succeeded" } });
    await h.card();
    assert.deepEqual(h.destinations, [h.returnUrl]);
    assert.equal(h.dom.window.document.querySelector('[role="alert"]'), null);
  } finally { await h.teardown(); }
});

test("a second confirmation error after success still opens the confirmed payment page", async () => {
  const h = await harness();
  try {
    h.setConfirm({ error: { message: "A processing error occurred." } });
    h.setRetrieve({ paymentIntent: { status: "succeeded" } });
    await h.card();
    assert.deepEqual(h.destinations, [h.returnUrl]);
  } finally { await h.teardown(); }
});

test("an unresolved Stripe status opens server verification instead of inviting a retry", async () => {
  const h = await harness();
  try {
    h.setConfirmImplementation(async () => { throw new Error("Network failure"); });
    h.setRetrieveImplementation(async () => { throw new Error("Network failure"); });
    await h.card();
    assert.deepEqual(h.destinations, [h.returnUrl]);
    assert.equal(h.dom.window.document.querySelector('[role="alert"]'), null);
  } finally { await h.teardown(); }
});

test("a declined card remains retryable when Stripe confirms no payment was made", async () => {
  const h = await harness();
  try {
    h.setConfirm({ error: { message: "Your card was declined." } });
    await h.card();
    assert.deepEqual(h.destinations, []);
    assert.equal(h.button().disabled, false);
    assert.match(h.dom.window.document.querySelector('[role="alert"]')!.textContent!, /card was declined/);
  } finally { await h.teardown(); }
});

test("wallet/card competing confirms and cancel during confirmation do not submit twice", async () => {
  const h = await harness();
  try {
    let finish!: (value: object) => void;
    h.setConfirmImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let pending: unknown;
    await act(async () => { pending = h.mounted.expressCheckout.emit("confirm", { expressPaymentType: "google_pay", paymentFailed: () => {} }); await Promise.resolve(); });
    await h.confirm(); await h.card(); await h.emit("cancel");
    let rejected = 0;
    await h.emit("click", { resolve: () => assert.fail("must not open another sheet"), reject: () => { rejected += 1; } });
    assert.equal(rejected, 1); assert.equal(h.submits(), 1); assert.equal(h.confirms.length, 1); assert.equal(h.button().disabled, true);
    await act(async () => { finish({}); await pending; });
    assert.deepEqual(h.destinations, [h.returnUrl]);
    assert.equal(h.confirms[0].elements, h.elements);
    assert.equal(h.confirms[0].redirect, "if_required");
    assert.deepEqual(h.confirms[0].confirmParams, { return_url: h.returnUrl, payment_method_data: { billing_details: { email: "owner@example.test" } } });
  } finally { await h.teardown(); }
});

test("no-email wallet uses Stripe-provided billing details and the same server reconciliation return", async () => {
  const h = await harness("en", false, "");
  try {
    h.setConfirm({}); await h.confirm();
    assert.equal(h.submits(), 1);
    assert.deepEqual(h.confirms[0].confirmParams, { return_url: h.returnUrl });
    assert.deepEqual(h.destinations, [h.returnUrl]);
  } finally { await h.teardown(); }
});
