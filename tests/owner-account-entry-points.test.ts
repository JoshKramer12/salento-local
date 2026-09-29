import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { JSDOM } from "jsdom";

import { AccountMenu } from "@/components/account/account-menu";
import { BusinessOwnerDashboardClient, type DashboardBusiness } from "@/components/account/business-owner-dashboard-client";
import { BusinessHero } from "@/components/business/business-hero";
import { isBusinessAlreadyManaged } from "@/lib/business-claim";
import { addUtcDays, getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import type { Locale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { findInitialRefundForBusiness } from "@/lib/self-service-refunds";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-owner-entry-points-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
const fixture = () => createRefundFixture(prisma, `entry-${++sequence}`);
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} };

async function dashboardBusiness(businessId: string, now = new Date()): Promise<DashboardBusiness> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { membership: true, category: true, town: true, locality: true, images: true, reviews: true, tags: { include: { tag: true } } },
  });
  const refund = await findInitialRefundForBusiness(businessId, now);
  return {
    ...business,
    membership: business.membership ? { ...business.membership, automaticRenewalHealthy: false } : null,
    websiteLabel: null,
    refundState: refund.state,
    refundDeadline: refund.deadline,
    refundMethod: refund.payment?.method ?? null,
    refundAmountCents: refund.payment?.amountCents ?? null,
    refundCurrency: refund.payment?.currency ?? null,
  };
}

function renderDashboard(businesses: DashboardBusiness[], locale: Locale = "en") {
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never },
    createElement(BusinessOwnerDashboardClient, { businesses, firstName: "Owner", locale })));
  return new JSDOM(html).window.document;
}

test("eligible initial card and bank payments show a secondary refund entry with the exact amount, deadline and existing route in EN/IT", async () => {
  for (const method of ["STRIPE_CHECKOUT", "BANK_TRANSFER"] as const) {
    const f = await fixture();
    await prisma.payment.update({ where: { id: f.payment.id }, data: { amountCents: 8750, method } });
    const business = await dashboardBusiness(f.business.id);
    assert.equal(business.refundState, "AVAILABLE");
    for (const locale of ["en", "it"] as const) {
      const document = renderDashboard([business], locale);
      const link = document.querySelector(`a[href="/dashboard/refund/${f.business.id}"]`);
      assert.ok(link);
      assert.match(link.className, /btn-secondary/);
      assert.equal(link.textContent, locale === "en" ? "Cancel membership & request refund" : "Annulla membership e richiedi rimborso");
      const section = link.parentElement!;
      const amount = new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-US", { style: "currency", currency: "EUR" }).format(87.5);
      assert.ok(section.textContent?.includes(amount));
      assert.ok(section.textContent?.includes(String(business.refundDeadline!.getUTCFullYear())));
      assert.match(section.textContent!, locale === "en" ? /14-day refund/ : /Rimborso entro 14 giorni/);
      assert.ok(document.querySelector('a[href^="/dashboard/payment-history"]')!.compareDocumentPosition(link) & 4);
      if (method === "BANK_TRANSFER") assert.match(section.textContent!, locale === "en" ? /support will help/ : /assistenza Salento Local/);
    }
  }
  const refundPage = readFileSync("src/app/(account)/dashboard/refund/[businessId]/page.tsx", "utf8");
  assert.match(refundPage, /refund\.payment\?\.method === "BANK_TRANSFER"[\s\S]*<BankRefundRequest/);
  assert.match(refundPage, /form action=\{confirmInitialRefundAction\}/);
});

test("expired windows, renewals, revoked entitlements, missing membership and completed refunds do not expose a new refund action", async () => {
  for (const condition of ["deadline", "renewal", "revoked", "missing", "refunded"] as const) {
    const f = await fixture();
    let now = new Date();
    if (condition === "deadline") now = addUtcDays(f.payment.paidAt!, 14);
    if (condition === "renewal") await prisma.payment.create({ data: {
      businessId: f.business.id, businessSubmissionId: f.submission.id, userId: f.owner.id, amountCents: 10000,
      purpose: "ANNUAL_RENEWAL", method: "STRIPE_CHECKOUT", status: "PAID", paidAt: addUtcDays(f.payment.paidAt!, 1),
    } });
    if (condition === "revoked" || condition === "refunded") await prisma.businessMembership.update({ where: { businessId: f.business.id }, data: { entitlementRevokedAt: now } });
    if (condition === "missing") await prisma.businessMembership.delete({ where: { businessId: f.business.id } });
    if (condition === "refunded") await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED", refundedAmountCents: 10000, refundStatus: "succeeded", selfServiceRefundedAt: now } });
    const business = await dashboardBusiness(f.business.id, now);
    assert.notEqual(business.refundState, "AVAILABLE", condition);
    assert.equal(renderDashboard([business]).querySelector(`a[href="/dashboard/refund/${f.business.id}"]`), null, condition);
  }
});

