import assert from "node:assert/strict";
import test from "node:test";

import { loginAction } from "@/app/(account)/auth-actions";

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
