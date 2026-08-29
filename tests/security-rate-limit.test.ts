import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecurityRateLimitKey,
  getRequestClientAddress,
} from "@/lib/security-rate-limit";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";

test("security rate-limit keys are stable and do not store raw subjects", () => {
  const params = {
    clientAddress: "203.0.113.8",
    namespace: "credential-login",
    subject: "Owner@Example.com",
  };
  const key = buildSecurityRateLimitKey(params);

  assert.equal(key, buildSecurityRateLimitKey({ ...params, subject: "owner@example.com" }));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes("example"), false);
});

test("client address handling never treats it as an authorization signal", () => {
  assert.equal(
    getRequestClientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })),
    "203.0.113.9",
  );
  assert.equal(getRequestClientAddress(new Headers()), "unknown");
});

test("state-changing API requests reject an explicit foreign origin", () => {
  const originalAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://salento.example";

  try {
    assert.equal(
      hasSameOriginOrNoOrigin(
        new Request("https://salento.example/api/submission-photos", {
          headers: { origin: "https://attacker.example" },
          method: "POST",
        }),
      ),
      false,
    );
    assert.equal(
      hasSameOriginOrNoOrigin(
        new Request("https://salento.example/api/submission-photos", {
          headers: { origin: "https://salento.example" },
          method: "POST",
        }),
      ),
      true,
    );
  } finally {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  }
});
