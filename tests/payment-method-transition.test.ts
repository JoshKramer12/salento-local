import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { usePaymentQrTransition } from "@/hooks/use-payment-qr-transition";
import type {
  PaymentQrMethod,
  PaymentQrSelectionResult,
} from "@/lib/payment-qr-navigation";

type PaymentAction = (formData: FormData) => Promise<PaymentQrSelectionResult>;

function PaymentChoiceHarness({
  action,
  locale = "en",
  navigate,
  ownerAccountState = "existing",
  ownerEmail = "owner@example.com",
  ownerHasNoEmail = false,
  publisherRole = "BUSINESS_OWNER",
}: {
  action: PaymentAction;
  locale?: "en" | "it";
  navigate: (destination: string) => void;
  ownerAccountState?: "existing" | "new";
  ownerEmail?: string;
  ownerHasNoEmail?: boolean;
  publisherRole?: "BUSINESS_OWNER" | "GETTER";
}) {
  const { error, openPaymentQr, pendingMethod } = usePaymentQrTransition({
    action,
    locale,
    navigate,
  });

  function open(method: PaymentQrMethod) {
    const formData = new FormData();
    formData.set("ownerAccountState", ownerAccountState);
    formData.set("ownerEmail", ownerEmail);
    formData.set("ownerHasNoEmail", ownerHasNoEmail ? "on" : "");
    formData.set("paymentMethod", method);
    formData.set("publisherRole", publisherRole);
    formData.set("submissionId", "submission-1");
    openPaymentQr(method, formData);
  }

  const pending = pendingMethod !== null;

  return createElement(
    "div",
    null,
    createElement(
      "button",
      { disabled: pending, onClick: () => open("ONLINE"), type: "button" },
      pendingMethod === "ONLINE" ? "Opening card QR" : "Show payment QR",
    ),
    createElement(
      "button",
      { disabled: pending, onClick: () => open("BANK_TRANSFER"), type: "button" },
      pendingMethod === "BANK_TRANSFER" ? "Opening bank QR" : "Show bank transfer QR",
    ),
    error ? createElement("p", { role: "alert" }, error) : null,
  );
}

