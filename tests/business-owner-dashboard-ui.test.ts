import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/components/account/business-owner-dashboard-client.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");

test("owner dashboard uses a responsive one/two/three-column business-card grid", () => {
  assert.match(dashboard, /businesses\.length === 1\s*\? "grid-cols-1"/);
  assert.match(dashboard, /businesses\.length === 2 \? "grid-cols-1 md:grid-cols-2"/);
  assert.match(dashboard, /"grid-cols-1 md:grid-cols-2 xl:grid-cols-3"/);
  assert.match(dashboard, /business-card-grid grid gap-4 \$\{cardGridColumns\}/);
  assert.match(dashboard, /businesses\.map\(\(business\) => <BusinessCard/);
  assert.match(dashboard, /membership-business-selector flex gap-3 overflow-x-auto/);
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
  assert.match(dashboard, /state === "EXPIRED" \? c\.reactivate : c\.renew/);
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
