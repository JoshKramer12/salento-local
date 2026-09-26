import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isBlockingDuplicateBusinessMatch } from "@/lib/duplicate-business-matching";
import { duplicateResponseMatchesSubmittedValues } from "@/lib/publish-flow";

const submittedIdentity = {
  address: "Via Vittorio Bachelet 23",
  businessName: "Bobs Burgers",
  phone: "+39 1234567898",
};

test("duplicate responses are compared with the submitted street line", () => {
  assert.equal(duplicateResponseMatchesSubmittedValues(submittedIdentity, submittedIdentity), true);
  assert.equal(duplicateResponseMatchesSubmittedValues(submittedIdentity, {
    ...submittedIdentity,
    address: "Via Vittorio Bachelet, 23, 73100 Lecce LE, Italy",
  }), false);

  const source = readFileSync("src/components/account/publish-form.tsx", "utf8");
  assert.match(source, /duplicateResponseMatchesSubmittedValues\(nextSubmission, \{\s*address,\s*businessName,\s*phone: businessPhone,/);
});

test("automatic matching blocks the same business without blocking a neighbor at one address", () => {
  assert.equal(isBlockingDuplicateBusinessMatch({ submittedName: "Bobs Burgers", candidateName: "Bob's Burgers", matchReasons: ["name", "address"] }), true);
  assert.equal(isBlockingDuplicateBusinessMatch({ submittedName: "Panificio San Lucca", candidateName: "Panificio San Luca", matchReasons: ["name", "phone"] }), true);
  assert.equal(isBlockingDuplicateBusinessMatch({ submittedName: "Trattoria Rosa", candidateName: "Officina Greco", matchReasons: ["address"] }), false);
  assert.equal(isBlockingDuplicateBusinessMatch({ submittedName: "Bar", candidateName: "Bar", matchReasons: ["address", "phone"] }), true);
  assert.equal(isBlockingDuplicateBusinessMatch({ submittedName: "Trattoria Rosa", candidateName: "Trattoria Ross", matchReasons: ["name"] }), false);
});

test("initial payment always rechecks duplicates and has no client decision override", () => {
  const action = readFileSync("src/app/(account)/actions.ts", "utf8");
  const form = readFileSync("src/components/account/publish-form.tsx", "utf8");
  const paymentRoute = readFileSync("src/app/api/publish/payment-choice/route.ts", "utf8");

  assert.match(action, /if \(intent === "submit"\) \{\s*const duplicateMatches = await findPotentialDuplicateBusinesses/);
  assert.doesNotMatch(action, /getStringValue\(formData\.get\("duplicateDecision"\)\)/);
  assert.doesNotMatch(form, /name="duplicateDecision"|setDuplicateDecision|duplicate-wizard-footer__decisions/);
  assert.match(form, /\? "duplicate-blocked"\s*: getPostDuplicateCheckStep\(\)/);
  assert.match(paymentRoute, /openBusinessSubmissionPaymentAction\(formData\)/);
});

test("the old owner choice route redirects to publishing while public claim remains available", () => {
  const onboarding = readFileSync("src/app/(account)/onboarding/business/page.tsx", "utf8");
  const businessPage = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");

  assert.match(onboarding, /redirect\("\/publish"\)/);
  assert.doesNotMatch(onboarding, /href="\/claim"|href="\/publish"/);
  assert.match(businessPage, /`\/claim\?business=/);
});
