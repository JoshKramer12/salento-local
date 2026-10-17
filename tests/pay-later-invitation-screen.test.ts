import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const localRequire = createRequire(import.meta.url);
localRequire.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_target, key) => key === "__esModule" ? false : String(key) }); };

const submissionId = "clabcdefghijklmnopqrst";

async function screen(fetcher: typeof fetch, onFixField: (field: string) => void = () => {}) {
  const { PayLaterPartnerInvitation } = await import("@/components/account/pay-later-partner-invitation");
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const previous = { document: globalThis.document, window: globalThis.window,
    MouseEvent: globalThis.MouseEvent, fetch: globalThis.fetch,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { document: dom.window.document, window: dom.window,
    MouseEvent: dom.window.MouseEvent, fetch: fetcher, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(createElement(PayLaterPartnerInvitation, {
    submissionId, businessName: "Synthetic listing", ownerEmail: "owner@example.test",
    ownerPhone: "+393200000002", locale: "en", onBack() {}, onCorrectEmail() {}, onFixField,
  })));
  return { document: dom.window.document,
    async click(button: HTMLButtonElement) { await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); dom.window.close(); } };
}

function buttonByText(document: Document, label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(label));
  assert.ok(button, `Missing button: ${label}`);
  return button;
}

test("failed invitation status check does not block sending and a double click sends once", async () => {
  let sends = 0;
  const ui = await screen(async (_input, init) => {
    if (init?.method === "POST") { sends++; return Response.json({ email: "accepted" }); }
    return Response.json({ error: "unavailable" }, { status: 503 });
  });
  try {
    const send = buttonByText(ui.document, "Send email link");
    assert.equal(send.disabled, false);
    assert.ok(buttonByText(ui.document, "Retry invitation status check"));
    await act(async () => {
      send.dispatchEvent(new ui.document.defaultView!.MouseEvent("click", { bubbles: true }));
      send.dispatchEvent(new ui.document.defaultView!.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(sends, 1);
    assert.match(ui.document.body.textContent ?? "", /Link sent!/);
  } finally { await ui.close(); }
});

test("a slow status response cannot replace a successful send confirmation", async () => {
  let finishStatus: ((response: Response) => void) | undefined;
  const status = new Promise<Response>((resolve) => { finishStatus = resolve; });
  const ui = await screen(async (_input, init) => init?.method === "POST"
    ? Response.json({ email: "accepted" }) : status);
  try {
    await ui.click(buttonByText(ui.document, "Send email link"));
    assert.match(ui.document.body.textContent ?? "", /Link sent!/);
    await act(async () => { finishStatus?.(Response.json({ email: "idle" })); await status; });
    assert.match(ui.document.body.textContent ?? "", /Link sent!/);
  } finally { await ui.close(); }
});

test("missing saved field has a specific edit action, without a false status-retry prompt", async () => {
  const fixed: string[] = [];
  const ui = await screen(async (_input, init) => init?.method === "POST"
    ? Response.json({ error: "pay_later_missing_fields", invalidFields: ["photoUrls"] }, { status: 409 })
    : Response.json({ email: "idle" }), (field) => fixed.push(field));
  try {
    await ui.click(buttonByText(ui.document, "Send email link"));
    assert.match(ui.document.body.textContent ?? "", /Exterior and interior photos/);
    assert.equal([...ui.document.querySelectorAll("button")].some((button) => button.textContent?.includes("Retry invitation status check")), false);
    await ui.click(buttonByText(ui.document, "Exterior and interior photos"));
    assert.deepEqual(fixed, ["photoUrls"]);
    assert.equal(buttonByText(ui.document, "Send email link").disabled, false);
  } finally { await ui.close(); }
});

test("cooldown reports the server retry time and temporarily blocks another send", async () => {
  let sends = 0;
  const ui = await screen(async (_input, init) => init?.method === "POST"
    ? (sends++, Response.json({ error: "cooldown", retryAfterSeconds: 2 }, { status: 429 }))
    : Response.json({ email: "idle" }));
  try {
    await ui.click(buttonByText(ui.document, "Send email link"));
    assert.equal(sends, 1);
    assert.match(ui.document.body.textContent ?? "", /Try again in 2 seconds/);
    assert.equal(buttonByText(ui.document, "Send email link").disabled, true);
  } finally { await ui.close(); }
});
