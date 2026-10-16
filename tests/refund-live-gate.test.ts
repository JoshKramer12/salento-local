import assert from "node:assert/strict";
import test from "node:test";

import { canRequestOwnerRefunds } from "@/lib/stripe";

test("owner refunds remain closed in live mode without a separate switch and matching keys", () => {
  const keys = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "LIVE_OWNER_REFUNDS_ENABLED"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.STRIPE_SECRET_KEY = "sk_live_synthetic";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_synthetic";
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.LIVE_OWNER_REFUNDS_ENABLED;
    assert.equal(canRequestOwnerRefunds(), false);
    process.env.LIVE_OWNER_REFUNDS_ENABLED = "true";
    assert.equal(canRequestOwnerRefunds(), true);
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic";
    assert.equal(canRequestOwnerRefunds(), false);
    process.env.STRIPE_SECRET_KEY = "sk_test_synthetic";
    assert.equal(canRequestOwnerRefunds(), true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
