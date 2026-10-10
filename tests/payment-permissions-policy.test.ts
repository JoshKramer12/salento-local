import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config";

test("payment pages permit browser wallet requests while other restricted features stay blocked", async () => {
  assert.ok(nextConfig.headers);
  const rules = await nextConfig.headers();
  const policy = rules.flatMap((rule) => rule.headers)
    .find((header) => header.key.toLowerCase() === "permissions-policy")?.value;

  assert.ok(policy);
  assert.match(policy, /(?:^|,\s*)payment=\*(?:,|$)/);
  for (const feature of ["camera", "geolocation", "microphone"]) {
    assert.match(policy, new RegExp(`(?:^|,\\s*)${feature}=\\(\\)(?:,|$)`));
  }
});
