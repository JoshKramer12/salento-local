import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

import { PaymentChoiceButton } from "@/components/account/payment-choice-button";
import { usePaymentQrTransition } from "@/hooks/use-payment-qr-transition";
import { requestPaymentQr } from "@/lib/payment-choice-client";
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
  onParentSubmit,
}: {
  action: PaymentAction;
  locale?: "en" | "it";
  navigate: (destination: string) => void;
  ownerAccountState?: "existing" | "new";
  ownerEmail?: string;
  ownerHasNoEmail?: boolean;
  publisherRole?: "BUSINESS_OWNER" | "GETTER";
  onParentSubmit?: () => void;
}) {
  const { error, openPaymentQr, pendingMethod } = usePaymentQrTransition({
    action,
    locale,
    navigate,
  });

  function open(method: PaymentQrMethod) {
    const formData = new FormData(document.querySelector("form")!);
    formData.set("paymentMethod", method);
    openPaymentQr(method, formData);
  }

  const pending = pendingMethod !== null;

  return createElement(
    "form",
    {
      onSubmit: (event: FormEvent) => {
        event.preventDefault();
        onParentSubmit?.();
      },
    },
    createElement("input", { name: "ownerAccountState", type: "hidden", value: ownerAccountState }),
    createElement("input", { name: "ownerEmail", type: "hidden", value: ownerEmail }),
    createElement("input", { name: "ownerHasNoEmail", type: "hidden", value: ownerHasNoEmail ? "on" : "" }),
    createElement("input", { name: "publisherRole", type: "hidden", value: publisherRole }),
    createElement("input", { name: "submissionId", type: "hidden", value: "submission-1" }),
    createElement(
      PaymentChoiceButton,
      { className: "online", disabled: pending, method: "ONLINE", onSelect: open },
      pendingMethod === "ONLINE" ? "Opening card QR" : "Show payment QR",
    ),
    createElement(
      PaymentChoiceButton,
      { className: "bank", disabled: pending, method: "BANK_TRANSFER", onSelect: open },
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
  let parentSubmits = 0;
  const root = createRoot(dom.window.document.getElementById("root")!);

  await act(async () => {
    root.render(
      createElement(PaymentChoiceHarness, {
        action,
        navigate: (destination) => navigations.push(destination),
        onParentSubmit: () => {
          parentSubmits += 1;
        },
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
    parentSubmits: () => parentSubmits,
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
      assert.equal(harness.parentSubmits(), 0);
      assert.equal(harness.button(buttonLabel).getAttribute("type"), "button");
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

test("PublishForm uses the stable payment endpoint and cannot navigate from stale form state", () => {
  const source = readFileSync("src/components/account/publish-form.tsx", "utf8");

  assert.match(source, /usePaymentQrTransition\(\{/);
  assert.match(source, /action: requestPaymentQr/);
  assert.match(source, /openPaymentQr\(method, formData\)/);
  assert.doesNotMatch(source, /if \(state\.paymentDestination\)/);
});

test("the payment endpoint client sends FormData and accepts an internal destination", async () => {
  const formData = new FormData();
  formData.set("paymentMethod", "ONLINE");
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  const result = await requestPaymentQr(formData, async (input, init) => {
    calls.push({ input, init });
    return Response.json({ destination: "/publish/payment?submission=stable", ok: true });
  });

  assert.deepEqual(result, {
    destination: "/publish/payment?submission=stable",
    ok: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "/api/publish/payment-choice");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, formData);
});
