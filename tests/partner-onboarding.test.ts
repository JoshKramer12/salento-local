import assert from "node:assert/strict";
import test from "node:test";

import {
  getPartnerNextRoute,
  getPartnerPayoutSetupSkipDestination,
} from "@/lib/partner-onboarding";

test("Partner onboarding sends incomplete profiles to their details", () => {
  assert.equal(getPartnerNextRoute(null), "/onboarding/partner");
  assert.equal(
    getPartnerNextRoute({ completedAt: null, partnerOnboardingCompletedAt: null }),
    "/onboarding/partner",
  );
});

test("Partner onboarding is shown only once after profile completion", () => {
  assert.equal(
    getPartnerNextRoute({ completedAt: new Date(), partnerOnboardingCompletedAt: null }),
    "/partner/onboarding",
  );
  assert.equal(
    getPartnerNextRoute({ completedAt: new Date(), partnerOnboardingCompletedAt: new Date() }),
    "/dashboard",
  );
});

test("deferring payout setup resumes the route that opened it", () => {
  assert.equal(getPartnerPayoutSetupSkipDestination("/dashboard"), "/dashboard");
  assert.equal(
    getPartnerPayoutSetupSkipDestination("/publish"),
    "/publish?skipPayoutSetup=1",
  );
  assert.equal(
    getPartnerPayoutSetupSkipDestination("/publish?submission=submission-1"),
    "/publish?submission=submission-1&skipPayoutSetup=1",
  );
});
