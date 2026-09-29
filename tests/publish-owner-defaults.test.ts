import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerContactDefaults, initializeOwnerContact } from "@/lib/publish-owner-defaults";
import { getOwnerStepError } from "@/lib/publish-owner-phone";
const relationship = {
  businessId: "owned-business", email: "owner@example.test", phone: "+393471234567",
  source: { createdBusinessId: "owned-business", ownerName: "Established Owner", ownerEmail: "owner@example.test", ownerPhone: "+393471234567" },
};

test("first and subsequent Owner listings initialize account data without location data", () => {
  const account = { name: "Current Owner", email: "current@example.test", phone: "+14165551234" };
  const expected = { ownerName: account.name, ownerEmail: account.email, ownerPhone: account.phone };
  assert.deepEqual(buildOwnerContactDefaults(account, []), expected);
  assert.deepEqual(buildOwnerContactDefaults(account, [relationship]), expected);
  assert.deepEqual(Object.keys(expected), ["ownerName", "ownerEmail", "ownerPhone"]);
});

test("missing account values use established verified contact and matching source, never a claimed predecessor", () => {
  const empty = { name: null, email: null, phone: null };
  assert.deepEqual(buildOwnerContactDefaults(empty, [relationship]), {
    ownerName: "Established Owner", ownerEmail: "owner@example.test", ownerPhone: "+393471234567",
  });
  const stale = { ...relationship, source: { ...relationship.source, ownerEmail: "previous@example.test", ownerPhone: "+14165559999" } };
  assert.equal(buildOwnerContactDefaults(empty, [stale]).ownerName, "");
  assert.equal(buildOwnerContactDefaults(empty, [{ ...relationship, source: { ...relationship.source, ownerEmail: "predecessor@example.test" } }]).ownerName, "");
  assert.equal(buildOwnerContactDefaults(empty, [relationship, { ...relationship, phone: "+14165559999", source: null }]).ownerPhone, "");
  assert.equal(buildOwnerContactDefaults(empty, [{ ...relationship, source: { ...relationship.source, createdBusinessId: "different-business" } }]).ownerName, "");
  assert.equal(buildOwnerContactDefaults(empty, [relationship, { ...relationship, email: "another@example.test", phone: "+14165559999", source: null }]).ownerEmail, "");
});

test("saved draft edits and no-email choice win over defaults, while only missing values initialize", () => {
  const defaults = { ownerName: "Account", ownerEmail: "account@example.test", ownerPhone: "+14165551234" };
  const draft = { ownerName: "Edited", ownerEmail: "edited@example.test", ownerPhone: "+393471234567", ownerHasNoEmail: false, address: "", phone: "" };
  assert.deepEqual(initializeOwnerContact(draft, defaults), draft);
  assert.deepEqual(initializeOwnerContact({ ...draft, ownerName: "", ownerEmail: "", ownerPhone: "" }, defaults), { ...draft, ...defaults });
  assert.equal(initializeOwnerContact({ ...draft, ownerEmail: "", ownerHasNoEmail: true }, defaults).ownerEmail, "");
  assert.equal(initializeOwnerContact(draft, defaults).phone, "");
  assert.equal(initializeOwnerContact(draft, defaults).address, "");
});

test("Owner and Partner retain identical required-contact validation with contextual EN/IT errors", () => {
  for (const locale of ["en", "it"] as const) {
    const input = { locale, ownerName: "Owner", ownerEmail: "owner@example.test", ownerHasNoEmail: false, ownerPhone: "+393471234567" };
    for (const submitterRole of ["BUSINESS_OWNER", "GETTER"]) assert.equal(getOwnerStepError({ ...input, submitterRole }), "");
    assert.equal(getOwnerStepError({ ...input, ownerPhone: "", submitterRole: "BUSINESS_OWNER" }), locale === "en" ? "Enter your WhatsApp number." : "Inserisci il tuo numero WhatsApp.");
    assert.equal(getOwnerStepError({ ...input, ownerPhone: "", submitterRole: "GETTER" }), locale === "en" ? "Enter the owner or manager's WhatsApp number." : "Inserisci il numero WhatsApp del titolare o responsabile.");
  }
});
