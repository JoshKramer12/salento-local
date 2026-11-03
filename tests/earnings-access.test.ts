import assert from "node:assert/strict";
import test from "node:test";
import { earningsAccessForRole } from "@/lib/earnings-access";

test("earnings direct URL role matrix", () => {
  assert.equal(earningsAccessForRole("ADMIN"), "admin");
  assert.equal(earningsAccessForRole("GETTER"), "partner");
  assert.equal(earningsAccessForRole("BUSINESS_OWNER"), "redirect");
  assert.equal(earningsAccessForRole("USER"), "redirect");
});
