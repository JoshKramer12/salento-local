import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  openBusinessSignupHandoff,
  sealBusinessSignupHandoff,
  validateBusinessSignupEntry,
} from "@/lib/business-signup-flow";
import { localPartnerOnboardingSchema } from "@/lib/validation";

const validEntry = {
  businessTermsAccepted: true,
  confirmPassword: "ValidPassword1!",
  email: "business@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  locale: "en" as const,
  password: "ValidPassword1!",
  redirectTo: "/dashboard",
  username: "ada-business",
};

test("Business Page 1 produces only an encrypted pending signup handoff", () => {
  const result = validateBusinessSignupEntry(validEntry);

  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.entry, {
    businessTermsAccepted: true,
    email: "business@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    locale: "en",
    password: "ValidPassword1!",
    redirectTo: "/dashboard",
    username: "ada-business",
  });

  const token = sealBusinessSignupHandoff(result.entry!, "test-business-signup-secret");
  assert.equal(token.includes(validEntry.password), false);
  assert.deepEqual(openBusinessSignupHandoff(token, "test-business-signup-secret"), result.entry);
});

test("Business page-two details keep the existing phone, hometown, birthday, and source validation", () => {
  const validDetails = {
    baseTownOrArea: "Lecce",
    birthDate: "2000-08-31",
    heardAbout: "friend-family",
    phone: "+39 333 1234567",
    whatsapp: "+39 333 1234567",
  };

  assert.equal(localPartnerOnboardingSchema.safeParse(validDetails).success, true);
  assert.equal(
    localPartnerOnboardingSchema.safeParse({ ...validDetails, birthDate: "2010-08-31" }).success,
    false,
  );
  assert.equal(
    localPartnerOnboardingSchema.safeParse({ ...validDetails, phone: "not-a-phone" }).success,
    false,
  );
});

test("Business entry and completion actions preserve the two-page creation boundary", () => {
  const actions = readFileSync("src/app/(account)/auth-actions.ts", "utf8");
  const entryAction = actions.slice(
    actions.indexOf("export async function businessSignupAction"),
    actions.indexOf("export async function completeBusinessSignupAction"),
  );
  const completionAction = actions.slice(actions.indexOf("export async function completeBusinessSignupAction"));

  assert.match(entryAction, /storePendingBusinessSignup/);
  assert.doesNotMatch(entryAction, /prisma\.user\.create|signIn\(/);
  assert.match(completionAction, /prisma\.\$transaction/);
  assert.match(completionAction, /tx\.user\.create/);
  assert.match(completionAction, /signIn\("credentials"/);
});
