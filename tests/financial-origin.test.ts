import assert from "node:assert/strict";
import test from "node:test";
import { hasSameOrigin } from "@/lib/request-security";

test("cookie-authenticated financial mutations reject absent, foreign, and malformed Origin", () => {
  const before = process.env.APP_URL;
  process.env.APP_URL = "https://salentolocal.example.test";
  try {
    const request = (origin?: string) => new Request("https://salentolocal.example.test/api/partner/withdrawals", {
      method: "POST", headers: origin === undefined ? {} : { Origin: origin },
    });
    assert.equal(hasSameOrigin(request()), false);
    assert.equal(hasSameOrigin(request("https://outside.example.test")), false);
    assert.equal(hasSameOrigin(request("not-a-url")), false);
    assert.equal(hasSameOrigin(request("https://salentolocal.example.test")), true);
  } finally {
    if (before === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = before;
  }
});
