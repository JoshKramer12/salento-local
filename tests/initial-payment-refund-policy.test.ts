import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { InitialPaymentRefundPolicy } from "@/components/account/initial-payment-refund-policy";

const paymentPage = readFileSync("src/app/pay/element/[token]/page.tsx", "utf8");

test("the refund panel stays between the membership summary and the unchanged Stripe form", () => {
  assert.ok(paymentPage.indexOf("Salento Local annual membership") < paymentPage.indexOf("<InitialPaymentRefundPolicy"));
  assert.ok(paymentPage.indexOf("<InitialPaymentRefundPolicy") < paymentPage.indexOf("<NoEmailPaymentForm"));
  assert.match(paymentPage, /<NoEmailPaymentForm amount=\{amount\} clientSecret=\{intent\.client_secret\}/);
});

for (const locale of ["en", "it"] as const) {
  test(`${locale}: refund panel toggles accessibly without remounting an adjacent payment field`, async () => {
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://salentolocal.ca" });
    const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    let mounts = 0;
    function PaymentField() {
      useEffect(() => { mounts += 1; }, []);
      return createElement("input", { "aria-label": "Payment field", defaultValue: "entered card state" });
    }
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      await act(async () => root.render(createElement("div", null,
        createElement(InitialPaymentRefundPolicy, { amount: locale === "it" ? "100,00 €" : "€100.00", locale }),
        createElement(PaymentField),
      )));
      const button = dom.window.document.querySelector("button")!;
      const panel = dom.window.document.getElementById(button.getAttribute("aria-controls")!)!;
      const field = dom.window.document.querySelector("input")!;
      assert.equal(button.type, "button");
      assert.equal(panel.getAttribute("role"), "region");
      assert.equal(panel.getAttribute("aria-labelledby"), button.id);
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.equal(panel.getAttribute("aria-hidden"), "true");
      assert.equal(panel.hasAttribute("inert"), true);
      assert.equal(button.textContent?.includes(locale === "it" ? "Visualizza la politica di rimborso" : "View 14-day refund policy"), true);

      await act(async () => button.click());
      assert.equal(button.getAttribute("aria-expanded"), "true");
      assert.equal(panel.getAttribute("aria-hidden"), "false");
      assert.equal(panel.hasAttribute("inert"), false);
      assert.match(panel.textContent!, locale === "it" ? /Politica di rimborso entro 14 giorni/ : /14-day refund policy/);
      assert.match(panel.textContent!, locale === "it" ? /€100,00/ : /€100\.00/);
      for (const heading of locale === "it"
        ? ["Politica di rimborso entro 14 giorni", "1. Richiedi un rimborso completo entro 14 giorni", "2. Come richiedere un rimborso", "3. Cosa succede dopo il rimborso?"]
        : ["14-day refund policy", "1. Request a full refund within 14 days", "2. How to request a refund", "3. What happens after a refund?"]) {
        assert.ok(panel.textContent!.includes(heading), `Missing refund copy: ${heading}`);
      }
      assert.match(panel.textContent!, locale === "it" ? /Ti basta accedere al tuo account/ : /Simply log into your account/);
      assert.match(panel.textContent!, locale === "it" ? /non sarà più visibile sul sito/ : /will no longer be publicly visible/);
      assert.equal(panel.querySelector("a")?.getAttribute("href"), "/terms#refunds");
      assert.match(panel.querySelector("a")!.textContent!, locale === "it" ? /Consulta la politica di rimborso completa →/ : /View full refund policy →/);
      assert.equal(dom.window.document.querySelector("input"), field);
      assert.equal(field.value, "entered card state");
      assert.equal(mounts, 1);

      await act(async () => button.click());
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.equal(panel.getAttribute("aria-hidden"), "true");
      assert.equal(panel.hasAttribute("inert"), true);
      assert.equal(dom.window.document.querySelector("input"), field);
      assert.equal(mounts, 1);
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, previous);
      dom.window.close();
    }
  });
}
