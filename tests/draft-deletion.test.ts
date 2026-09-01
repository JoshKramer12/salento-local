import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";

import { DraftDeleteControl } from "@/components/account/draft-delete-control";
import { isDraftLikeSubmission } from "@/lib/account";

type Draft = {
  id: string;
  name: string;
  paymentMethod: "BANK_TRANSFER" | "ONLINE" | null;
  paymentStatus: "AWAITING_BANK_TRANSFER" | "FAILED" | "NOT_REQUIRED" | "PENDING_PAYMENT";
  status: "AWAITING_PAYMENT" | "DRAFT" | "PAYMENT_PENDING";
};

const draftStates: Draft[] = [
  {
    id: "plain-draft",
    name: "Plain draft",
    paymentMethod: null,
    paymentStatus: "NOT_REQUIRED",
    status: "DRAFT",
  },
  {
    id: "awaiting-payment",
    name: "Awaiting payment draft",
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING_PAYMENT",
    status: "AWAITING_PAYMENT",
  },
  {
    id: "failed-payment",
    name: "Failed payment draft",
    paymentMethod: "BANK_TRANSFER",
    paymentStatus: "FAILED",
    status: "PAYMENT_PENDING",
  },
];

function DraftListHarness({
  deleteDraft,
  drafts: initialDrafts,
}: {
  deleteDraft: (id: string) => Promise<{ error?: string }>;
  drafts: Draft[];
}) {
  const [drafts, setDrafts] = useState(initialDrafts);

  return createElement(
    "div",
    undefined,
    createElement("output", { "data-draft-count": true }, String(drafts.length)),
    drafts.map((draft) =>
      createElement(
        "article",
        { "data-draft-id": draft.id, key: draft.id },
        createElement("h2", undefined, draft.name),
        createElement(DraftDeleteControl, {
          businessName: draft.name,
          locale: "en",
          onDelete: () => deleteDraft(draft.id),
          onDeleted: () => setDrafts((current) => current.filter((item) => item.id !== draft.id)),
        }),
      ),
    ),
  );
}

async function renderDrafts(
  drafts: Draft[],
  deleteDraft: (id: string) => Promise<{ error?: string }>,
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const previousDocument = globalThis.document;
  const previousKeyboardEvent = globalThis.KeyboardEvent;
  const previousMouseEvent = globalThis.MouseEvent;
  const previousWindow = globalThis.window;
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  Object.assign(globalThis, {
    document: dom.window.document,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    window: dom.window,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(dom.window.document.getElementById("root")!);

  await act(async () => {
    root.render(createElement(DraftListHarness, { deleteDraft, drafts }));
  });

  function getDraftTrigger(id: string) {
    const draft = dom.window.document.querySelector(`[data-draft-id=\"${id}\"]`);
    const trigger = draft?.querySelector("button") as HTMLButtonElement | null;
    assert.ok(trigger, `Expected delete trigger for ${id}`);
    return trigger;
  }

  function getDialogButton(label: string) {
    const dialog = dom.window.document.querySelector("[role=alertdialog]");
    const button = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === label,
    ) as HTMLButtonElement | undefined;
    assert.ok(button, `Expected dialog button ${label}`);
    return button;
  }

  return {
    click: async (button: HTMLButtonElement) => {
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    },
    count: () => dom.window.document.querySelector("[data-draft-count]")?.textContent,
    dom,
    getDialogButton,
    getDraftTrigger,
    keyDown: async (key: string) => {
      const dialog = dom.window.document.querySelector("[role=alertdialog]");
      assert.ok(dialog, "Expected confirmation dialog");
      await act(async () => {
        dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key }));
      });
    },
    teardown: async () => {
      await act(async () => root.unmount());
      Object.assign(globalThis, {
        document: previousDocument,
        KeyboardEvent: previousKeyboardEvent,
        MouseEvent: previousMouseEvent,
        window: previousWindow,
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
      });
      dom.window.close();
    },
  };
}

test("all currently supported draft states are eligible for deletion", () => {
  for (const draft of draftStates) {
    assert.equal(isDraftLikeSubmission(draft), true, draft.id);
  }
});

test("Delete draft opens an accessible confirmation and Cancel leaves the draft unchanged", async () => {
  const deleted: string[] = [];
  const harness = await renderDrafts([draftStates[0]], async (id) => {
    deleted.push(id);
    return {};
  });

  try {
    await harness.click(harness.getDraftTrigger("plain-draft"));
    assert.equal(harness.dom.window.document.querySelector("[role=alertdialog]")?.textContent?.includes("Are you sure you want to delete this draft?"), true);
    assert.equal(harness.dom.window.document.activeElement?.textContent, "Cancel");

    await harness.click(harness.getDialogButton("Cancel"));
    assert.equal(harness.dom.window.document.querySelector("[role=alertdialog]"), null);
    assert.equal(harness.count(), "1");
    assert.deepEqual(deleted, []);

    await harness.click(harness.getDraftTrigger("plain-draft"));
    await harness.keyDown("Escape");
    assert.equal(harness.dom.window.document.querySelector("[role=alertdialog]"), null);
    assert.deepEqual(deleted, []);
  } finally {
    await harness.teardown();
  }
});

test("confirmed deletion removes only the selected draft and updates the count for every draft state", async () => {
  const deleted: string[] = [];
  const harness = await renderDrafts(draftStates, async (id) => {
    deleted.push(id);
    return {};
  });

  try {
    for (const [index, draft] of draftStates.entries()) {
      await harness.click(harness.getDraftTrigger(draft.id));
      await harness.click(harness.getDialogButton("Delete draft"));

      assert.equal(harness.dom.window.document.querySelector(`[data-draft-id=\"${draft.id}\"]`), null);
      assert.equal(harness.count(), String(draftStates.length - index - 1));
    }

    assert.deepEqual(deleted, draftStates.map((draft) => draft.id));
  } finally {
    await harness.teardown();
  }
});

test("a deletion failure keeps the draft visible and shows the returned error", async () => {
  const harness = await renderDrafts([draftStates[0]], async () => ({
    error: "We couldn't delete the draft. Please try again in a moment.",
  }));

  try {
    await harness.click(harness.getDraftTrigger("plain-draft"));
    await harness.click(harness.getDialogButton("Delete draft"));

    assert.equal(harness.count(), "1");
    assert.equal(
      harness.dom.window.document.querySelector("[role=alert]")?.textContent,
      "We couldn't delete the draft. Please try again in a moment.",
    );
  } finally {
    await harness.teardown();
  }
});
