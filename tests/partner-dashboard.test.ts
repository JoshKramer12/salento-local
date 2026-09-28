import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/components/account/partner-dashboard.tsx", "utf8");
const dashboardPage = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
const dashboardStyles = readFileSync("src/components/account/partner-dashboard.module.css", "utf8");
const partnerWorkspaceNav = readFileSync("src/components/account/partner-workspace-nav.tsx", "utf8");

test("partner dashboard projects authoritative commission purpose and payout setup data", () => {
  assert.match(dashboardPage, /payment: \{ select: \{ purpose: true, refundRequestedAt: true, refundStatus: true \} \}/);
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

test("recent-business cards keep their image, details, and action in separate responsive flow regions", () => {
  assert.match(dashboard, /<div className=\{styles\.cardContent\}>[\s\S]*?<\/div><div className=\{styles\.cardActions\}>/);
  assert.match(dashboardStyles, /\.businessCard\{display:flex;min-width:0;flex-direction:column;overflow:hidden\}/);
  assert.match(dashboardStyles, /\.photo\{position:relative;width:100%;height:7rem;min-height:7rem;max-height:7rem;flex:0 0 7rem;overflow:hidden\}/);
  assert.match(dashboardStyles, /\.photo img\{position:absolute;inset:0;display:block;width:100%;height:100%;[^}]*object-fit:cover;object-position:center\}/);
  assert.match(dashboardStyles, /\.cardActions\{display:grid;gap:7px;[^}]*padding:0 11px 11px\}/);
  assert.match(dashboardStyles, /\.businessCards\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(dashboardStyles, /@media\(max-width:767px\)\{[\s\S]*?\.businessCards\{grid-template-columns:1fr\}/);
});

test("the Partner mobile navigation remains in page flow below the global header", () => {
  assert.match(partnerWorkspaceNav, /scrollable[\s\S]*sticky=\{false\}/);
});

test("the lower dashboard uses intentional rows and does not render a redundant help card", () => {
  const guideIndex = dashboard.indexOf("<section className={styles.guide}>");
  const summaryIndex = dashboard.indexOf("<section className={styles.businessSummary}>");

  assert.ok(guideIndex > 0 && summaryIndex > guideIndex);
  assert.doesNotMatch(dashboard, /styles\.help|Need more help\?|Hai bisogno di altro aiuto\?/);
  assert.doesNotMatch(dashboardStyles, /\.businessPanel\{grid-row:2 \/ span 2/);
  assert.match(dashboardStyles, /@media\(min-width:901px\)\{\.businessPanel\{grid-column:1;grid-row:2\}\.recentEarnings\{grid-column:2;grid-row:2\}\.guide\{grid-column:1;grid-row:3\}\.businessSummary\{grid-column:2;grid-row:3\}\}/);
  assert.match(dashboardStyles, /@media\(max-width:900px\)\{[\s\S]*?\.businessPanel,[\s\S]*?\.guide\{grid-column:auto;grid-row:auto\}/);
});
