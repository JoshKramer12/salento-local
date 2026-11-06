import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/components/account/partner-dashboard.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
const dashboardStyles = readFileSync("src/components/account/partner-dashboard.module.css", "utf8");
const partnerWorkspaceNav = readFileSync("src/components/account/partner-workspace-nav.tsx", "utf8");

test("dashboard uses authoritative financial data and excludes unverified activity", () => {
  assert.match(dashboardPage, /payableCommissionWhere\(dashboardNow\)/);
  assert.match(dashboardPage, /getPartnerBalanceSummary\(viewer.id\)/);
  assert.match(dashboard, /getPartnerCommissionDisplay\(entry, commissionLedger, payableIds, locale\)/);
  assert.match(dashboard, /getPartnerInitialHoldProgress\(entry, currentDate, holdDays\)/);
  assert.match(dashboard, /balances\.testActivity/);
  assert.match(dashboard, /balances\.unverifiedActivity/);
  assert.match(dashboard, /balances\.debt/);
  assert.match(dashboard, /formatCurrencyFromCents\(0, locale\)/);
  assert.match(dashboard, /className=\{styles\.cashout\} disabled/);
  assert.match(dashboard, /payoutsPaused \? t\.paused : t\.cashoutUnavailable/);
  assert.match(dashboard, /payableIds\.has\(entry\.id\) && payoutsPaused \? t\.pausedStatus/);
  assert.match(dashboard, /payableIds\.has\(entry\.id\) && balances\.debt > 0 \? t\.debtStatus/);
  assert.doesNotMatch(dashboard, /€685|stripe\.|prisma\.|submitCashoutRequest/);
});

test("attention and portfolio reuse the My Submissions grouping and existing routes", () => {
  assert.match(dashboard, /isAwaitingPartnerPayment/);
  assert.match(dashboard, /isDraftLikeSubmission/);
  assert.match(dashboard, /isPublished\(entry, currentDate\)/);
  assert.match(dashboardPage, /submissions=\{submissions\}/);
  assert.match(dashboardPage, /payLaterInvitation: \{ select: \{ revokedAt: true, declinedAt: true, completedAt: true \} \}/);
  for (const destination of ["/publish", "/dashboard/earnings", "/dashboard/businesses", "/partner/onboarding\\?guide=1"]) {
    assert.match(dashboard, new RegExp(`href=\\"${destination.replaceAll("/", "\\/")}\\"`));
  }
  assert.match(dashboard, /startPartnerPayoutSetupAction/);
  assert.match(dashboard, /publish\?submission=/);
});

test("dashboard keeps compact responsive cards and existing mobile navigation", () => {
  assert.match(partnerWorkspaceNav, /scrollable[\s\S]*sticky=\{false\}/);
  assert.match(dashboardStyles, /\.grid\{display:grid;grid-template-columns:/);
  assert.match(dashboardStyles, /@media\(max-width:767px\)/);
  assert.match(dashboardStyles, /\.businessStats\{display:grid/);
  assert.doesNotMatch(dashboardStyles, /background:linear-gradient\(125deg,#005748/);
});
