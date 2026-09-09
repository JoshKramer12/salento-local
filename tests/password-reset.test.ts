import assert from "node:assert/strict";
import test from "node:test";

import {
  getPasswordResetExpiry,
  getPasswordResetUrl,
  issuePasswordResetToken,
  resolvePasswordResetToken,
} from "@/lib/password-reset";

test("password reset tokens are opaque, hashed at rest, expire in one hour, and revoke earlier tokens", async () => {
  const writes: Array<{ data: Record<string, unknown>; where?: Record<string, unknown> }> = [];
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      passwordResetToken: {
        create: async (value: { data: Record<string, unknown> }) => writes.push(value),
        updateMany: async (value: { data: Record<string, unknown>; where: Record<string, unknown> }) => writes.push(value),
      },
    }),
  };
  const now = new Date("2026-09-09T12:00:00.000Z");
  const token = await issuePasswordResetToken("user-1", { db: db as never, now });
  const created = writes.find((write) => "tokenHash" in write.data);

  assert.ok(token.length >= 40);
  assert.ok(created);
  assert.notEqual(created!.data.tokenHash, token);
  assert.equal((created!.data.expiresAt as Date).getTime(), getPasswordResetExpiry(now).getTime());
  assert.deepEqual(writes[0]?.where, { userId: "user-1", revokedAt: null, usedAt: null });
});

test("password reset token resolution rejects malformed, expired, used, and revoked tokens", async () => {
  const now = new Date();
  const invalid = await resolvePasswordResetToken("short", {
    passwordResetToken: { findUnique: async () => { throw new Error("should not query"); } },
  } as never);
  assert.equal(invalid, null);

  for (const record of [
    { expiresAt: new Date(now.getTime() - 1), revokedAt: null, usedAt: null },
    { expiresAt: new Date(now.getTime() + 60_000), revokedAt: new Date(), usedAt: null },
    { expiresAt: new Date(now.getTime() + 60_000), revokedAt: null, usedAt: new Date() },
  ]) {
    const resolved = await resolvePasswordResetToken("a".repeat(32), {
      passwordResetToken: { findUnique: async () => ({ ...record, id: "reset-1", user: { email: "owner@example.com", id: "user-1" } }) },
    } as never);
    assert.equal(resolved, null);
  }
});

test("password reset links are absolute and carry only the opaque reset token", () => {
  const url = getPasswordResetUrl("opaque-reset-token");
  assert.match(url, /\/reset-password\/opaque-reset-token$/);
});
