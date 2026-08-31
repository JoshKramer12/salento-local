import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, startTransition, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type PaymentMethod = "ONLINE" | "BANK_TRANSFER";

function GuidedPaymentChoiceHarness({
  method,
  onNavigate,
  resetApprovedDecisionAfterDraft,
}: {
  method: PaymentMethod;
  onNavigate: (destination: string) => void;
  resetApprovedDecisionAfterDraft?: boolean;
}) {
  const [duplicateDecision, setDuplicateDecision] = useState<"" | "new">("");
  const [draftResponse, setDraftResponse] = useState(0);
  const [paymentDestination, setPaymentDestination] = useState("");

  useEffect(() => {
    if (paymentDestination) {
      onNavigate(paymentDestination);
    }
  }, [onNavigate, paymentDestination]);

  useEffect(() => {
    if (resetApprovedDecisionAfterDraft && draftResponse) {
      startTransition(() => setDuplicateDecision(""));
    }
  }, [draftResponse, resetApprovedDecisionAfterDraft]);

  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => setDuplicateDecision("new"), type: "button" }, "Add new business"),
    createElement("button", { onClick: () => setDraftResponse((value) => value + 1), type: "button" }, "Save draft"),
    createElement(
      "button",
      {
        onClick: () => {
          if (duplicateDecision !== "new") {
            return;
          }

          setPaymentDestination(`/publish/payment?submission=${method.toLowerCase()}-${draftResponse}`);
        },
        type: "button",
      },
      method === "ONLINE" ? "Show payment QR" : "Show bank transfer QR",
    ),
  );
}

async function renderHarness(method: PaymentMethod, resetApprovedDecisionAfterDraft = false) {
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
      createElement(GuidedPaymentChoiceHarness, {
        method,
        onNavigate: (destination) => navigations.push(destination),
        resetApprovedDecisionAfterDraft,
      }),
    );
  });

  return {
    click: async (name: string) => {
      const button = [...dom.window.document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === name,
      ) as HTMLButtonElement;
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    },
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

test("the deployed duplicate-decision reset reproduces the missing card payment destination", async () => {
  const harness = await renderHarness("ONLINE", true);
  try {
    await harness.click("Add new business");
    await harness.click("Save draft");
    await harness.click("Show payment QR");
    assert.deepEqual(harness.navigations, []);
  } finally {
    await harness.teardown();
  }
});

for (const [method, button, expected] of [
  ["ONLINE", "Show payment QR", "/publish/payment?submission=online-3"],
  ["BANK_TRANSFER", "Show bank transfer QR", "/publish/payment?submission=bank_transfer-3"],
] as const) {
  test(`guided ${method} payment choice retains an approved duplicate decision through draft saves`, async () => {
    const harness = await renderHarness(method);
    try {
      await harness.click("Add new business");
      await harness.click("Save draft");
      await harness.click("Save draft");
      await harness.click("Save draft");
      await harness.click(button);
      assert.deepEqual(harness.navigations, [expected]);
    } finally {
      await harness.teardown();
    }
  });
}

test("the active PublishForm does not erase an approved duplicate decision when an autosave changes duplicate response state", () => {
  const source = readFileSync("src/components/account/publish-form.tsx", "utf8");

  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{\s*startTransition\(\(\) => \{\s*setDuplicateDecision\(""\);[\s\S]*?\}\);\s*\}, \[duplicateCheckMessage, activeDuplicateMatches\.length\]\);/,
  );
});
