import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  beginPaymentQrAttempt,
  ensurePaymentQrActionResult,
  finishPaymentQrAttempt,
  preparePaymentQrNavigation,
  type PaymentQrMethod,
} from "@/lib/payment-qr-navigation";
import { duplicateResponseMatchesSubmittedValues } from "@/lib/publish-flow";

type Identity = { address: string; businessName: string; phone: string };
type ActionInput = { duplicateDecision: string; method: PaymentQrMethod };
type ActionResult = {
  duplicateMatches?: unknown[];
  error?: string;
  paymentDestination?: string;
};

const submittedIdentity: Identity = {
  address: "Via Vittorio Bachelet 23",
  businessName: "asdsad",
  phone: "+39 1234567898",
};
const googleFormattedAddress = "Via Vittorio Bachelet, 23, 73100 Lecce LE, Italy";

function PublishFormPaymentFlowHarness({
  action,
  duplicateResponse,
  onNavigate,
}: {
  action: (input: ActionInput) => Promise<ActionResult>;
  duplicateResponse: Identity;
  onNavigate: (destination: string) => void;
}) {
  const [duplicateDecision, setDuplicateDecision] = useState<"" | "new">("");
  const [duplicateReviewVisible, setDuplicateReviewVisible] = useState(false);
  const [draftSaves, setDraftSaves] = useState(0);
  const [error, setError] = useState("");
  const [paymentOpeningGate] = useState(() => ({ current: false }));

  function checkDuplicates() {
    setDuplicateReviewVisible(
      duplicateResponseMatchesSubmittedValues(duplicateResponse, submittedIdentity),
    );
  }

  async function openPayment(method: PaymentQrMethod) {
    if (!beginPaymentQrAttempt(paymentOpeningGate)) return;
    setError("");

    try {
      const result = ensurePaymentQrActionResult({
        locale: "en",
        result: await action({ duplicateDecision, method }),
      });

      if (result.paymentDestination) onNavigate(result.paymentDestination);
      else setError(result.error ?? "");
    } finally {
      finishPaymentQrAttempt(paymentOpeningGate);
    }
  }

  return createElement(
    "div",
    { "data-google-formatted-address": googleFormattedAddress },
    createElement("button", { onClick: checkDuplicates, type: "button" }, "Check duplicates"),
    duplicateReviewVisible
      ? createElement(
          "button",
          { onClick: () => setDuplicateDecision("new"), type: "button" },
          "Add new business",
        )
      : null,
    duplicateDecision === "new"
      ? createElement(
          "button",
          { onClick: () => setDraftSaves((value) => value + 1), type: "button" },
          `Save draft ${draftSaves}`,
        )
      : null,
    duplicateDecision === "new"
      ? createElement(
          "button",
          { onClick: () => void openPayment("ONLINE"), type: "button" },
          "Show payment QR",
        )
      : null,
    duplicateDecision === "new"
      ? createElement(
          "button",
          { onClick: () => void openPayment("BANK_TRANSFER"), type: "button" },
          "Show bank transfer QR",
        )
      : null,
    error ? createElement("p", { role: "alert" }, error) : null,
  );
}

async function renderHarness(action: (input: ActionInput) => Promise<ActionResult>) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const previousDocument = globalThis.document;
  const previousMouseEvent = globalThis.MouseEvent;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  Object.assign(globalThis, {
    document: dom.window.document,
    MouseEvent: dom.window.MouseEvent,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const navigations: string[] = [];
  const root = createRoot(dom.window.document.getElementById("root")!);

  await act(async () => {
    root.render(
      createElement(PublishFormPaymentFlowHarness, {
        action,
        duplicateResponse: submittedIdentity,
        onNavigate: (destination) => navigations.push(destination),
      }),
    );
  });

  return {
    click: async (name: string) => {
      const button = [...dom.window.document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === name,
      ) as HTMLButtonElement | undefined;
      assert.ok(button, `Expected button ${name}`);
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    },
    dom,
    navigations,
    teardown: async () => {
      await act(async () => root.unmount());
      Object.assign(globalThis, {
        document: previousDocument,
        MouseEvent: previousMouseEvent,
        window: previousWindow,
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      });
      dom.window.close();
    },
  };
}

test("the production street-line duplicate response matches despite Google's longer formatted display address", () => {
  assert.notEqual(submittedIdentity.address, googleFormattedAddress);
  assert.equal(
    duplicateResponseMatchesSubmittedValues(submittedIdentity, {
      ...submittedIdentity,
      address: googleFormattedAddress,
    }),
    false,
  );
  assert.equal(duplicateResponseMatchesSubmittedValues(submittedIdentity, submittedIdentity), true);
});

for (const [method, button] of [
  ["ONLINE", "Show payment QR"],
  ["BANK_TRANSFER", "Show bank transfer QR"],
] as const) {
  test(`PublishForm ${method} invariant: review duplicate, retain approval, prepare, then navigate`, async () => {
    const calls: ActionInput[] = [];
    const preparationOrder: string[] = [];
    const harness = await renderHarness(async (input) => {
      calls.push(input);
      assert.equal(input.duplicateDecision, "new");
      const paymentDestination = await preparePaymentQrNavigation({
        method: input.method,
        prepareBankTransfer: async () => {
          preparationOrder.push("bank-prepared");
        },
        prepareOnline: async () => {
          preparationOrder.push("card-prepared");
        },
        submissionId: "cmth3a8fw0001pi01kln6o08t",
      });
      preparationOrder.push("destination-returned");
      return { paymentDestination };
    });

    try {
      await harness.click("Check duplicates");
      await harness.click("Add new business");
      await harness.click("Save draft 0");
      await harness.click("Save draft 1");
      await harness.click("Save draft 2");
      await harness.click(button);

      assert.deepEqual(calls, [{ duplicateDecision: "new", method }]);
      assert.deepEqual(preparationOrder, [
        method === "ONLINE" ? "card-prepared" : "bank-prepared",
        "destination-returned",
      ]);
      assert.deepEqual(harness.navigations, [
        "/publish/payment?submission=cmth3a8fw0001pi01kln6o08t",
      ]);
    } finally {
      await harness.teardown();
    }
  });
}

test("PublishForm exposes an ambiguous payment result as a visible error and unlocks retry", async () => {
  let attempts = 0;
  const harness = await renderHarness(async () => {
    attempts += 1;
    return attempts === 1
      ? { duplicateMatches: [{}] }
      : { paymentDestination: "/publish/payment?submission=retry" };
  });

  try {
    await harness.click("Check duplicates");
    await harness.click("Add new business");
    await harness.click("Show payment QR");
    assert.equal(
      harness.dom.window.document.querySelector("[role=alert]")?.textContent,
      "We couldn't open the payment QR. Please try again in a moment.",
    );

    await harness.click("Show payment QR");
    assert.equal(attempts, 2);
    assert.deepEqual(harness.navigations, ["/publish/payment?submission=retry"]);
  } finally {
    await harness.teardown();
  }
});

test("the active PublishForm compares duplicate responses with the submitted street line", () => {
  const source = readFileSync("src/components/account/publish-form.tsx", "utf8");

  assert.match(
    source,
    /duplicateResponseMatchesSubmittedValues\(nextSubmission, \{\s*address,\s*businessName,\s*phone: businessPhone,/,
  );
  assert.doesNotMatch(source, /currentAddressValue[\s\S]*selectedAddress\.formattedAddress/);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*startTransition\(\(\) => \{\s*setDuplicateDecision\(""\);[\s\S]*?\}\);\s*\}, \[duplicateCheckMessage, activeDuplicateMatches\.length\]\);/,
  );
});
