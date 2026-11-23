import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { before } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { JSDOM } from "jsdom";

import type { PartnerSubmissions as PartnerSubmissionsType } from "@/components/account/partner-submissions";
import type { PartnerDashboard as PartnerDashboardType } from "@/components/account/partner-dashboard";
import { cashoutPreviewFixture } from "@/lib/partner-cashout-fixtures";

type Submission = Parameters<typeof PartnerSubmissionsType>[0]["submissions"][number];
type Commission = Submission["partnerCommissions"][number];
let PartnerSubmissions: typeof PartnerSubmissionsType;
let PartnerDashboard: typeof PartnerDashboardType;

before(async () => {
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = (module) => { module.exports = { default: new Proxy({}, { get: (_, name) => String(name) }) }; };
  PartnerSubmissions = (await import("@/components/account/partner-submissions")).PartnerSubmissions;
  PartnerDashboard = (await import("@/components/account/partner-dashboard")).PartnerDashboard;
});

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} };
const now = "2026-11-22T12:00:00.000Z";

function commission(submissionId: string, mode: boolean | null, changes: Partial<Commission> = {}): Commission {
  return {
    id: `commission-${submissionId}`,
    amountCents: 5000,
    eligibleAt: new Date("2026-11-20T12:00:00.000Z"),
    payment: { purpose: "INITIAL_MEMBERSHIP", status: "PAID", refundRequestedAt: null, refundStatus: null, stripeLivemode: mode },
    sourceKey: `commission:submission:${submissionId}`,
    status: "PENDING",
    type: "COMMISSION",
    ...changes,
  };
}

function submission(id: string, name: string, commissions: Commission[], changes: Partial<Submission> = {}): Submission {
  return {
    addressPlaceId: "synthetic-place",
    businessName: name,
    category: { name: "Restaurant" },
    createdAt: new Date("2026-11-01T12:00:00.000Z"),
    createdBusiness: { images: [], slug: `synthetic-${id}`, membership: { entitlementRevokedAt: null, graceEndsAt: new Date("2027-11-01T12:00:00.000Z") } },
    id,
    longDescription: "Synthetic listing",
    openingHours: "[]",
    ownerEmail: "",
    ownerHasNoEmail: true,
    ownerName: "Synthetic owner",
    ownerPhone: "",
    paymentMethod: "ONLINE",
    payLaterInvitation: null,
    paymentStatus: "PAID",
    phone: "",
    photoUrls: null,
    status: "PUBLISHED",
    town: { name: "Lecce" },
    updatedAt: new Date("2026-11-01T12:00:00.000Z"),
    partnerCommissions: commissions,
    ...changes,
  };
}

function render(submissions: Submission[], locale: "en" | "it", payableCommissionIds: string[] = []) {
  const markup = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(PartnerSubmissions, { drafts: [], submissions, locale, now, payableCommissionIds })));
  return new JSDOM(markup).window.document;
}

function cardText(document: Document, name: string) {
  const card = [...document.querySelectorAll("article")].find((item) => item.querySelector("h3")?.textContent === name);
  assert.ok(card, `Missing submission card: ${name}`);
  return card.textContent ?? "";
}

test("paid test submissions retain owner payment status but never claim payable earnings in English and Italian", () => {
  const rows = [
    submission("test-a", "wewasd", [commission("test-a", false)]),
    submission("test-b", "dsfds", [commission("test-b", false)]),
  ];
  for (const locale of ["en", "it"] as const) {
    const document = render(rows, locale);
    for (const name of ["wewasd", "dsfds"]) {
      const text = cardText(document, name);
      assert.match(text, locale === "en" ? /€50\.00 · TEST · Not payable/ : /50,00\s*€ · TEST · Non pagabile/);
      assert.match(text, locale === "en" ? /Owner paymentPaid/ : /Pagamento titolarePagato/);
      assert.doesNotMatch(text, locale === "en" ? /€50\.00 (earned|pending)/ : /50,00\s*€ (guadagnati|in attesa)/);
    }
    assert.match(document.body.textContent ?? "", locale === "en" ? /Commission status/ : /Stato commissione/);
  }
});

