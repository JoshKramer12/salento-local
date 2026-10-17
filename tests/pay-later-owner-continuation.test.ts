import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

const localRequire = createRequire(import.meta.url);
localRequire.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_target, key) => key === "__esModule" ? false : String(key) }); };

async function ownerScreen({ locale = "en", signedEarlier = false, paymentMethod = null, hash = "#invite=test-token" }: {
  locale?: "en" | "it"; signedEarlier?: boolean; paymentMethod?: "ONLINE" | "BANK_TRANSFER" | null; hash?: string;
} = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: `https://salento.example.test/pay-later${hash}`,
  });
  const previous = { document: globalThis.document, window: globalThis.window, self: globalThis.self,
    navigator: globalThis.navigator,
    MouseEvent: globalThis.MouseEvent, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window, self: dom.window,
    navigator: dom.window.navigator,
    MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const { PayLaterOwnerClient } = await import("@/components/account/pay-later-owner-client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const props = { token: "test-token", locale, verified: true, emailHint: "o•••@example.test",
    paymentPaused: false, submission: { businessName: "Masseria Test", address: "Via Test 1", town: "Lecce",
      category: "Restaurants", description: "A synthetic listing", openingHours: "[]", phone: "+393200000001",
      email: "business@example.test", photos: [], ownerName: "Test Owner", signedEarlier, paymentMethod } };
  await act(async () => root.render(createElement(PayLaterOwnerClient, props)));

  const button = (label: string) => {
    const match = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === label);
    assert.ok(match, `Missing button: ${label}`);
    return match;
  };
  const click = async (element: Element) => {
    await act(async () => element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  };
  return { dom, document: dom.window.document, button, click,
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close(); } };
}

async function advanceThroughSignature(ui: Awaited<ReturnType<typeof ownerScreen>>, locale: "en" | "it") {
  await ui.click(ui.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await ui.click(ui.button(locale === "it" ? "Continua" : "Continue"));
  await ui.click(ui.document.querySelector<HTMLInputElement>('.owner-agreement__acceptance input')!);
  await ui.click(ui.button(locale === "it" ? "Continua alla firma" : "Continue to signature"));

  const name = ui.document.querySelector<HTMLInputElement>('input[autocomplete="name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(ui.dom.window.HTMLInputElement.prototype, "value")!.set!.call(name, "Test Owner");
    name.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
  });
  const pad = ui.document.querySelector<HTMLElement>('[role="img"][aria-label="Sign in the box"], [role="img"][aria-label="Firma nel riquadro"]')!;
  pad.getBoundingClientRect = () => ({ x: 0, y: 0, width: 640, height: 220,
    top: 0, left: 0, right: 640, bottom: 220, toJSON() {} });
  pad.setPointerCapture = () => {};
  pad.releasePointerCapture = () => {};
  const pointer = (type: string, x: number) => {
    const event = new ui.dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: 1, clientX: x, clientY: 20 });
    return event;
  };
  await act(async () => {
    pad.dispatchEvent(pointer("pointerdown", 10));
    pad.dispatchEvent(pointer("pointerup", 30));
  });
  const continueButton = ui.button(locale === "it" ? "Continua al pagamento" : "Continue to payment");
  assert.equal(continueButton.disabled, false, `name=${name.value}, paths=${pad.querySelectorAll("path").length}`);
  await ui.click(continueButton);
}