test("refunded owned businesses remain on single and multiple business dashboards with inactive copy, saved data and existing reactivation action", async () => {
  const f = await fixture();
  await prisma.businessMembership.update({ where: { businessId: f.business.id }, data: { entitlementRevokedAt: new Date() } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED", refundedAmountCents: 10000, refundStatus: "succeeded", selfServiceRefundedAt: new Date() } });
  const business = await dashboardBusiness(f.business.id);
  business.rating = 4.5;
  business.reviewCount = 3;
  business.reviews = [{ id: "saved-review", authorName: "Visitor", title: "Saved review", body: "Saved review body", createdAt: new Date(), rating: 4.5 }];
  const other = await fixture();
  for (const locale of ["en", "it"] as const) {
    for (const businesses of [[business], [business, await dashboardBusiness(other.business.id)]]) {
      const document = renderDashboard(businesses, locale);
      assert.ok(document.body.textContent?.includes(business.name));
      assert.ok(document.body.textContent?.includes("Saved review body"));
      assert.match(document.body.textContent!, locale === "en" ? /Listing inactive/ : /Scheda inattiva/);
      assert.match(document.body.textContent!, locale === "en" ? /Your membership was refunded/ : /membership è stata rimborsata/);
      assert.match(document.body.textContent!, locale === "en" ? /Your business information is still saved/ : /informazioni della tua attività sono ancora salvate/);
      assert.equal(document.querySelector(`a[href="/businesses/${business.slug}"]`), null);
      assert.equal(document.querySelector(`a[href="/businesses/${business.slug}#reviews"]`), null);
      const action = [...document.querySelectorAll("form")].find((form) => form.querySelector(`input[name="businessId"][value="${business.id}"]`) && /Reactivate|Riattiva/.test(form.textContent!));
      assert.ok(action);
      assert.ok(document.querySelector(`a[href="/businesses/${business.slug}/edit?step=photos"]`));
      assert.ok(document.querySelector('a[href^="/dashboard/payment-history"]'));
    }
  }
  assert.equal(business.images.length, 1);
  assert.equal(await prisma.business.count({ where: { id: f.business.id, ownerUserId: f.owner.id } }), 1);
  assert.equal(await prisma.business.findFirst({ where: { id: f.business.id, ...getPublicBusinessMembershipWhere() } }), null);
  const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
  assert.match(dashboardPage, /ownerUserId: viewer\.id/);
  assert.match(dashboardPage, /ownerAccesses: \{ some: \{ userId: viewer\.id \} \}/);
  assert.match(dashboardPage, /refundAmountCents: refund\.payment\?\.amountCents/);
  assert.match(readFileSync("src/components/account/business-owner-dashboard-client.tsx", "utf8"), /form action=\{startMembershipRenewalAction\}/);
});

test("a historical refund cannot mark a repurchased active membership inactive", async () => {
  const f = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED", selfServiceRefundedAt: new Date() } });
  const document = renderDashboard([await dashboardBusiness(f.business.id)]);
  assert.doesNotMatch(document.body.textContent!, /Listing inactive|Your membership was refunded/);
  assert.ok(document.querySelector(`a[href="/businesses/${f.business.slug}"]`));
});

test("public Claim listing uses ownership, including historical and no-email access, independently of refunded membership", () => {
  for (const ownership of [
    { ownerUserId: null, ownerAccessUserIds: [], managed: false },
    { ownerUserId: "historical-owner", ownerAccessUserIds: [], managed: true },
    { ownerUserId: null, ownerAccessUserIds: ["phone-owner"], managed: true },
    { ownerUserId: "refunded-owner", ownerAccessUserIds: ["refunded-owner"], managed: true },
  ]) {
    assert.equal(isBusinessAlreadyManaged(ownership), ownership.managed);
    for (const locale of ["en", "it"] as const) {
      const claimHref = isBusinessAlreadyManaged(ownership) ? null : "/claim?business=unclaimed-lecce";
      const document = new JSDOM(renderToStaticMarkup(createElement(BusinessHero, {
        address: "Lecce", addressHref: "https://maps.google.com", businessName: "Test Business",
        categoryLabel: "Restaurants", claimHref, imageAlt: "Test", images: [{ id: "test", alt: "Test", src: "/images/placeholders/business.svg" }], localityLabel: "Lecce", townHref: "/towns/lecce", locale,
      }))).window.document;
      const link = document.querySelector('a[href="/claim?business=unclaimed-lecce"]');
      assert.equal(Boolean(link), !ownership.managed);
      if (link) { assert.match(link.className, /btn-secondary/); assert.equal(link.textContent, locale === "en" ? "Claim listing" : "Rivendica attività"); }
    }
  }
  const page = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");
  assert.match(page, /getPublicBusinessMembershipWhere\(\)/);
  assert.match(page, /const claimHref = isBusinessAlreadyManaged/);
  assert.match(page, /claimHref=\{claimHref\}/);
});

test("desktop Owner and Partner avatar menus expose localized Support and workspace headers do not; mobile drawer retains Support", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  const previous = { self: globalThis.self, window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globalThis, { self: dom.window, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    for (const role of ["BUSINESS_OWNER", "GETTER"] as const) {
      for (const locale of ["en", "it"] as const) {
        await act(async () => root.render(createElement(AppRouterContext.Provider, { value: router as never },
          createElement(AccountMenu, { key: `${role}-${locale}`, locale, user: { username: "Owner", profileCompleted: true, role } }))));
        assert.equal(dom.window.document.querySelector('a[href="/dashboard/support"]'), null);
        await act(async () => dom.window.document.querySelector("button")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
        assert.equal(dom.window.document.querySelector('a[href="/dashboard/support"]')?.textContent, locale === "en" ? "Support" : "Assistenza");
      }
    }
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, previous);
    dom.window.close();
  }
  for (const path of ["src/components/account/business-owner-account-nav.tsx", "src/components/account/partner-workspace-nav.tsx"]) {
    const nav = readFileSync(path, "utf8");
    assert.doesNotMatch(nav, /\/dashboard\/support|py-3 text-right/);
  }
  assert.match(readFileSync("src/components/mobile-navigation-drawer.tsx", "utf8"), /DrawerLink href="\/dashboard\/support"/);
});
