import assert from "node:assert/strict";
import test from "node:test";

import {
  loginAction,
  signupAction,
} from "@/app/(account)/auth-actions";
import { getBirthdayValidationMessage } from "@/lib/signup-validation-messages";
import {
  localPartnerOnboardingSchema,
  signupSchema,
  validateBirthday,
} from "@/lib/validation";

const stableToday = new Date("2026-08-31T12:00:00.000Z");

function createSignupFormData(email: string, locale: "en" | "it" = "en") {
  const formData = new FormData();
  formData.set("accountType", "USER");
  formData.set("email", email);
  formData.set("locale", locale);
  formData.set("password", "ValidPassword1!");
  formData.set("username", "valid-user");
  return formData;
}

test("malformed login emails use the email-specific English error", async () => {
  const formData = new FormData();
  formData.set("identifier", "not-an-email@");
  formData.set("locale", "en");
  formData.set("password", "any-password");

  const result = await loginAction({}, formData);

  assert.equal(result.error, "Please enter a valid email address.");
  assert.equal(result.fieldErrors?.identifier, "Please enter a valid email address.");
});

test("malformed login emails use the email-specific Italian error", async () => {
  const formData = new FormData();
  formData.set("identifier", "not-an-email@");
  formData.set("locale", "it");
  formData.set("password", "any-password");

  const result = await loginAction({}, formData);

  assert.equal(result.error, "Inserisci un indirizzo email valido.");
  assert.equal(result.fieldErrors?.identifier, "Inserisci un indirizzo email valido.");
});

test("malformed signup emails use the email-specific English field error", async () => {
  const result = await signupAction({}, createSignupFormData("not-an-email"));

  assert.equal(result.fieldErrors?.email, "Please enter a valid email address.");
});

test("malformed signup emails use the email-specific Italian field error", async () => {
  const result = await signupAction({}, createSignupFormData("not-an-email", "it"));

  assert.equal(result.fieldErrors?.email, "Inserisci un indirizzo email valido.");
});

test("valid signup emails are accepted by the signup schema", () => {
  assert.equal(
    signupSchema.safeParse({
      email: "hello@example.com",
      password: "ValidPassword1!",
      username: "valid-user",
    }).success,
    true,
  );
});

test("birthday validation accepts real calendar dates and valid leap days", () => {
  for (const birthday of ["1990-04-30", "2004-02-29", "2000-02-29"]) {
    assert.equal(validateBirthday(birthday, stableToday), null, birthday);
  }

  assert.equal(validateBirthday("2024-02-29", stableToday), "underage");
});

test("birthday validation rejects malformed, future, and impossible calendar dates", () => {
  for (const birthday of [
    "",
    "2000-2-29",
    "2026-09-01",
    "2000-13-01",
    "2000-00-01",
    "2000-04-31",
    "2000-06-31",
    "2000-09-31",
    "2000-11-31",
    "2000-02-30",
    "2025-02-29",
    "1900-02-29",
  ]) {
    assert.equal(validateBirthday(birthday, stableToday), "invalid_birth_date", birthday);
  }
});

test("birthday validation enforces the 18+ threshold on the actual birthday", () => {
  assert.equal(validateBirthday("2008-08-31", stableToday), null);
  assert.equal(validateBirthday("2008-09-01", stableToday), "underage");
  assert.equal(validateBirthday("2010-08-31", stableToday), "underage");
});

test("birthday schema returns semantic validation codes for invalid and underage dates", () => {
  const invalidBirthday = localPartnerOnboardingSchema.safeParse({
    baseTownOrArea: "Lecce",
    birthDate: "2025-02-29",
    heardAbout: "friend-family",
    phone: "+39 333 1234567",
    whatsapp: "",
  });
  const underageBirthday = localPartnerOnboardingSchema.safeParse({
    baseTownOrArea: "Lecce",
    birthDate: "2010-08-31",
    heardAbout: "friend-family",
    phone: "+39 333 1234567",
    whatsapp: "",
  });

  assert.equal(invalidBirthday.success, false);
  assert.equal(underageBirthday.success, false);

  if (!invalidBirthday.success) {
    assert.equal(invalidBirthday.error.issues[0]?.message, "invalid_birth_date");
  }

  if (!underageBirthday.success) {
    assert.equal(underageBirthday.error.issues[0]?.message, "underage");
  }
});

test("birthday validation messages distinguish an invalid date from being underage", () => {
  assert.equal(
    getBirthdayValidationMessage("en", "invalid_birth_date"),
    "Please enter a valid birthday.",
  );
  assert.equal(
    getBirthdayValidationMessage("en", "underage"),
    "You must be 18 or older to join Salento Local.",
  );
  assert.equal(
    getBirthdayValidationMessage("it", "invalid_birth_date"),
    "Inserisci una data di nascita valida.",
  );
  assert.equal(
    getBirthdayValidationMessage("it", "underage"),
    "Devi avere almeno 18 anni per unirti a Salento Local.",
  );
});