for (const locale of ["en", "it"] as const) {
  for (const signedEarlier of [false, true]) {
    test(`verified ${locale} invitation continues from signature to renewal (partner signature: ${signedEarlier})`, async () => {
      const ui = await ownerScreen({ locale, signedEarlier, hash: "#invite=test-token&step=decision" });
      try {
        await advanceThroughSignature(ui, locale);
        assert.match(ui.document.body.textContent ?? "", locale === "it" ? /Come vuoi rinnovare la tua scheda\?/ : /How would you like to renew your listing\?/);
        assert.doesNotMatch(ui.document.body.textContent ?? "", /When would you like to pay\?|Quando preferisci pagare\?|You already have an invitation|Hai già ricevuto un invito/);
        assert.equal(new URLSearchParams(ui.dom.window.location.hash.slice(1)).get("step"), "renewal");
        await ui.click(ui.button(locale === "it" ? "Indietro" : "Back"));
        assert.match(ui.document.body.textContent ?? "", locale === "it" ? /Firma per continuare/ : /Sign to continue/);
        assert.equal(new URLSearchParams(ui.dom.window.location.hash.slice(1)).get("step"), null);
        await ui.click(ui.button(locale === "it" ? "Continua al pagamento" : "Continue to payment"));
        assert.match(ui.document.body.textContent ?? "", locale === "it" ? /Come vuoi rinnovare/ : /How would you like to renew/);
      } finally { await ui.close(); }
    });
  }
}

test("saved payment method resumes directly without another timing or renewal choice", async () => {
  const ui = await ownerScreen({ paymentMethod: "ONLINE", hash: "#invite=test-token&step=decision&renewal=MANUAL" });
  try {
    assert.match(ui.document.body.textContent ?? "", /A payment method has already been selected/);
    assert.ok(ui.button("Continue payment"));
    assert.doesNotMatch(ui.document.body.textContent ?? "", /When would you like to pay\?|How would you like to renew/);
  } finally { await ui.close(); }
});

test("renewal preference survives history navigation and refresh without reviving the timing choice", async () => {
  const ui = await ownerScreen();
  let savedHash = "";
  try {
    await advanceThroughSignature(ui, "en");
    await ui.click(ui.document.querySelector<HTMLInputElement>('input[name="renewalChoice"][value="MANUAL"]')!);
    await ui.click(ui.button("Continue"));
    assert.match(ui.document.body.textContent ?? "", /How would you like to pay\?/);
    savedHash = ui.dom.window.location.hash;
    assert.equal(new URLSearchParams(savedHash.slice(1)).get("renewal"), "MANUAL");
    ui.dom.window.history.replaceState({}, "", "#invite=test-token&renewal=MANUAL");
    await act(async () => ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate")));
    assert.match(ui.document.body.textContent ?? "", /Sign to continue/);
    ui.dom.window.history.replaceState({}, "", savedHash);
    await act(async () => ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate")));
    assert.match(ui.document.body.textContent ?? "", /How would you like to pay\?/);
    ui.dom.window.history.replaceState({}, "", "#invite=test-token&step=decision&renewal=MANUAL");
    await act(async () => ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate")));
    assert.match(ui.document.body.textContent ?? "", /How would you like to renew your listing\?/);
    assert.equal(ui.document.querySelector<HTMLInputElement>('input[name="renewalChoice"][value="MANUAL"]')?.checked, true);
  } finally { await ui.close(); }

  const resumed = await ownerScreen({ hash: savedHash });
  try {
    await act(async () => resumed.dom.window.dispatchEvent(new resumed.dom.window.PopStateEvent("popstate")));
    assert.match(resumed.document.body.textContent ?? "", /I confirm that my business details are correct/);
    await advanceThroughSignature(resumed, "en");
    assert.equal(resumed.document.querySelector<HTMLInputElement>('input[name="renewalChoice"][value="MANUAL"]')?.checked, true);
    assert.doesNotMatch(resumed.document.body.textContent ?? "", /When would you like to pay\?|You already have an invitation/);
  } finally { await resumed.close(); }
});

test("ordinary payment timing decision still offers both choices in English and Italian", async () => {
  const { PaymentDecisionStep } = await import("@/components/account/pay-later-payment-steps");
  const { renderToStaticMarkup } = await import("react-dom/server");
  for (const locale of ["en", "it"] as const) {
    const markup = renderToStaticMarkup(createElement(PaymentDecisionStep, {
      locale, onNow() {}, onLater() {}, onBack() {},
    }));
    assert.match(markup, locale === "it" ? /Quando preferisci pagare\?/ : /When would you like to pay\?/);
    assert.match(markup, locale === "it" ? /Paga ora/ : /Pay now/);
    assert.match(markup, locale === "it" ? /Paga più tardi/ : /Pay later/);
  }
});
