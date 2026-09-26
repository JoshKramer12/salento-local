import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";

import { OwnerAgreementStep } from "@/components/account/owner-agreement-step";

function AgreementHarness({ locale }: { locale: "en" | "it" }) {
  const [accepted, setAccepted] = useState(false);
  return createElement(OwnerAgreementStep, {
    accepted,
    businessName: "Masseria Test",
    firstYearPriceLabel: "€100",
    keyTerms: ["I am authorized to act for the business.", "The membership lasts 365 days."],
    locale,
    onAcceptedChange: setAccepted,
    photoUrl: "/test-business.jpg",
    privacyLink: { href: "/privacy", label: "Privacy Policy" },
    renewalPriceLabel: "€100",
    termsLink: { href: "/terms", label: "Business Terms & Conditions" },
    townName: "Lecce",
  });
}

for (const locale of ["en", "it"] as const) {
  test(`agreement disclosures and acceptance remain independent in ${locale}`, async () => {
    const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
    const previous = {
      document: globalThis.document,
      MouseEvent: globalThis.MouseEvent,
      self: globalThis.self,
      window: globalThis.window,
      IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    };
    Object.assign(globalThis, {
      document: dom.window.document,
      MouseEvent: dom.window.MouseEvent,
      self: dom.window,
      window: dom.window,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const root = createRoot(dom.window.document.getElementById("root")!);

    const click = async (element: Element) => {
      await act(async () => {
        element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    };

    try {
      await act(async () => root.render(createElement(AgreementHarness, { locale })));
      const [keyTermsButton, documentsButton] = [...dom.window.document.querySelectorAll<HTMLButtonElement>(".owner-agreement__disclosure-button")];
      const checkbox = dom.window.document.querySelector<HTMLInputElement>(".owner-agreement__acceptance input")!;
      const keyTermsBody = dom.window.document.getElementById("owner-agreement-key-terms")!;
      const documentsBody = dom.window.document.getElementById("owner-agreement-documents")!;

      assert.equal(keyTermsButton.getAttribute("aria-expanded"), "false");
      assert.equal(documentsButton.getAttribute("aria-expanded"), "false");
      assert.equal(keyTermsBody.hidden, true);
      assert.equal(documentsBody.hidden, true);
      assert.equal(checkbox.checked, false);
      assert.match(dom.window.document.body.textContent ?? "", /Masseria Test/);
      assert.match(dom.window.document.body.textContent ?? "", /€100/);

      await click(keyTermsButton);
      assert.equal(keyTermsBody.hidden, false);
      assert.equal(documentsBody.hidden, true);
      await click(documentsButton);
      assert.equal(documentsBody.hidden, false);
      assert.equal(keyTermsBody.hidden, false);
      assert.deepEqual([...documentsBody.querySelectorAll("a")].map((link) => link.getAttribute("href")), ["/terms", "/privacy"]);
      await click(checkbox);
      assert.equal(checkbox.checked, true);
      await click(keyTermsButton);
      await click(documentsButton);
      assert.equal(keyTermsBody.hidden, true);
      assert.equal(documentsBody.hidden, true);
      assert.equal(checkbox.checked, true);
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, previous);
      dom.window.close();
    }
  });
}
