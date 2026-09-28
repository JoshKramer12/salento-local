import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { JSDOM } from "jsdom";
import { getRefundDisplayState, refundTone, refundAmount, refundDate } from "@/lib/refund-display";
import { refundCopy } from "@/lib/refund-copy";
import { completedRefundEmail } from "@/lib/refund-email-copy";
import { getPartnerCommissionDisplay, type DashboardCommission } from "@/lib/partner-dashboard-display";
import { InitialRefundExperience, type InitialRefundExperienceProps } from "@/components/account/initial-refund-experience";
import { PartnerRefundContext } from "@/components/account/partner-refund-context";
import { OwnerRefundSummary } from "@/components/account/owner-refund-summary";

const requestDate = new Date("2026-09-28T12:00:00Z");
const payment = { status: "PAID", amountCents: 12345, currency: "eur", method: "STRIPE_CHECKOUT", refundRequestedAt: null, refundStatus: null };
const base: InitialRefundExperienceProps = { businessId: "business-test", businessName: "Caffè di San Giovanni — una lunga denominazione dell’attività per provare il layout", paymentId: "payment-test", amount: "€123.45", state: "AVAILABLE", locale: "en", payment, deadline: new Date("2026-10-12T22:30:00Z"), listingActive: true, ownerEmail: "owner@example.test" };
function render(props: Partial<InitialRefundExperienceProps> = {}) {
  return new JSDOM(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} } as never }, createElement(InitialRefundExperience, { ...base, ...props })))).window.document;
}
function text(props: Partial<InitialRefundExperienceProps> = {}) { return render(props).body.textContent!; }

