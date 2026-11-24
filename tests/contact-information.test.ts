import assert from "node:assert/strict";
import test from "node:test";

import {
  getConfirmedPublicWhatsapp,
  resolvePartnerEmailContact,
  resolvePartnerPhoneContacts,
  resolveSubmissionContactValues,
} from "@/lib/contact-information";

const businessPhone = "+39 347 123 4567";
const businessWhatsapp = "+44 7400 123456";
const ownerPhone = "+33 612 345 678";

function phones(overrides: Partial<Parameters<typeof resolvePartnerPhoneContacts>[0]> = {}) {
  return resolvePartnerPhoneContacts({
    businessPhone,
    businessWhatsappManual: businessWhatsapp,
    businessWhatsappSameAsPhone: false,
    ownerWhatsappChoice: null,
    ownerWhatsappManual: ownerPhone,
    ...overrides,
  });
}

test("business WhatsApp copies the full international phone while selected and restores its manual value", () => {
  assert.equal(phones().businessWhatsapp, businessWhatsapp);
  assert.equal(phones({ businessWhatsappSameAsPhone: true }).businessWhatsapp, businessPhone);
  assert.equal(phones({ businessPhone: "+33 612 345 679", businessWhatsappSameAsPhone: true }).businessWhatsapp, "+33 612 345 679");
  assert.equal(phones({ businessWhatsappSameAsPhone: false }).businessWhatsapp, businessWhatsapp);
  assert.equal(phones({ businessWhatsappManual: "" }).businessWhatsapp, "");
});

test("owner WhatsApp choices use independent values, with no implicit default", () => {
  assert.equal(phones().ownerPhone, "");
  assert.equal(phones({ ownerWhatsappChoice: "business-whatsapp" }).ownerPhone, businessWhatsapp);
  assert.equal(phones({ ownerWhatsappChoice: "business-phone" }).ownerPhone, businessPhone);
  assert.equal(phones({ ownerWhatsappChoice: "different" }).ownerPhone, ownerPhone);
  assert.equal(phones({ ownerWhatsappChoice: "different", businessPhone: "+39 333 222 1111" }).ownerPhone, ownerPhone);
  assert.equal(phones({ ownerWhatsappChoice: "business-phone", businessPhone: "+39 333 222 1111" }).ownerPhone, "+39 333 222 1111");
});

test("equivalent international numbers hide the redundant choice even with different formatting", () => {
  const result = phones({
    businessWhatsappManual: "+393471234567",
    ownerWhatsappChoice: "business-phone",
  });
  assert.equal(result.sameBusinessContactNumber, true);
  assert.equal(result.availableOwnerWhatsappChoice, "business-whatsapp");
  assert.equal(result.ownerPhone, "+393471234567");
  assert.equal(phones({ businessWhatsappManual: businessPhone, ownerWhatsappChoice: "business-whatsapp" }).sameBusinessContactNumber, true);
});

test("blank or removed business WhatsApp never supplies a stale private number", () => {
  const result = phones({ businessWhatsappManual: "", ownerWhatsappChoice: "business-whatsapp" });
  assert.equal(result.hasBusinessWhatsapp, false);
  assert.equal(result.availableOwnerWhatsappChoice, null);
  assert.equal(result.ownerPhone, "");
  assert.equal(phones({ businessWhatsappManual: "", ownerWhatsappChoice: "business-phone" }).ownerPhone, businessPhone);
  assert.equal(phones({ businessWhatsappManual: "", ownerWhatsappChoice: "different" }).ownerPhone, ownerPhone);
});

test("private email choices preserve no-email and a separate manual address", () => {
  const base = {
    businessEmail: " business@example.test ",
    ownerEmailChoice: null,
    ownerEmailManual: "owner@example.test",
    ownerHasNoEmailInput: false,
  } as const;
  assert.deepEqual(resolvePartnerEmailContact({ ...base, ownerEmailChoice: "business-email" }), {
    ownerEmail: "business@example.test", ownerHasNoEmail: false,
  });
  assert.deepEqual(resolvePartnerEmailContact({ ...base, ownerEmailChoice: "different" }), {
    ownerEmail: "owner@example.test", ownerHasNoEmail: false,
  });
  assert.deepEqual(resolvePartnerEmailContact({ ...base, ownerEmailChoice: "none" }), {
    ownerEmail: "", ownerHasNoEmail: true,
  });
  assert.deepEqual(resolvePartnerEmailContact(base), { ownerEmail: "", ownerHasNoEmail: false });
});

test("blank business email keeps editable owner email and the original no-email choice", () => {
  const base = { businessEmail: "", ownerEmailChoice: null, ownerEmailManual: "owner@example.test", ownerHasNoEmailInput: false } as const;
  assert.deepEqual(resolvePartnerEmailContact(base), { ownerEmail: "owner@example.test", ownerHasNoEmail: false });
  assert.deepEqual(resolvePartnerEmailContact({ ...base, ownerHasNoEmailInput: true }), { ownerEmail: "", ownerHasNoEmail: true });
});

test("public and contractual emails remain separate; blank WhatsApp never inherits phone", () => {
  assert.deepEqual(resolveSubmissionContactValues({ businessEmail: "", businessWhatsapp: "", ownerEmail: "private@example.test" }), {
    contractualEmail: "private@example.test", publicEmail: "", publicWhatsapp: "",
  });
  assert.deepEqual(resolveSubmissionContactValues({ businessEmail: "public@example.test", businessWhatsapp, ownerEmail: "private@example.test" }), {
    contractualEmail: "public@example.test", publicEmail: "public@example.test", publicWhatsapp: businessWhatsapp,
  });
  assert.deepEqual(resolveSubmissionContactValues({ businessEmail: "", businessWhatsapp: null, ownerEmail: "" }), {
    contractualEmail: "", publicEmail: "", publicWhatsapp: "",
  });
});

test("legacy phone/WhatsApp equality is withheld from new public WhatsApp links", () => {
  const before = new Date("2026-11-23T00:00:00Z");
  const after = new Date("2026-11-25T00:00:00Z");
  const verifiedFrom = "2026-11-24T00:00:00Z";
  assert.equal(getConfirmedPublicWhatsapp({ businessPhone, businessWhatsapp: businessPhone, createdAt: before, verifiedFrom }), null);
  assert.equal(getConfirmedPublicWhatsapp({ businessPhone, businessWhatsapp: businessPhone, createdAt: after, verifiedFrom }), "+393471234567");
  assert.equal(getConfirmedPublicWhatsapp({ businessPhone, businessWhatsapp, createdAt: before, verifiedFrom }), "+447400123456");
  assert.equal(getConfirmedPublicWhatsapp({ businessPhone, businessWhatsapp: "", createdAt: after, verifiedFrom }), null);
  assert.equal(getConfirmedPublicWhatsapp({ businessPhone, businessWhatsapp: businessPhone, createdAt: after }), null);
});
