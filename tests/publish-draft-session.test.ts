import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { buildPublishDraftStorageKey, canRestorePublishLocalDraft, replaceNewPublishIntentWithSubmission } from "@/lib/publish-draft-session";
import { resolvePublishNewIntent } from "@/lib/publish-new-intent";

const viewerId = "partner-1";

test("direct Add Business loads get a fresh URL; refresh and specific draft resumes keep their identity", () => {
  const first = resolvePublishNewIntent({ adminMode: false, skipPayoutSetup: false });
  const second = resolvePublishNewIntent({ adminMode: false, skipPayoutSetup: false });
  assert.ok(first.redirectHref);
  assert.ok(second.redirectHref);
  assert.notEqual(first.redirectHref, second.redirectHref);
  const intent = new URL(first.redirectHref, "https://salento.example").searchParams.get("new")!;
  assert.deepEqual(resolvePublishNewIntent({ adminMode: false, requestedNewIntentId: intent, skipPayoutSetup: false }), {
    newIntentId: intent,
    redirectHref: null,
  });
  assert.deepEqual(resolvePublishNewIntent({ adminMode: false, requestedNewIntentId: intent, skipPayoutSetup: false, submissionId: "draft-A" }), {
    newIntentId: null,
    redirectHref: null,
  });
  const admin = resolvePublishNewIntent({ adminMode: true, skipPayoutSetup: true });
  assert.match(admin.redirectHref!, /mode=admin/);
  assert.match(admin.redirectHref!, /skipPayoutSetup=1/);
});

function key(submissionId?: string, newIntentId?: string, role = "GETTER") {
  return buildPublishDraftStorageKey({
    adminMode: false,
    newIntentId,
    role,
    submissionId,
    viewerId,
  });
}

test("a fresh Add Business session starts blank while two saved drafts stay independent", () => {
  const browser = new JSDOM("", { url: "https://salento.example/dashboard" });
  const storage = browser.window.localStorage;
  const intentA = crypto.randomUUID();
  const intentB = crypto.randomUUID();

  assert.equal(storage.getItem(key(undefined, intentA)), null);
  storage.setItem(key(undefined, intentA), JSON.stringify({ businessName: "Business A" }));

  assert.equal(storage.getItem(key(undefined, intentB)), null);
  assert.notEqual(key(undefined, intentA), key(undefined, intentB));
  storage.setItem(key(undefined, intentB), JSON.stringify({ businessName: "Business B" }));

  // A successful autosave moves each form to its own durable submission ID.
  storage.setItem(key("draft-A"), JSON.stringify({ id: "draft-A", businessName: "Business A" }));
  storage.removeItem(key(undefined, intentA));
  storage.setItem(key("draft-B"), JSON.stringify({ id: "draft-B", businessName: "Business B" }));
  storage.removeItem(key(undefined, intentB));

  assert.equal(JSON.parse(storage.getItem(key("draft-A"))!).businessName, "Business A");
  assert.equal(JSON.parse(storage.getItem(key("draft-B"))!).businessName, "Business B");
  assert.equal(storage.getItem(key(undefined, crypto.randomUUID())), null);
  assert.notEqual(key("draft-A"), key("draft-B"));
  browser.window.close();
});

test("refresh and back navigation can restore only the exact new session or authorized draft", () => {
  const intent = crypto.randomUUID();
  const unsaved = { businessName: "Business A", updatedAt: "2026-10-20T12:01:00Z" };
  const savedA = { ...unsaved, id: "draft-A" };

  assert.equal(canRestorePublishLocalDraft(unsaved, { newIntentId: intent }), true);
  assert.equal(canRestorePublishLocalDraft(unsaved, {}), false);
  assert.equal(canRestorePublishLocalDraft(savedA, { newIntentId: intent }), false);
  assert.equal(canRestorePublishLocalDraft(savedA, { submissionId: "draft-A" }), true);
  assert.equal(canRestorePublishLocalDraft(savedA, { submissionId: "draft-B" }), false);
  assert.equal(canRestorePublishLocalDraft(savedA, { submissionId: "draft-A", submissionUpdatedAt: "2026-10-20T12:02:00Z" }), false);
  assert.equal(canRestorePublishLocalDraft(savedA, { submissionId: "draft-A", submissionUpdatedAt: "2026-10-20T12:00:00Z" }), true);
});

test("draft keys stay scoped to the account and publishing mode", () => {
  const partnerDraft = key("draft-A");
  assert.notEqual(partnerDraft, buildPublishDraftStorageKey({ adminMode: false, role: "GETTER", submissionId: "draft-A", viewerId: "partner-2" }));
  assert.notEqual(partnerDraft, buildPublishDraftStorageKey({ adminMode: true, role: "GETTER", submissionId: "draft-A", viewerId }));
});

test("first save makes refresh and Back resume that draft; a stale save cannot change a newer form URL", () => {
  const intentA = crypto.randomUUID();
  const intentB = crypto.randomUUID();
  const browser = new JSDOM("", { url: `https://salento.example/publish?new=${intentA}` });

  assert.equal(replaceNewPublishIntentWithSubmission(browser.window.history, browser.window.location.href, intentA, "draft-A"), true);
  assert.equal(browser.window.location.search, "?submission=draft-A");
  browser.window.history.pushState(null, "", `/publish?new=${intentB}`);
  assert.equal(replaceNewPublishIntentWithSubmission(browser.window.history, browser.window.location.href, intentA, "draft-A"), false);
  assert.equal(browser.window.location.search, `?new=${intentB}`);
  browser.window.close();
});

test("dashboard Add Business clicks open distinct new sessions in a browser DOM", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "https://salento.example/dashboard" });
  const previous = {
    document: globalThis.document,
    self: globalThis.self,
    window: globalThis.window,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  const paths: string[] = [];
  const router = { push: (path: string) => paths.push(path), replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} };
  Object.assign(globalThis, { document: dom.window.document, self: dom.window, window: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);

  try {
    await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(HardNavigationLink, { href: "/publish" }, "Add Business"))));
    const link = dom.window.document.querySelector("a")!;
    assert.equal(link.getAttribute("href"), "/publish");

    await act(async () => link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
    await act(async () => link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));

    assert.equal(paths.length, 2);
    const first = new URL(paths[0], dom.window.location.origin);
    const second = new URL(paths[1], dom.window.location.origin);
    assert.equal(first.pathname, "/publish");
    assert.ok(first.searchParams.get("new"));
    assert.notEqual(first.searchParams.get("new"), second.searchParams.get("new"));
    assert.equal(first.searchParams.has("submission"), false);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
