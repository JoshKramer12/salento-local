import assert from "node:assert/strict";
import test from "node:test";

import {
  beginPaymentQrAttempt,
  buildPaymentQrDestination,
  ensurePaymentQrActionResult,
  finishPaymentQrAttempt,
  getPaymentQrOpeningError,
  preparePaymentQrNavigation,
  toPaymentQrSelectionResult,
} from "@/lib/payment-qr-navigation";

test("payment QR preparation preserves the submission id and navigates after the card session is ready", async () => {
  let onlinePreparations = 0;
  let bankTransferPreparations = 0;

  const destination = await preparePaymentQrNavigation({
    method: "ONLINE",
    prepareBankTransfer: async () => {
      bankTransferPreparations += 1;
    },
    prepareOnline: async () => {
      onlinePreparations += 1;
    },
    submissionId: "submission/card & owner",
  });

  assert.equal(onlinePreparations, 1);
  assert.equal(bankTransferPreparations, 0);
  assert.equal(destination, "/publish/payment?submission=submission%2Fcard%20%26%20owner");
});

test("bank-transfer QR preparation preserves the submission id and navigates after instructions are ready", async () => {
  let onlinePreparations = 0;
  let bankTransferPreparations = 0;

  const destination = await preparePaymentQrNavigation({
    method: "BANK_TRANSFER",
    prepareBankTransfer: async () => {
      bankTransferPreparations += 1;
    },
    prepareOnline: async () => {
      onlinePreparations += 1;
    },
    submissionId: "submission-bank-1",
  });

  assert.equal(bankTransferPreparations, 1);
  assert.equal(onlinePreparations, 0);
  assert.equal(destination, "/publish/payment?submission=submission-bank-1");
});

test("a failed QR preparation does not produce a destination and exposes retryable localized copy", async () => {
  await assert.rejects(
    preparePaymentQrNavigation({
      method: "ONLINE",
      prepareBankTransfer: async () => undefined,
      prepareOnline: async () => {
        throw new Error("Stripe unavailable");
      },
      submissionId: "submission-1",
    }),
    /Stripe unavailable/,
  );

  assert.equal(
    getPaymentQrOpeningError("en"),
    "We couldn't open the payment QR. Please try again in a moment.",
  );
  assert.equal(
    getPaymentQrOpeningError("it"),
    "Non siamo riusciti ad aprire il QR di pagamento. Riprova tra un momento.",
  );
});

test("a QR destination cannot be built without the submission identifier", () => {
  assert.throws(() => buildPaymentQrDestination("  "), /submission id/i);
});

test("a repeated click cannot start a duplicate preparation, and a failed attempt permits retry", () => {
  const gate = { current: false };

  assert.equal(beginPaymentQrAttempt(gate), true);
  assert.equal(beginPaymentQrAttempt(gate), false);

  finishPaymentQrAttempt(gate);

  assert.equal(beginPaymentQrAttempt(gate), true);
});

test("payment action results cannot silently omit both destination and error", () => {
  const invalidReasons: string[] = [];
  const result = ensurePaymentQrActionResult({
    locale: "en",
    onInvalidResult: (reason) => invalidReasons.push(reason),
    result: { duplicateMatches: [{ id: "existing-business" }] },
  });

  assert.equal(result.paymentDestination, undefined);
  assert.equal(result.error, getPaymentQrOpeningError("en"));
  assert.deepEqual(invalidReasons, ["ambiguous"]);
});

test("payment action results cannot return a destination and error together", () => {
  const result = ensurePaymentQrActionResult({
    locale: "it",
    result: {
      error: "provider failure",
      paymentDestination: "/publish/payment?submission=invalid",
    },
  });

  assert.equal(result.paymentDestination, undefined);
  assert.equal(result.error, "provider failure");
});

test("the payment-choice action exposes an explicit success or error contract", () => {
  assert.deepEqual(
    toPaymentQrSelectionResult({
      locale: "en",
      result: { paymentDestination: " /publish/payment?submission=card " },
    }),
    { destination: "/publish/payment?submission=card", ok: true },
  );
  assert.deepEqual(
    toPaymentQrSelectionResult({ locale: "it", result: {} }),
    {
      error: "Non siamo riusciti ad aprire il QR di pagamento. Riprova tra un momento.",
      ok: false,
    },
  );
});