test("unverified history, live hold, live availability, paid and reversed commissions stay distinct", () => {
  const rows = [
    submission("unknown", "Unknown history", [commission("unknown", null)]),
    submission("hold", "Live hold", [commission("hold", true, { eligibleAt: new Date("2026-12-01T12:00:00.000Z") })]),
    submission("available", "Live available", [commission("available", true)]),
    submission("paid", "Live paid", [commission("paid", true, { status: "PAID" })]),
    submission("reversed", "Reversed", [commission("reversed", true, { status: "REVERSED" })]),
    submission("unpaid", "No payment", [], { paymentStatus: "PENDING_PAYMENT", status: "AWAITING_PAYMENT", createdBusiness: null }),
  ];
  const document = render(rows, "en", ["commission-available"]);
  assert.match(cardText(document, "Unknown history"), /€50\.00 · Historical\/unverified · Not payable/);
  assert.match(cardText(document, "Live hold"), /€50\.00 · Pending/);
  assert.match(cardText(document, "Live available"), /€50\.00 · Available/);
  assert.match(cardText(document, "Live paid"), /€50\.00 · Paid/);
  assert.match(cardText(document, "Reversed"), /€50\.00 · Commission cancelled/);
  assert.match(cardText(document, "No payment"), /Commission status—/);
  const italian = render(rows, "it", ["commission-available"]);
  assert.match(cardText(italian, "Unknown history"), /Storico\/non verificato · Non pagabile/);
  assert.match(cardText(italian, "Live available"), /Disponibile/);
});

test("empty live activity explains historical test commissions without adding them to the balance", () => {
  for (const locale of ["en", "it"] as const) {
    const view = { ...cashoutPreviewFixture("zero"), testCents: 10000, unverifiedCents: 0,
      destinationReady: false, requestEnabled: false, disbursementsAllowed: false };
    const markup = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(PartnerDashboard, { now, cashoutView: view, commissionLedger: [], holdDays: 14, locale,
        recentTransactions: [], setup: null, submissions: [], totals: { drafts: 0 }, username: "Partner" })));
    const document = new JSDOM(markup).window.document;
    const text = document.body.textContent ?? "";
    assert.match(text, locale === "en" ? /No verified live commission activity yet/ : /Non ci sono ancora commissioni da pagamenti reali verificati/);
    assert.match(text, locale === "en" ? /No transactions yet/ : /Nessuna transazione per ora/);
    assert.match(text, locale === "en" ? /Available to cash outView earnings€0\.00/ : /Disponibile per il prelievoVedi guadagni[^\n]*0,00/);
  }
});

test("expanded renewal history labels mixed payment modes separately", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://example.test" });
  const previous = { self: globalThis.self, window: globalThis.window, document: globalThis.document,
    MouseEvent: globalThis.MouseEvent, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { self: dom.window, window: dom.window, document: dom.window.document,
    MouseEvent: dom.window.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    const initial = commission("mixed", true);
    const testRenewal = { ...commission("mixed", false), id: "test-renewal", amountCents: 1500,
      sourceKey: "commission:renewal:test", payment: { ...initial.payment!, purpose: "ANNUAL_RENEWAL" as const, stripeLivemode: false } };
    const liveRenewal = { ...commission("mixed", true), id: "live-renewal", amountCents: 1500,
      sourceKey: "commission:renewal:live", payment: { ...initial.payment!, purpose: "ANNUAL_RENEWAL" as const } };
    await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router as never },
      createElement(PartnerSubmissions, { drafts: [], locale: "en", now, payableCommissionIds: ["live-renewal"],
        submissions: [submission("mixed", "Mixed renewals", [initial, testRenewal, liveRenewal])] }))));
    const article = [...dom.window.document.querySelectorAll("article")].find((item) => item.querySelector("h3")?.textContent === "Mixed renewals");
    assert.ok(article);
    const details = [...article.querySelectorAll("button")].find((item) => item.textContent?.includes("Details"));
    assert.ok(details);
    await act(async () => details.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.match(article.textContent ?? "", /Renewal \/ reactivation€15\.00 · TEST · Not payable; €15\.00 · Available/);
  } catch (error) {
    if (error instanceof AggregateError) throw new Error(error.errors.map((item: Error) => item.stack).join("\n"));
    throw error;
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
