import assert from "node:assert/strict";
import test from "node:test";

import { getSafeInternalRedirect } from "@/lib/redirects";

test("safe redirects retain application-relative paths", () => {
  assert.equal(
    getSafeInternalRedirect("/dashboard?tab=profile#contact"),
      "/dashboard?tab=profile#contact",
  );
});

test("unsafe redirects are rejected", () => {
  for (const value of [
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/%5cattacker.example",
    "/%2fattacker.example",
    "/safe\u0000path",
  ]) {
    assert.equal(getSafeInternalRedirect(value), null, value);
  }
});
