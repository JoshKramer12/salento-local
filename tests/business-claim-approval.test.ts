import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { approveVerifiedBusinessClaim } from "@/lib/business-claim";
import { canManageBusiness } from "@/lib/business-owner-access";

test("claim approval preserves account and public emails while activating verified owner access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "salento-claim-approval-"));
  const databaseUrl = `file:${join(directory, "isolated.db")}`;
  writeFileSync(join(directory, "isolated.db"), "");
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    const town = await db.town.create({ data: {
      slug: "claim-test-lecce", name: "Lecce", province: "LE", shortDescription: "Test town",
      intro: "Test", history: "Test", practicalInfo: "Test", heroImageSeed: "test",
      latitude: 40.35, longitude: 18.17,
    } });
    const category = await db.category.create({ data: {
      slug: "claim-test-restaurants", name: "Restaurants", description: "Test", icon: "restaurant", group: "FOOD",
    } });

    for (const scenario of [
      { key: "different", accountEmail: "Mario@Gmail.test", publicEmail: "Info@Restaurant.test", verificationEmail: "owner@restaurant.test" },
      { key: "matching", accountEmail: "info@restaurant.test", publicEmail: "info@restaurant.test", verificationEmail: "info@restaurant.test" },
      { key: "no-public-email", accountEmail: "mario@other.test", publicEmail: null, verificationEmail: "owner@example.test" },
    ]) {
      const user = await db.user.create({ data: {
        email: scenario.accountEmail, username: `owner-${scenario.key}`, role: "BUSINESS_OWNER", profileCompleted: true,
      } });
      const business = await db.business.create({ data: {
        slug: `claim-${scenario.key}`, name: `Claim ${scenario.key}`, address: "Via Test 1, Lecce",
        shortDescription: "Test business", description: "Test business details", heroImageSeed: "test",
        latitude: 40.35, longitude: 18.17, categoryId: category.id, townId: town.id,
        email: scenario.publicEmail,
      } });
      const claim = await db.businessClaim.create({ data: {
        businessId: business.id, userId: user.id, status: "AWAITING_VERIFICATION",
        claimantName: "Mario", claimantPosition: "OWNER", verificationChannel: "EMAIL",
        businessContactEmail: scenario.verificationEmail,
        verificationSentTo: scenario.verificationEmail,
        verificationCodeHash: "synthetic-hash",
        verificationCodeExpiresAt: new Date(Date.now() + 60_000),
      } });
      const pendingAccess = scenario.key === "different"
        ? await db.businessOwnerAccess.create({ data: {
          businessId: business.id, email: scenario.verificationEmail,
        } })
        : null;

      assert.equal(await db.$transaction((tx) => approveVerifiedBusinessClaim({
        businessId: business.id, claimId: claim.id, tx, userId: user.id,
        verificationEmail: scenario.verificationEmail,
      })), true);

      const [savedUser, savedBusiness, savedClaim, ownerAccess] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: user.id } }),
        db.business.findUniqueOrThrow({ where: { id: business.id } }),
        db.businessClaim.findUniqueOrThrow({ where: { id: claim.id } }),
        db.businessOwnerAccess.findUniqueOrThrow({ where: { businessId_userId: { businessId: business.id, userId: user.id } } }),
      ]);
      assert.equal(savedUser.email, scenario.accountEmail);
      assert.equal(savedBusiness.email, scenario.publicEmail);
      assert.equal(savedBusiness.ownerUserId, user.id);
      assert.equal(savedBusiness.verificationStatus, "OWNER_VERIFIED");
      assert.equal(savedClaim.status, "APPROVED");
      assert.equal(savedClaim.businessContactEmail, scenario.verificationEmail);
      assert.equal(savedClaim.verificationCodeHash, null);
      assert.equal(ownerAccess.email, scenario.verificationEmail);
      assert.equal(ownerAccess.userId, user.id);
      assert.ok(ownerAccess.activatedAt);
      if (pendingAccess) assert.equal(ownerAccess.id, pendingAccess.id);
      assert.equal(await canManageBusiness({ businessId: business.id, db, userId: user.id }), true);

      const conflictingUser = await db.user.create({ data: {
        email: `other-${scenario.key}@example.test`, username: `other-${scenario.key}`, role: "BUSINESS_OWNER",
      } });
      const conflictingClaim = await db.businessClaim.create({ data: {
        businessId: business.id, userId: conflictingUser.id, status: "AWAITING_VERIFICATION",
        claimantName: "Other", claimantPosition: "OWNER", verificationChannel: "EMAIL",
        businessContactEmail: scenario.verificationEmail,
      } });
      assert.equal(await db.$transaction((tx) => approveVerifiedBusinessClaim({
        businessId: business.id, claimId: conflictingClaim.id, tx, userId: conflictingUser.id,
        verificationEmail: scenario.verificationEmail,
      })), false);
      assert.equal((await db.businessClaim.findUniqueOrThrow({ where: { id: conflictingClaim.id } })).status, "REJECTED");
      assert.equal(await canManageBusiness({ businessId: business.id, db, userId: conflictingUser.id }), false);
    }
  } finally {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
