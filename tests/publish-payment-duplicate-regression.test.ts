import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("new submissions and payment preparation have no similarity gate", () => {
  const action = readFileSync("src/app/(account)/actions.ts", "utf8");
  const form = readFileSync("src/components/account/publish-form.tsx", "utf8");
  const paymentRoute = readFileSync("src/app/api/publish/payment-choice/route.ts", "utf8");
  assert.doesNotMatch(action, /findPotentialDuplicateBusinesses|duplicateMatches|duplicateCheckMessage/);
  assert.doesNotMatch(form, /duplicate-blocked|duplicateReviewSection|checkForExistingBusinesses|intentInputRef.current.value = "check"/);
  assert.match(form, /requestDraftSave\("autosave", false, isPartnerFlow \? "handoff" : "owner-review"\)/);
  assert.match(paymentRoute, /openBusinessSubmissionPaymentAction\(formData\)/);
  // Ownership authorization and validated publication remain server responsibilities.
  assert.match(action, /existingSubmission.userId !== viewer.id/);
  assert.match(action, /businessSubmissionSubmitSchema/);
  assert.match(action, /buildUniqueBusinessSlug/);
});

test("the old owner choice route redirects to publishing while public claim remains available", () => {
  const onboarding = readFileSync("src/app/(account)/onboarding/business/page.tsx", "utf8");
  const businessPage = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");
  assert.match(onboarding, /redirect\("\/publish"\)/);
  assert.doesNotMatch(onboarding, /href="\/claim"|href="\/publish"/);
  assert.match(businessPage, /`\/claim\?business=/);
});
