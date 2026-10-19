import assert from "node:assert/strict";
import test from "node:test";

import { LEGAL_DOCUMENTS, getPartnerTerms, getPrivacyDocument } from "@/lib/legal";
import { getPartnerPublicationContact } from "@/lib/partner-publication-contact";

const partner = {
  email: " Mario@Example.com ",
  role: "GETTER",
  localPartnerProfile: { fullName: "Mario Rossi", phone: "+39 333 123 4567", whatsapp: "+39 320 123 4567" },
  legalAcceptances: [] as Array<{ documentType: string; documentVersion: string }>,
};
const currentAcceptance = { documentType: "PARTNER_TERMS", documentVersion: LEGAL_DOCUMENTS.partnerTerms.version };

test("new Partner terms disclose the contact-sharing rule in English and Italian", () => {
  assert.match(getPartnerTerms("en").join(" "), /registered name, email address, and WhatsApp or phone number/);
  assert.match(getPartnerTerms("it").join(" "), /nome, l'indirizzo email e il numero WhatsApp o di telefono/);
  assert.match(JSON.stringify(getPrivacyDocument("en")), /A Partner's name may be shared with owners of businesses they registered/);
  assert.match(JSON.stringify(getPrivacyDocument("it")), /Il nome del Partner può essere comunicato ai titolari delle attività che ha registrato/);
});

test("an old Partner acceptance never authorizes newly shared contact details", () => {
  assert.deepEqual(getPartnerPublicationContact({ ...partner, legalAcceptances: [{ documentType: "PARTNER_TERMS", documentVersion: "partner-terms-2026-09-27" }] }), {
    partnerName: "Mario Rossi", partnerEmail: null, partnerPhone: null,
  });
  assert.deepEqual(getPartnerPublicationContact(partner), {
    partnerName: "Mario Rossi", partnerEmail: null, partnerPhone: null,
  });
});

test("only the submission Partner's current acceptance releases registered contacts", () => {
  assert.deepEqual(getPartnerPublicationContact({ ...partner, legalAcceptances: [currentAcceptance] }), {
    partnerName: "Mario Rossi", partnerEmail: "mario@example.com", partnerPhone: "+393201234567",
  });
  assert.deepEqual(getPartnerPublicationContact({ ...partner, role: "BUSINESS_OWNER", legalAcceptances: [currentAcceptance] }), {
    partnerName: null, partnerEmail: null, partnerPhone: null,
  });
});

test("missing or invalid Partner contacts are omitted without inventing replacements", () => {
  assert.deepEqual(getPartnerPublicationContact({ ...partner, email: null, legalAcceptances: [currentAcceptance], localPartnerProfile: { ...partner.localPartnerProfile, whatsapp: "invalid", phone: "invalid" } }), {
    partnerName: "Mario Rossi", partnerEmail: null, partnerPhone: null,
  });
  assert.equal(getPartnerPublicationContact({ ...partner, legalAcceptances: [currentAcceptance], localPartnerProfile: { ...partner.localPartnerProfile, whatsapp: "invalid" } }).partnerPhone, "+393331234567");
});
