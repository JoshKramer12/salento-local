import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldShowPartnerFirstBusinessDashboard } from "@/lib/partner-first-business-dashboard";

test("the first-business dashboard is shown only before any Partner submission, including drafts, exists", () => {
  assert.equal(shouldShowPartnerFirstBusinessDashboard(0), true);
  assert.equal(shouldShowPartnerFirstBusinessDashboard(1), false);
  assert.equal(shouldShowPartnerFirstBusinessDashboard(4), false);
});

test("the first-business dashboard uses the existing publish flow and re-openable four-step guide", () => {
  const dashboard = readFileSync("src/components/account/partner-first-business-dashboard.tsx", "utf8");

  assert.match(dashboard, /href="\/publish"/);
  assert.match(dashboard, /href="\/partner\/onboarding\?guide=1"/);
  assert.match(dashboard, /Ready to earn your first €50\?/);
  assert.match(dashboard, /Pronto a guadagnare i tuoi primi €50\?/);
});
