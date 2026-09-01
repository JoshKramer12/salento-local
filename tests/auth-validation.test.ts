import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loginAction,
  signupAction,
} from "@/app/(account)/auth-actions";
import { getBirthdayValidationMessage } from "@/lib/signup-validation-messages";
import { createCompletePartnerSignup } from "@/lib/partner-signup-account";
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

function createPartnerSignupFormData(overrides: Record<string, string> = {}) {
  const values = {
    accountType: "GETTER",
    baseTownOrArea: "Lecce",
    birthDate: "2000-08-31",
    email: "partner@example.com",
    firstName: "Ada",
    heardAbout: "friend-family",
    lastName: "Lovelace",
    locale: "en",
    partnerTermsAccepted: "on",
    password: "ValidPassword1!",
    phone: "+39 333 1234567",
    username: "ada-lovelace",
    whatsapp: "+39 333 1234567",
    ...overrides,
  };
  const formData = new FormData();

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  formData.set("confirmPassword", values.password);
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

test("future and nonexistent birthdays are rejected as invalid dates", () => {
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

test("exactly 18 is accepted and under-18 birthdays are rejected", () => {
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
    "You must be at least 18 years old to create an account.",
  );
  assert.equal(
    getBirthdayValidationMessage("it", "invalid_birth_date"),
    "Inserisci una data di nascita valida.",
  );
  assert.equal(
    getBirthdayValidationMessage("it", "underage"),
    "Devi avere almeno 18 anni per creare un account.",
  );
});

test("under-18 Partner signup receives the specific 18+ account-creation error", async () => {
  const result = await signupAction(
    {},
    createPartnerSignupFormData({ birthDate: "2010-08-31" }),
  );

  assert.equal(result.error, "You must be at least 18 years old to create an account.");
  assert.equal(
    result.fieldErrors?.birthDate,
    "You must be at least 18 years old to create an account.",
  );
});

test("Partner signup cannot complete without birthday, phone, or town", async () => {
  const cases = [
    { field: "birthDate", values: { birthDate: "" } },
    { field: "phone", values: { phone: "", whatsapp: "" } },
    { field: "baseTownOrArea", values: { baseTownOrArea: "" } },
  ];

  for (const { field, values } of cases) {
    const result = await signupAction({}, createPartnerSignupFormData(values));

    assert.ok(result.error, field);
    assert.ok(result.fieldErrors?.[field], field);
  }
});

test("an incomplete early Partner signup returns before any account is created", async () => {
  const result = await signupAction(
    {},
    createPartnerSignupFormData({
      baseTownOrArea: "",
      birthDate: "",
      phone: "",
      whatsapp: "",
    }),
  );

  assert.equal(result.error, "Please enter a valid birthday.");
  assert.equal(result.signupValues?.email, "partner@example.com");
  assert.ok(result.fieldErrors?.birthDate);
  assert.ok(result.fieldErrors?.phone);
  assert.ok(result.fieldErrors?.baseTownOrArea);
});

test("a complete valid Partner signup creates its account, profile, and legal acceptance together", async () => {
  let createdProfile: Record<string, unknown> | undefined;
  let createdUser: Record<string, unknown> | undefined;
  const legalAcceptanceUserIds: string[] = [];

  await createCompletePartnerSignup(
    {
      baseTownOrArea: "Lecce",
      birthDate: "2000-08-31",
      email: "partner@example.com",
      firstName: "Ada",
      heardAbout: "friend-family",
      lastName: "Lovelace",
      locale: "en",
      passwordHash: "hashed-password",
      phone: "+39 333 1234567",
      username: "ada-lovelace",
      whatsapp: "+39 333 1234567",
    },
    {
      createProfile: async (data) => {
        createdProfile = data;
      },
      createUser: async (data) => {
        createdUser = data;
        return { id: "partner-user-id" };
      },
      recordLegalAcceptance: async (userId) => {
        legalAcceptanceUserIds.push(userId);
      },
    },
  );

  assert.deepEqual(createdUser, {
    email: "partner@example.com",
    name: "Ada Lovelace",
    passwordHash: "hashed-password",
    profileCompleted: true,
    role: "GETTER",
    username: "ada-lovelace",
  });
  assert.equal(createdProfile?.userId, "partner-user-id");
  assert.equal(createdProfile?.baseTownOrArea, "Lecce");
  assert.equal(createdProfile?.fullName, "Ada Lovelace");
  assert.equal(createdProfile?.birthDate instanceof Date, true);
  assert.deepEqual(legalAcceptanceUserIds, ["partner-user-id"]);
});

test("the Birthday step explains the 18+ requirement in both supported locales", () => {
  const source = readFileSync("src/components/account/partner-signup-form.tsx", "utf8");

  assert.match(source, /You must be 18 or older to join\./);
  assert.match(source, /Devi avere almeno 18 anni per creare un account\./);
});