test("processing needs recorded local/provider evidence; URL errors cannot invent requests", () => {
  assert.equal(getRefundDisplayState({ state: "PROCESSING", payment, attemptFailed: true }), "start_failed");
  assert.equal(getRefundDisplayState({ state: "PROCESSING", payment }), "unavailable");
  assert.equal(getRefundDisplayState({ state: "AVAILABLE", payment }), "eligible");
  assert.match(text({ error: "check" }), /couldn't start.*No refund request was recorded/);
  assert.doesNotMatch(text({ error: "check" }), /Your refund is in progress|request has been received/);
  assert.doesNotMatch(text({ error: "start_failed" }), /What happens next|payment will be refunded/);
  assert.equal(render({ error: "start_failed" }).querySelectorAll('button[type="submit"]').length, 1);
});

test("recorded requests outrank URL errors and completion outranks stale pending labels", () => {
  const requested = { ...payment, refundRequestedAt: requestDate, refundStatus: "pending" };
  assert.equal(getRefundDisplayState({ payment: requested, attemptFailed: true }), "processing");
  assert.equal(getRefundDisplayState({ payment: { ...requested, status: "REFUNDED", refundStatus: "requires_action" } }), "completed");
  assert.equal(getRefundDisplayState({ payment: { ...requested, status: "REFUNDED", refundStatus: "support_closed" } }), "completed");
  assert.equal(getRefundDisplayState({ payment: { ...payment, stripeRefundId: "re_recorded" } }), "processing");
});

test("eligible card confirmation uses exact amount, safe primary action and a destructive submit", () => {
  const d = render();
  assert.equal(d.querySelector("h1")?.textContent, "Cancel membership");
  assert.equal(d.querySelector("h2")?.textContent, "You'll receive a €123.45 refund");
  assert.match(d.querySelector('a[href="/dashboard"]')!.className, /btn-primary/);
  assert.match(d.querySelector('button[type="submit"]')!.className, /refund-destructive/);
  assert.match(d.querySelector('button[type="submit"]')!.textContent!, /Cancel membership & refund €123.45/);
  assert.match(d.body.textContent!, /once the refund is completed/);
  assert.doesNotMatch(d.body.textContent!, /€100/);
});

test("pending and needs-attention never offer a duplicate confirmation or claim returned money", () => {
  for (const status of ["requested", "pending", "requires_action", "failed", "canceled"]) {
    const d = render({ state: "PROCESSING", error: "start_failed", payment: { ...payment, refundRequestedAt: requestDate, refundStatus: status } });
    assert.equal(d.querySelectorAll(".refund-destructive").length, 0);
    assert.equal(d.querySelectorAll('button[type="submit"]').length, 1);
    assert.match(d.body.textContent!, /not been marked as refunded/);
    assert.match(d.body.textContent!, /Still active/);
    assert.match(d.body.textContent!, /checks the existing request.*may finish processing/);
  }
});

test("bank request receives protected eligibility and actual listing state, even after deadline", () => {
  const bank = { ...payment, method: "BANK_TRANSFER", refundRequestedAt: requestDate, refundStatus: "support_required" };
  assert.equal(getRefundDisplayState({ state: "UNAVAILABLE", payment: bank }), "support_pending");
  assert.match(text({ payment: bank, state: "SUPPORT_REQUIRED", deadline: new Date("2026-09-01") }), /eligibility protected.*Listing: Still active.*Refund not yet completed/);
  assert.match(text({ payment: bank, state: "SUPPORT_REQUIRED", listingActive: false }), /Listing: Inactive/);
  assert.doesNotMatch(text({ payment: bank, state: "SUPPORT_REQUIRED", listingActive: false }), /Still active/);
});

test("historical refund progress keeps details without acting on the current purchase", () => {
  const d = render({ canCheck: false, state: "UNAVAILABLE", payment: { ...payment, refundRequestedAt: requestDate, refundStatus: "pending" } });
  assert.equal(d.querySelectorAll('button[type="submit"]').length, 0);
  assert.match(d.body.textContent!, /Your refund is in progress/);
  assert.ok(d.querySelector('a[href="/dashboard/support"]'));
});

test("bank before request validates no-email contact without collecting bank data", () => {
  const d = render({ payment: { ...payment, method: "BANK_TRANSFER" }, ownerEmail: null, locale: "it", error: "email_required" });
  const input = d.querySelector('input[type="email"]')!;
  assert.equal(input.hasAttribute("required"), true);
  assert.equal(input.getAttribute("aria-describedby"), "refund-email-help");
  assert.ok(d.querySelector('[role="alert"]'));
  assert.match(d.body.textContent!, /Non inserire dati bancari/);
  assert.match(d.body.textContent!, /Invia la mia richiesta di rimborso di €123.45/);
});

test("failed bank return stays open; closed request contains no completion or refund action", () => {
  const bank = { ...payment, method: "BANK_TRANSFER", refundRequestedAt: requestDate, refundStatus: "failed" };
  assert.match(text({ payment: bank }), /request is still open.*original refund request remains recorded/);
  const d = render({ payment: { ...bank, refundStatus: "support_closed" }, state: "SUPPORT_CLOSED" });
  assert.match(d.body.textContent!, /Refund request closed.*No refund was completed.*membership remain valid/);
  assert.equal(d.querySelectorAll('button[type="submit"]').length, 0);
  assert.ok(d.querySelector('a[href="/dashboard/support"]'));
});

test("completion shows saved information and no repeat action, respecting a newer active term", () => {
  const refunded = { ...payment, status: "REFUNDED", refundedAt: requestDate, refundedAmountCents: 12345 };
  const d = render({ payment: refunded, listingActive: false });
  assert.equal(d.querySelector("h1")?.textContent, "€123.45 refunded");
  assert.match(d.body.textContent!, /membership has been cancelled.*ListingInactive.*Business informationSaved/);
  assert.equal(d.querySelectorAll('button[type="submit"]').length, 0);
  assert.match(text({ payment: refunded, listingActive: true }), /currently active.*earlier payment/);
  assert.doesNotMatch(text({ payment: refunded, listingActive: true }), /membership has been cancelled|listing is no longer visible/);
});

test("ineligible membership gives support and dashboard exits, with reason only when known", () => {
  const d = render({ state: "UNAVAILABLE", deadline: null });
  assert.equal(d.querySelector("h1")?.textContent, "Refund not available online");
  assert.ok(d.querySelector('a[href="/dashboard"]'));
  assert.ok(d.querySelector('a[href="/dashboard/support"]'));
  assert.equal(d.querySelectorAll('button[type="submit"]').length, 0);
  assert.doesNotMatch(d.body.textContent!, /period.*ended/);
  assert.match(text({ state: "UNAVAILABLE", deadline: new Date("2026-09-01") }), /period.*ended/);
});

test("dashboard retains the closed request's exact business-scoped details link in EN/IT", () => {
  for (const locale of ["en", "it"] as const) {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: {} as never }, createElement(OwnerRefundSummary, { businessId: "business-closed", state: "SUPPORT_CLOSED", payment: { ...payment, method: "BANK_TRANSFER", refundRequestedAt: requestDate, refundStatus: "support_closed" }, deadline: null, listingActive: true, locale })));
    assert.match(html, /href="\/dashboard\/refund\/business-closed"/);
    assert.match(html, new RegExp(refundCopy(locale).closed));
  }
});

