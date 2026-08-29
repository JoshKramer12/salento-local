import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_VERIFICATION_MAX_RESENDS,
  evaluateClaimCodeAttempt,
  evaluateClaimResend,
  getEnabledVerificationMethods,
  normalizeVerificationPhone,
  resolveClaimVerificationRecipient,
} from "@/lib/business-claim-verification";
import { createVerificationCode, hashVerificationCode } from "@/lib/verification";

test("email verification code generation produces six digits", () => {
  const code = createVerificationCode();

  assert.match(code, /^\d{6}$/);
});

test("email claim verification recipient is normalized", () => {
  const recipient = resolveClaimVerificationRecipient({
    channel: "EMAIL",
    email: "  Owner@Example.COM ",
  });

  assert.equal(recipient, "owner@example.com");
});

test("sms claim verification recipient is normalized to E.164", () => {
  const recipient = resolveClaimVerificationRecipient({
    channel: "SMS",
    phone: "+39 333 123 4567",
  });

  assert.equal(recipient, "+393331234567");
  assert.equal(normalizeVerificationPhone("+39 333 123 4567"), "+393331234567");
});

test("successful verification accepts the right code", () => {
  const code = "482901";
  const status = evaluateClaimCodeAttempt({
    attempts: 0,
    code,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    hash: hashVerificationCode(code),
  });

  assert.equal(status, "valid");
});

test("expired verification code is rejected", () => {
  const code = "482901";
  const status = evaluateClaimCodeAttempt({
    attempts: 0,
    code,
    expiresAt: new Date(Date.now() - 1_000),
    hash: hashVerificationCode(code),
  });

  assert.equal(status, "expired");
});

test("wrong verification code is rejected", () => {
  const status = evaluateClaimCodeAttempt({
    attempts: 0,
    code: "111111",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    hash: hashVerificationCode("222222"),
  });

  assert.equal(status, "invalid");
});

test("resend requests respect cooldown and resend limits", () => {
  const cooldownStatus = evaluateClaimResend({
    resendAvailableAt: new Date(Date.now() + 60_000),
    resendCount: 1,
  });
  const limitStatus = evaluateClaimResend({
    resendAvailableAt: null,
    resendCount: CLAIM_VERIFICATION_MAX_RESENDS,
  });

  assert.equal(cooldownStatus, "cooldown");
  assert.equal(limitStatus, "limit_reached");
});

test("verification methods default to email and sms", () => {
  const methods = getEnabledVerificationMethods({} as NodeJS.ProcessEnv);

  assert.deepEqual(methods, ["EMAIL", "SMS"]);
});
