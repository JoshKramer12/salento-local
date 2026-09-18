import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/components/account/partner-dashboard.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");

test("partner dashboard projects authoritative commission purpose and payout setup data", () => {
  assert.match(dashboardPage, /payment: \{ select: \{ purpose: true \} \}/);
  assert.match(dashboardPage, /type: "COMMISSION"/);
  assert.match(dashboardPage, /status: \{ not: "REVERSED" \}/);
  assert.match(dashboard, /purpose === "INITIAL_MEMBERSHIP"/);
  assert.match(dashboard, /sourceKey\.startsWith\("commission:submission:"\)/);
  assert.match(dashboard, /setup\?\.setupState === "ready"/);
  assert.match(dashboard, /Boolean\(setup\.payoutsEnabled\)/);
});

test("partner dashboard keeps the existing financial and workflow destinations", () => {
  for (const destination of ["/publish", "/dashboard/earnings", "/dashboard/businesses", "/partner/payout", "/partner/onboarding\\?guide=1"]) {
    assert.match(dashboard, new RegExp(`href=\\"${destination.replaceAll("/", "\\/")}\\"`));
  }

  assert.match(dashboard, /startPartnerPayoutSetupAction/);
  assert.match(dashboard, /getBusinessPhotoUrls/);
  assert.doesNotMatch(dashboard, /PartnerCommission\.create|prisma\.|stripe\./);
});
