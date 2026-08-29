import assert from "node:assert/strict";
import test from "node:test";

import { isPayoutMethod, isValidItalianIban, normalizeIban } from "@/lib/partner-payout-methods";

test("only supported partner payout methods can be selected", () => {
  assert.equal(isPayoutMethod("PAYPAL"), true);
  assert.equal(isPayoutMethod("POSTEPAY"), true);
  assert.equal(isPayoutMethod("HYPE"), true);
  assert.equal(isPayoutMethod("CASH"), false);
});

test("IBAN setup accepts a valid Italian IBAN and rejects malformed destinations", () => {
  assert.equal(normalizeIban("it60 x054 2811 1010 0000 0123 456"), "IT60X0542811101000000123456");
  assert.equal(isValidItalianIban("IT60X0542811101000000123456"), true);
  assert.equal(isValidItalianIban("IT00X0542811101000000123456"), false);
  assert.equal(isValidItalianIban("DE89370400440532013000"), false);
});
