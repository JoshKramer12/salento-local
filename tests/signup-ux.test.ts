import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPasswordMatchFeedback } from "@/lib/password-match-feedback";
import { localPartnerOnboardingSchema } from "@/lib/validation";

test("password-match feedback is quiet until confirmation starts, then updates live", () => {
  assert.deepEqual(getPasswordMatchFeedback("ValidPassword1!", "", "en"), {
    message: "",
    state: "none",
  });
  assert.deepEqual(getPasswordMatchFeedback("ValidPassword1!", "other", "en"), {
    message: "Passwords don't match",
    state: "mismatch",
  });
  assert.deepEqual(getPasswordMatchFeedback("ValidPassword1!", "ValidPassword1!", "en"), {
    message: "Passwords match",
    state: "match",
  });
  assert.deepEqual(getPasswordMatchFeedback("ChangedPassword1!", "ValidPassword1!", "it"), {
    message: "Le password non coincidono",
    state: "mismatch",
  });
});

test("Partner manual hometown accepts a clean non-Salento hometown and keeps normal town validation", () => {
  const shared = {
    birthDate: "2000-08-31",
    heardAbout: "friend-family",
    phone: "+39 333 1234567",
    whatsapp: "+39 333 1234567",
  };

  assert.equal(
    localPartnerOnboardingSchema.safeParse({ ...shared, baseTownOrArea: "Lecce" }).success,
    true,
  );
  const manual = localPartnerOnboardingSchema.safeParse({
    ...shared,
    baseTownOrArea: "",
    manualHometown: "Toronto",
    notFromSalento: true,
  });
  assert.equal(manual.success, true);
  if (manual.success) {
    assert.equal(manual.data.manualHometown, "Toronto");
  }
  assert.equal(
    localPartnerOnboardingSchema.safeParse({
      ...shared,
      baseTownOrArea: "",
      manualHometown: "",
      notFromSalento: true,
    }).success,
    false,
  );
});

test("the shared entry form and details form keep partner-only controls scoped correctly", () => {
  const entryForm = readFileSync("src/components/account/partner-entry-signup-form.tsx", "utf8");
  const detailsForm = readFileSync("src/components/account/local-partner-onboarding-form.tsx", "utf8");
  const actions = readFileSync("src/app/(account)/auth-actions.ts", "utf8");
  const businessDetailsPage = readFileSync(
    "src/app/(account)/signup/business/details/page.tsx",
    "utf8",
  );

  assert.match(entryForm, /getPasswordMatchFeedback/);
  assert.match(entryForm, /aria-live="polite"/);
  assert.match(entryForm, /audience === "owner"/);
  assert.match(entryForm, /beginOwnerAccountActivationAction/);
  assert.match(detailsForm, /canUseManualHometown = signupMode && signupAudience === "partner"/);
  assert.match(detailsForm, /name="notFromSalento"/);
  assert.match(detailsForm, /name="manualHometown"/);
  assert.match(businessDetailsPage, /signupAudience="business"/);
  assert.match(actions, /baseTownOrArea: hometownName/);
  assert.ok(
    entryForm.indexOf('name="firstName"') < entryForm.indexOf('name="lastName"') &&
      entryForm.indexOf('name="lastName"') < entryForm.indexOf('name="email"') &&
      entryForm.indexOf('name="email"') < entryForm.indexOf('name="username"') &&
      entryForm.indexOf('name="username"') < entryForm.indexOf('name="password"') &&
      entryForm.indexOf('name="password"') < entryForm.indexOf('name="confirmPassword"'),
  );
});
