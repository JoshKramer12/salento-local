import assert from "node:assert/strict";
import test from "node:test";

import { getInitialOnlinePaymentInterface, isNoEmailElementEligible } from "@/lib/no-email-payment";
import { buildPhoneValue, getOwnerPhoneStepError, getOwnerStepError } from "@/lib/publish-owner-phone";
import { normalizePhoneNumber } from "@/lib/validation";

const noEmailOwner = {
  locale: "en" as const,
  ownerEmail: "",
  ownerHasNoEmail: true,
  ownerName: "Test Owner",
  submitterRole: "GETTER",
};

test("Italian country selector and national input produce one canonical phone for Owner and Payment", () => {
  const assembled = buildPhoneValue({ country: "IT", number: "347 123 4567" });
  assert.equal(assembled, "+39 347 123 4567");
  assert.equal(normalizePhoneNumber(assembled), "+393471234567");
  assert.equal(getOwnerStepError({ ...noEmailOwner, ownerPhone: assembled }), "");
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "", submitterRole: "GETTER" }), "ELEMENT");
  assert.equal(isNoEmailElementEligible({
    agreementSignature: "signed",
    amountOwedCents: 10000,
    automaticRenewalAtAcceptance: false,
    businessTermsAcceptedAt: new Date(),
    ownerEmail: "",
    ownerPhone: assembled,
    paymentMethod: "ONLINE",
    paymentStatus: "PENDING_PAYMENT",
    signedAt: new Date(),
    status: "AWAITING_PAYMENT",
    submittingUserRole: "GETTER",
  }), true);
  assert.equal((assembled.match(/\+39/g) ?? []).length, 1);
});

test("the reported placeholder is combined correctly but rejected with a visible field message", () => {
  const assembled = buildPhoneValue({ country: "IT", number: "6324669853" });
  assert.equal(assembled, "+39 6324669853");
  assert.equal(normalizePhoneNumber(assembled), null);
  assert.equal(getOwnerStepError({ ...noEmailOwner, ownerPhone: assembled }),
    "Check the owner or manager's WhatsApp number and country code.");
  assert.equal(getOwnerPhoneStepError({ ...noEmailOwner, ownerPhone: assembled, locale: "it" }),
    "Controlla il numero WhatsApp del titolare o responsabile e il prefisso internazionale.");
  assert.equal(getOwnerPhoneStepError({ ...noEmailOwner, ownerPhone: "" }),
    "Enter the owner or manager's WhatsApp number.");
});

test("email owners keep the existing phone and email behavior", () => {
  const assembled = buildPhoneValue({ country: "IT", number: "3471234567" });
  assert.equal(getOwnerStepError({
    ...noEmailOwner,
    ownerEmail: "owner@example.com",
    ownerHasNoEmail: false,
    ownerPhone: assembled,
  }), "");
  assert.notEqual(getOwnerStepError({
    ...noEmailOwner,
    ownerHasNoEmail: false,
    ownerPhone: assembled,
  }), "");
  assert.equal(getInitialOnlinePaymentInterface({ ownerEmail: "owner@example.com", submitterRole: "GETTER" }), "ELEMENT");
});