async function renderHarness(
  action: PaymentAction,
  props: Partial<Parameters<typeof PaymentChoiceHarness>[0]> = {},
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const previousDocument = globalThis.document;
  const previousFormData = globalThis.FormData;
  const previousMouseEvent = globalThis.MouseEvent;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  Object.assign(globalThis, {
    document: dom.window.document,
    FormData: dom.window.FormData,
    MouseEvent: dom.window.MouseEvent,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const navigations: string[] = [];
  const root = createRoot(dom.window.document.getElementById("root")!);

  await act(async () => {
    root.render(
      createElement(PaymentChoiceHarness, {
        action,
        navigate: (destination) => navigations.push(destination),
        ...props,
      }),
    );
  });

  function button(name: string) {
    const match = [...dom.window.document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    ) as HTMLButtonElement | undefined;
    assert.ok(match, `Expected button ${name}`);
    return match;
  }

  return {
    button,
    click: async (name: string) => {
      await act(async () => {
        button(name).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    },
    dom,
    navigations,
    teardown: async () => {
      await act(async () => root.unmount());
      Object.assign(globalThis, {
        document: previousDocument,
        FormData: previousFormData,
        MouseEvent: previousMouseEvent,
        window: previousWindow,
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      });
      dom.window.close();
    },
  };
}

for (const [method, buttonLabel] of [
  ["ONLINE", "Show payment QR"],
  ["BANK_TRANSFER", "Show bank transfer QR"],
] as const) {
  test(`${method} click awaits its action result and navigates to the QR page`, async () => {
    const calls: Array<Record<string, string>> = [];
    const harness = await renderHarness(async (formData) => {
      calls.push(Object.fromEntries(formData.entries()) as Record<string, string>);
      return {
        destination: `/publish/payment?submission=${formData.get("submissionId")}`,
        ok: true,
      };
    });

    try {
      await harness.click(buttonLabel);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].paymentMethod, method);
      assert.deepEqual(harness.navigations, ["/publish/payment?submission=submission-1"]);
    } finally {
      await harness.teardown();
    }
  });
}

test("a payment failure is visible and both buttons re-enable for retry", async () => {
  let attempts = 0;
  const harness = await renderHarness(async () => {
    attempts += 1;
    return attempts === 1
      ? { error: "We couldn't open the payment QR. Please try again in a moment.", ok: false }
      : { destination: "/publish/payment?submission=retry", ok: true };
  });

  try {
    await harness.click("Show payment QR");
    assert.equal(
      harness.dom.window.document.querySelector("[role=alert]")?.textContent,
      "We couldn't open the payment QR. Please try again in a moment.",
    );
    assert.equal(harness.button("Show payment QR").disabled, false);
    assert.equal(harness.button("Show bank transfer QR").disabled, false);

    await harness.click("Show payment QR");
    assert.equal(attempts, 2);
    assert.deepEqual(harness.navigations, ["/publish/payment?submission=retry"]);
  } finally {
    await harness.teardown();
  }
});

test("a double click starts only one payment action while showing pending feedback", async () => {
  let calls = 0;
  let resolveAction!: (result: PaymentQrSelectionResult) => void;
  const actionResult = new Promise<PaymentQrSelectionResult>((resolve) => {
    resolveAction = resolve;
  });
  const harness = await renderHarness(async () => {
    calls += 1;
    return actionResult;
  });

  try {
    await harness.click("Show payment QR");
    assert.equal(harness.button("Opening card QR").disabled, true);
    assert.equal(harness.button("Show bank transfer QR").disabled, true);

    harness.button("Opening card QR").dispatchEvent(
      new harness.dom.window.MouseEvent("click", { bubbles: true }),
    );
    assert.equal(calls, 1);

    await act(async () => {
      resolveAction({ destination: "/publish/payment?submission=one", ok: true });
      await actionResult;
    });
    assert.deepEqual(harness.navigations, ["/publish/payment?submission=one"]);
  } finally {
    await harness.teardown();
  }
});

test("thrown actions expose localized errors and release the attempt gate", async () => {
  const harness = await renderHarness(async () => {
    throw new Error("private provider detail");
  }, { locale: "it" });

  try {
    await harness.click("Show bank transfer QR");
    assert.equal(
      harness.dom.window.document.querySelector("[role=alert]")?.textContent,
      "Non siamo riusciti ad aprire il QR di pagamento. Riprova tra un momento.",
    );
    assert.equal(harness.button("Show bank transfer QR").disabled, false);
  } finally {
    await harness.teardown();
  }
});

test("email, no-email, Partner, direct-owner, existing, and new-owner inputs use the same transition", async () => {
  const scenarios = [
    { ownerAccountState: "existing", ownerEmail: "owner@example.com", ownerHasNoEmail: false, publisherRole: "BUSINESS_OWNER" },
    { ownerAccountState: "new", ownerEmail: "new@example.com", ownerHasNoEmail: false, publisherRole: "BUSINESS_OWNER" },
    { ownerAccountState: "existing", ownerEmail: "owner@example.com", ownerHasNoEmail: false, publisherRole: "GETTER" },
    { ownerAccountState: "new", ownerEmail: "", ownerHasNoEmail: true, publisherRole: "GETTER" },
  ] as const;

  for (const scenario of scenarios) {
    for (const [method, buttonLabel] of [
      ["ONLINE", "Show payment QR"],
      ["BANK_TRANSFER", "Show bank transfer QR"],
    ] as const) {
      const seen: Array<Record<string, string>> = [];
      const harness = await renderHarness(async (formData) => {
        seen.push(Object.fromEntries(formData.entries()) as Record<string, string>);
        return { destination: "/publish/payment?submission=submission-1", ok: true };
      }, scenario);

      try {
        await harness.click(buttonLabel);
        assert.equal(seen[0].paymentMethod, method);
        assert.equal(seen[0].publisherRole, scenario.publisherRole);
        assert.equal(seen[0].ownerEmail, scenario.ownerEmail);
        assert.equal(seen[0].ownerHasNoEmail, scenario.ownerHasNoEmail ? "on" : "");
        assert.deepEqual(harness.navigations, ["/publish/payment?submission=submission-1"]);
      } finally {
        await harness.teardown();
      }
    }
  }
});

test("refreshing the choice page creates a fresh usable transition without changing the route contract", async () => {
  const action: PaymentAction = async () => ({
    destination: "/publish/payment?submission=refreshed",
    ok: true,
  });

  for (let mount = 0; mount < 2; mount += 1) {
    const harness = await renderHarness(action);
    try {
      await harness.click("Show payment QR");
      assert.deepEqual(harness.navigations, ["/publish/payment?submission=refreshed"]);
    } finally {
      await harness.teardown();
    }
  }
});

test("PublishForm uses the dedicated awaited payment action and cannot navigate from stale form state", () => {
  const source = readFileSync("src/components/account/publish-form.tsx", "utf8");

  assert.match(source, /usePaymentQrTransition\(\{/);
  assert.match(source, /action: openBusinessSubmissionPaymentAction/);
  assert.match(source, /openPaymentQr\(method, formData\)/);
  assert.doesNotMatch(source, /if \(state\.paymentDestination\)/);
});
