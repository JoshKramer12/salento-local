import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  openOwnerAccessSignupHandoff,
  sealOwnerAccessSignupHandoff,
  validateOwnerAccessSignupEntry,
} from "@/lib/owner-access-signup-flow";

const baseEntry = {
  businessTermsAccepted: true,
  confirmPassword: "ValidPassword1!",
  email: "owner@example.com",
  emailRequired: true,
  firstName: "Maria",
  lastName: "De Luca",
  locale: "en" as const,
  password: "ValidPassword1!",
  token: "opaque-owner-token",
  username: "maria-deluca",
};

test("owner page one seals the bound identity without creating an account", () => {
  const result = validateOwnerAccessSignupEntry(baseEntry);
  assert.deepEqual(result.fields, []);
  assert.equal(result.entry?.firstName, "Maria");
  assert.equal(result.entry?.lastName, "De Luca");
  const sealed = sealOwnerAccessSignupHandoff(result.entry!, "owner-handoff-secret");
  assert.equal(sealed.includes(baseEntry.password), false);
  assert.equal(openOwnerAccessSignupHandoff(sealed, "owner-handoff-secret")?.token, baseEntry.token);
});

test("WhatsApp owner links allow an optional email but still require a secure password", () => {
  const result = validateOwnerAccessSignupEntry({ ...baseEntry, email: "", emailRequired: false });
  assert.deepEqual(result.fields, []);
  assert.equal(result.entry?.email, "");
  assert.ok(validateOwnerAccessSignupEntry({ ...baseEntry, password: "weak", confirmPassword: "weak" }).fields.includes("password"));
});

test("only the final owner step creates and activates the attached account", () => {
  const actions = readFileSync("src/app/(account)/owner-access-actions.ts", "utf8");
  const entryAction = actions.slice(
    actions.indexOf("export async function beginOwnerAccountActivationAction"),
    actions.indexOf("export async function completeOwnerAccountFromInvitationAction"),
  );
  const completionAction = actions.slice(actions.indexOf("export async function completeOwnerAccountFromInvitationAction"));
  assert.match(entryAction, /storePendingOwnerAccessSignup/);
  assert.doesNotMatch(entryAction, /tx\.user\.create|markOwnerAccessInvitationUsed|signIn\(/);
  assert.match(completionAction, /tx\.user\.create/);
  assert.match(completionAction, /markOwnerAccessInvitationUsed/);
  assert.match(completionAction, /redirectTo: "\/dashboard"/);
});
