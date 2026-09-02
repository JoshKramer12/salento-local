import assert from "node:assert/strict";
import test from "node:test";

import {
  canManageBusiness,
  ensureOwnerAccessForPublishedSubmission,
  getOwnerAccessInvitationExpiry,
  getOwnerAccessUrl,
} from "@/lib/business-owner-access";

test("a paid Partner submission creates pending owner access using the normalized owner email", async () => {
  const writes: unknown[] = [];
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      create: async (value: { data: unknown }) => ({ id: "access-1", ...value.data }),
      findFirst: async () => null,
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-1",
        id: "submission-1",
        ownerEmail: " Mario@Example.COM ",
        ownerHasNoEmail: false,
      }),
    },
    user: { findUnique: async () => null },
  };

  const access = await ensureOwnerAccessForPublishedSubmission({
    db: db as never,
    submissionId: "submission-1",
  });

  assert.equal(access?.email, "mario@example.com");
  assert.equal(access?.userId, null);
  assert.equal(writes.length, 0);
});

test("an existing account is attached without creating a duplicate user", async () => {
  const writes: unknown[] = [];
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      create: async (value: { data: unknown }) => ({ id: "access-2", ...value.data }),
      findFirst: async () => null,
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-2",
        id: "submission-2",
        ownerEmail: "mario@example.com",
        ownerHasNoEmail: false,
      }),
    },
    user: { findUnique: async () => ({ id: "user-1" }) },
  };

  const access = await ensureOwnerAccessForPublishedSubmission({
    db: db as never,
    submissionId: "submission-2",
  });

  assert.equal(access?.userId, "user-1");
  assert.equal(writes.length, 1);
});

test("no access is created for owners without an email", async () => {
  const db = {
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-3",
        id: "submission-3",
        ownerEmail: "",
        ownerHasNoEmail: true,
      }),
    },
  };
  assert.equal(
    await ensureOwnerAccessForPublishedSubmission({ db: db as never, submissionId: "submission-3" }),
    null,
  );
});

test("business management authorization requires the owner relationship", async () => {
  const allowed = await canManageBusiness({
    businessId: "business-4",
    db: { business: { findFirst: async () => ({ id: "business-4" }) } } as never,
    userId: "owner-1",
  });
  const denied = await canManageBusiness({
    businessId: "business-4",
    db: { business: { findFirst: async () => null } } as never,
    userId: "other-user",
  });
  assert.equal(allowed, true);
  assert.equal(denied, false);
});

test("owner links are opaque, internal, and short lived", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  assert.equal(getOwnerAccessInvitationExpiry(now).getTime() - now.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    getOwnerAccessUrl("secure-token", "https://example.test/"),
    "https://example.test/owner-access/secure-token",
  );
});
