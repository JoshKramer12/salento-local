import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/components/account/business-owner-dashboard-client.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");

test("owner dashboard intentionally switches between the one-business showcase and responsive grid cards", () => {
  assert.match(dashboard, /businesses\.length === 1\s*\? "grid-cols-1"/);
  assert.match(dashboard, /businesses\.length === 2 \? "grid-cols-1 md:grid-cols-2"/);
  assert.match(dashboard, /"grid-cols-1 md:grid-cols-2 lg:grid-cols-3"/);
  assert.match(dashboard, /business-card-grid grid gap-4 \$\{cardGridColumns\}/);
  assert.match(dashboard, /businesses\.length === 1\s*\? <SingleBusinessShowcase/);
  assert.match(dashboard, /: businesses\.map\(\(business\) => <BusinessCard/);
  assert.match(dashboard, /function SingleBusinessShowcase/);
  assert.match(dashboard, /single-business-showcase/);
  assert.match(dashboard, /lg:grid-cols-\[minmax\(0,0\.88fr\)_minmax\(0,1\.12fr\)\]/);
  assert.match(dashboard, /membership-business-selector flex gap-3 overflow-x-auto/);
});

test("single-business showcase uses existing gallery and business-specific public and edit links", () => {
  assert.match(dashboard, /const \[mainImage, \.\.\.remainingImages\] = business\.images/);
  assert.match(dashboard, /remainingImages\.length \? <div className="mt-3 flex gap-2 overflow-x-auto/);
  assert.match(dashboard, /business\.shortDescription\.trim\(\) \|\| business\.description\.trim\(\)/);
  assert.match(dashboard, /business\.tags\.map/);
  assert.match(dashboard, /href=\{`\/businesses\/\$\{business\.slug\}\/edit\?step=business`\}/);
  assert.match(dashboard, /href=\{`\/businesses\/\$\{business\.slug\}`\}/);
});

test("business-card layouts collapse safely for mobile without changing membership lifecycle behaviour", () => {
  assert.match(dashboard, /grid-cols-1 md:grid-cols-2 lg:grid-cols-3/);
  assert.match(dashboard, /single-business-showcase min-w-0/);
  assert.match(dashboard, /lg:grid lg:grid-cols-\[/);
  assert.match(dashboard, /grid w-full gap-2 sm:w-auto sm:grid-cols-2/);
  assert.match(dashboard, /if \(!membership\) return "LEGACY"/);
  assert.match(dashboard, /state === "EXPIRED"\s*\? c\.hidden/);
  assert.match(dashboard, /state === "GRACE"\s*\? `\$\{c\.graceEnd\}/);
});

test("showcase data is derived from the existing dashboard query and URL-sanitised server-side", () => {
  for (const field of ["description: true", "phone: true", "tags: { select", "website: true"]) {
    assert.ok(dashboardPage.includes(field), `missing ${field}`);
  }
  const dashboardServer = readFileSync("src/components/account/business-owner-dashboard.tsx", "utf8");
  assert.match(dashboardServer, /normalizeUrlInput\(business\.website\)/);
  assert.match(dashboardServer, /getWebsiteDisplayLabel\(business\.website\)/);
});

test("multi-business membership management is selector-driven and business-scoped", () => {
  assert.match(dashboard, /businesses\.length > 1 \? <div className="membership-business-selector/);
  assert.match(dashboard, /setSelectedId\(business\.id\)/);
  assert.match(dashboard, /selected \? <section className="mt-8"/);
  assert.match(dashboard, /businessId" type="hidden" value=\{business\.id\}/);
  assert.match(dashboard, /dashboard\/payment-history\?business=\$\{encodeURIComponent\(business\.slug\)\}/);
});

test("membership panel retains the existing action paths for every lifecycle", () => {
  for (const action of [
    "startMembershipRenewalAction",
    "startMembershipBankTransferAction",
    "turnOnMembershipAutoRenewAction",
    "AutoRenewCancelControl",
  ]) assert.match(dashboard, new RegExp(action));
  assert.match(dashboard, /healthyAuto \? <AutoRenewCancelControl/);
  assert.match(dashboard, /state === "EXPIRED" \|\| state === "REFUNDED"\) \? c\.reactivate : c\.renew/);
  assert.match(dashboard, /state === "GRACE" \? c\.renewalNeeded/);
});

test("dashboard data includes the authoritative automatic-renewal health inputs", () => {
  for (const field of ["recurringPaymentReady: true", "stripeCustomerId: true", "stripeSubscriptionId: true"]) {
    assert.ok(dashboardPage.includes(field), `missing ${field}`);
  }
});

test("membership copy is available in English and Italian", () => {
  for (const phrase of ["Membership & payment", "Membership e pagamento", "Renew by bank transfer", "Rinnova con bonifico", "Reactivate for €100", "Riattiva per €100"]) {
    assert.ok(dashboard.includes(phrase), `missing ${phrase}`);
  }
});