test("semantic refund tones differ from a still-PAID underlying payment", () => {
  for (const refundStatus of ["requested", "pending", "requires_action", "failed", "support_required"]) {
    assert.equal(refundTone(getRefundDisplayState({ payment: { ...payment, refundRequestedAt: requestDate, refundStatus } })), "amber");
  }
  assert.equal(refundTone(getRefundDisplayState({ payment: { ...payment, status: "REFUNDED" } })), "red");
  assert.equal(refundTone(getRefundDisplayState({ payment: { ...payment, refundRequestedAt: requestDate, refundStatus: "support_closed" } })), "neutral");
});

const commission: DashboardCommission = { id: "commission-test", sourceKey: "commission:submission:test", type: "COMMISSION", status: "PENDING", amountCents: 4321, payment: { purpose: "INITIAL_MEMBERSHIP", status: "PAID", refundRequestedAt: null, refundStatus: null, paidAt: requestDate, amountCents: 12345, currency: "eur" } };
test("Partner normal period, refund hold, cancellation and closed flow use exact amounts and ledger states", () => {
  for (const locale of ["en", "it"] as const) {
    const c = refundCopy(locale);
    const normal = getPartnerCommissionDisplay(commission, [commission], new Set(), locale, requestDate);
    assert.equal(normal.detail, c.holdPeriod);
    const requested = { ...commission, payment: { ...commission.payment!, refundRequestedAt: requestDate, refundStatus: "pending" } };
    assert.equal(getPartnerCommissionDisplay(requested, [requested], new Set(), locale).detail, c.holdRefund);
    const closed = { ...requested, payment: { ...requested.payment, refundStatus: "support_closed" } };
    const pending = getPartnerCommissionDisplay(closed, [closed], new Set(), locale);
    assert.match(pending.detail, new RegExp(c.closedCommission));
    assert.equal(pending.tone, "yellow");
    assert.equal(getPartnerCommissionDisplay(closed, [closed], new Set([closed.id]), locale).tone, "green");
    const reversed = { ...requested, status: "REVERSED", payment: { ...requested.payment, status: "REFUNDED" as const } };
    const cancelled = getPartnerCommissionDisplay(reversed, [reversed], new Set(), locale);
    assert.equal(cancelled.cancelled, true); assert.equal(cancelled.tone, "red");
    assert.match(cancelled.label, new RegExp(c.commissionCancelled));
    assert.ok(cancelled.detail.includes(refundAmount(locale, 12345)));
    assert.ok(cancelled.label.includes(refundAmount(locale, 4321)));
    assert.doesNotMatch(cancelled.detail, /€50|€100/);
  }
});

test("completion emails describe completion in both languages, conditional ledger and listing truth", () => {
  for (const locale of ["en", "it"] as const) {
    const partner = completedRefundEmail({ kind: "partner", locale, businessName: "Test", amount: "€123.45", commissionAmount: "€43.21", commissionCancelled: true, listingActive: false });
    assert.match(partner.subject, locale === "en" ? /Owner refund completed/ : /Rimborso del titolare completato/);
    assert.match(partner.text, locale === "en" ? /€43.21.*cancelled.*will not be paid/ : /€43.21.*annullata.*non verrà pagata/);
    assert.doesNotMatch(partner.text, /€50/);
    const owner = completedRefundEmail({ kind: "owner", locale, businessName: "Test", amount: "€123.45", commissionCancelled: false, listingActive: true });
    assert.match(owner.text, locale === "en" ? /currently active.*earlier payment/ : /attualmente attiva.*precedente/);
    assert.doesNotMatch(owner.text, /listing is now inactive|scheda è ora inattiva/);
  }
});

test("friendly Rome dates, exact deadlines and copy key parity support EN/IT", () => {
  assert.equal(refundDate("en", "2026-10-12T22:30:00Z"), "13 October 2026");
  assert.match(refundDate("it", "2026-10-12T22:30:00Z", true), /13 ottobre 2026.*00:30/);
  assert.deepEqual(Object.keys(refundCopy("en")), Object.keys(refundCopy("it")));
});


test("Partner Owner refund context separates the request from current listing visibility in EN/IT", () => {
  for (const locale of ["en", "it"] as const) {
    const c = refundCopy(locale);
    const html = renderToStaticMarkup(createElement(PartnerRefundContext, { locale, listingActive: true, payment: { ...payment, refundRequestedAt: requestDate, refundStatus: "pending" } }));
    assert.ok(html.includes(c.requested)); assert.ok(html.includes(c.active));
    const completed = renderToStaticMarkup(createElement(PartnerRefundContext, { locale, listingActive: false, payment: { ...payment, status: "REFUNDED" } }));
    assert.ok(completed.includes(c.refunded)); assert.ok(completed.includes(c.inactive));
  }
});
