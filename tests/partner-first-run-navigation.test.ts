import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getNextPartnerFirstRunStep,
  getPartnerFirstRunStep,
  getPreviousPartnerFirstRunStep,
  partnerFirstRunStepCount,
} from "@/lib/partner-first-run-navigation";

test("the Partner tutorial has a bounded four-step navigation sequence", () => {
  assert.equal(partnerFirstRunStepCount, 4);
  assert.equal(getPartnerFirstRunStep(-4), 1);
  assert.equal(getPartnerFirstRunStep(8), 4);
  assert.equal(getPreviousPartnerFirstRunStep(1), null);
  assert.equal(getPreviousPartnerFirstRunStep(4), 3);
  assert.equal(getNextPartnerFirstRunStep(1), 2);
  assert.equal(getNextPartnerFirstRunStep(4), null);
});

test("the Partner tutorial includes all four localized screens and retains the existing completion action", () => {
  const onboarding = readFileSync("src/components/account/partner-first-run-onboarding.tsx", "utf8");

  for (const value of [
    "What are business",
    "What to say.",
    "They’re interested.",
    "Per cosa pagano i titolari",
    "Cosa dire.",
    "Sono interessati.",
  ]) {
    assert.match(onboarding, new RegExp(value));
  }

  assert.match(onboarding, /completePartnerFirstRunOnboardingAction/);
  assert.match(onboarding, /isGuide \? <a className=\{styles\.next\} href="\/dashboard"/);
  assert.match(onboarding, /aria-current=\{step === screen \? "step" : undefined\}/);
});

test("completed Partners can reopen the tutorial without re-entering the completion path", () => {
  const page = readFileSync("src/app/(account)/partner/onboarding/page.tsx", "utf8");
  const dashboard = readFileSync("src/components/account/partner-dashboard.tsx", "utf8");

  assert.match(page, /isGuide = params\.guide === "1"/);
  assert.match(page, /isGuide && nextRoute === "\/dashboard"/);
  assert.match(dashboard, /href="\/partner\/onboarding\?guide=1"/);
});
