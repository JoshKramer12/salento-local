import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

const migrationPath = "prisma/migrations/20260914120000_add_business_membership/migration.sql";
const migrationSql = readFileSync(migrationPath, "utf8");

// This is the production-relevant pre-membership shape: existing commissions
// retain a live FK to Payment, which must survive an additive migration.
const productionShapedSetupSql = `
PRAGMA foreign_keys=ON;
CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Business" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "BusinessSubmission" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "PartnerPayout" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessSubmissionId" TEXT NOT NULL,
  "businessId" TEXT,
  "userId" TEXT NOT NULL,
  "partnerUserId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'eur',
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "stripeLastEventId" TEXT,
  "bankTransferReference" TEXT,
  "paidAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Payment_businessSubmissionId_fkey" FOREIGN KEY ("businessSubmissionId") REFERENCES "BusinessSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payment_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "Payment_stripeLastEventId_key" ON "Payment"("stripeLastEventId");
CREATE INDEX "Payment_businessSubmissionId_createdAt_idx" ON "Payment"("businessSubmissionId", "createdAt");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
CREATE INDEX "Payment_partnerUserId_createdAt_idx" ON "Payment"("partnerUserId", "createdAt");
CREATE INDEX "Payment_status_method_idx" ON "Payment"("status", "method");
CREATE TABLE "PartnerCommission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "paymentId" TEXT,
  "payoutId" TEXT,
  "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL UNIQUE,
  CONSTRAINT "PartnerCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PartnerCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "User" ("id") VALUES ('user-1');
INSERT INTO "Business" ("id") VALUES ('business-1');
INSERT INTO "BusinessSubmission" ("id") VALUES ('submission-1');
INSERT INTO "PartnerPayout" ("id") VALUES ('payout-1');
INSERT INTO "Payment" ("id", "businessSubmissionId", "businessId", "userId", "amountCents", "currency", "method", "status", "stripeCheckoutSessionId", "stripePaymentIntentId", "stripeLastEventId", "bankTransferReference", "paidAt", "createdAt", "updatedAt") VALUES
  ('payment-paid', 'submission-1', 'business-1', 'user-1', 10000, 'eur', 'STRIPE_CHECKOUT', 'PAID', 'cs-paid', 'pi-paid', 'evt-paid', NULL, '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
  ('payment-refunded', 'submission-1', 'business-1', 'user-1', 10000, 'eur', 'BANK_TRANSFER', 'REFUNDED', NULL, 'pi-refunded', 'evt-refunded', 'SL-REFUNDED', '2026-01-03T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
  ('payment-pending', 'submission-1', 'business-1', 'user-1', 10000, 'eur', 'STRIPE_CHECKOUT', 'PENDING_PAYMENT', 'cs-pending', NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
INSERT INTO "PartnerCommission" ("id", "paymentId", "payoutId", "amountCents", "status", "sourceKey") VALUES
  ('commission-paid', 'payment-paid', 'payout-1', 5000, 'PENDING', 'commission:paid'),
  ('commission-refunded', 'payment-refunded', NULL, 1500, 'REVERSED', 'commission:refunded'),
  ('commission-unlinked', NULL, NULL, 5000, 'PENDING', 'commission:unlinked');
`;

function normalize(rows: unknown) {
  return JSON.parse(JSON.stringify(rows, (_, value) => typeof value === "bigint" ? Number(value) : value));
}

test("pending membership migration is additive and preserves production-shaped commission payment links", async () => {
  assert.doesNotMatch(migrationSql, /new_Payment|DROP TABLE "Payment"|ALTER TABLE "new_Payment"/);
  assert.match(migrationSql, /ALTER TABLE "Payment" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'INITIAL_MEMBERSHIP'/);
  assert.match(migrationSql, /ALTER TABLE "Payment" ADD COLUMN "stripeInvoiceId" TEXT/);
  assert.match(migrationSql, /CREATE UNIQUE INDEX "Payment_stripeInvoiceId_key"/);

  const directory = mkdtempSync(join(tmpdir(), "salento-membership-migration-"));
  const databaseUrl = `file:${join(directory, "production-shaped.db")}`;
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const execute = (sql: string) => execFileSync("npx", ["prisma", "db", "execute", "--stdin", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input: sql,
    stdio: "pipe",
  });

  try {
    execute(productionShapedSetupSql);

    const beforePayments = normalize(await db.$queryRawUnsafe(`
      SELECT id, businessSubmissionId, businessId, userId, partnerUserId, amountCents, currency, method, status,
        stripeCheckoutSessionId, stripePaymentIntentId, stripeLastEventId, bankTransferReference, paidAt, createdAt, updatedAt
      FROM Payment ORDER BY id
    `));
    const expectedPayments = [
      { id: "payment-paid", businessSubmissionId: "submission-1", businessId: "business-1", userId: "user-1", partnerUserId: null, amountCents: 10000, currency: "eur", method: "STRIPE_CHECKOUT", status: "PAID", stripeCheckoutSessionId: "cs-paid", stripePaymentIntentId: "pi-paid", stripeLastEventId: "evt-paid", bankTransferReference: null, paidAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "payment-pending", businessSubmissionId: "submission-1", businessId: "business-1", userId: "user-1", partnerUserId: null, amountCents: 10000, currency: "eur", method: "STRIPE_CHECKOUT", status: "PENDING_PAYMENT", stripeCheckoutSessionId: "cs-pending", stripePaymentIntentId: null, stripeLastEventId: null, bankTransferReference: null, paidAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "payment-refunded", businessSubmissionId: "submission-1", businessId: "business-1", userId: "user-1", partnerUserId: null, amountCents: 10000, currency: "eur", method: "BANK_TRANSFER", status: "REFUNDED", stripeCheckoutSessionId: null, stripePaymentIntentId: "pi-refunded", stripeLastEventId: "evt-refunded", bankTransferReference: "SL-REFUNDED", paidAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
    ];
    assert.deepEqual(beforePayments, expectedPayments);

    const beforeCommissions = normalize(await db.$queryRawUnsafe(`SELECT id, paymentId, payoutId, amountCents, status, sourceKey FROM PartnerCommission ORDER BY id`));
    assert.deepEqual(beforeCommissions, [
      { id: "commission-paid", paymentId: "payment-paid", payoutId: "payout-1", amountCents: 5000, status: "PENDING", sourceKey: "commission:paid" },
      { id: "commission-refunded", paymentId: "payment-refunded", payoutId: null, amountCents: 1500, status: "REVERSED", sourceKey: "commission:refunded" },
      { id: "commission-unlinked", paymentId: null, payoutId: null, amountCents: 5000, status: "PENDING", sourceKey: "commission:unlinked" },
    ]);

    execute(migrationSql);

    const afterPayments = normalize(await db.$queryRawUnsafe(`
      SELECT id, businessSubmissionId, businessId, userId, partnerUserId, amountCents, currency, method, status,
        stripeCheckoutSessionId, stripePaymentIntentId, stripeLastEventId, bankTransferReference, paidAt, createdAt, updatedAt
      FROM Payment ORDER BY id
    `));
    const afterCommissions = normalize(await db.$queryRawUnsafe(`SELECT id, paymentId, payoutId, amountCents, status, sourceKey FROM PartnerCommission ORDER BY id`));
    assert.deepEqual(afterPayments, beforePayments);
    assert.deepEqual(afterCommissions, beforeCommissions);

    const paymentColumns = normalize(await db.$queryRawUnsafe(`PRAGMA table_info("Payment")`)).map((column: { name: string }) => column.name);
    assert.ok(paymentColumns.includes("purpose"));
    assert.ok(paymentColumns.includes("stripeInvoiceId"));
    assert.deepEqual(normalize(await db.$queryRawUnsafe(`SELECT id, purpose, stripeInvoiceId FROM Payment ORDER BY id`)), [
      { id: "payment-paid", purpose: "INITIAL_MEMBERSHIP", stripeInvoiceId: null },
      { id: "payment-pending", purpose: "INITIAL_MEMBERSHIP", stripeInvoiceId: null },
      { id: "payment-refunded", purpose: "INITIAL_MEMBERSHIP", stripeInvoiceId: null },
    ]);

    const paymentIndexes = normalize(await db.$queryRawUnsafe(`PRAGMA index_list("Payment")`));
    assert.ok(paymentIndexes.some((index: { name: string; unique: number }) => index.name === "Payment_stripeInvoiceId_key" && index.unique === 1));
    const reminderIndexes = normalize(await db.$queryRawUnsafe(`PRAGMA index_list("MembershipReminder")`));
    assert.ok(reminderIndexes.some((index: { name: string; unique: number }) => index.name === "MembershipReminder_membershipId_cycleEndsAt_type_key" && index.unique === 1));
    const membershipColumns = normalize(await db.$queryRawUnsafe(`PRAGMA table_info("BusinessMembership")`)).map((column: { name: string }) => column.name);
    for (const column of ["businessId", "annualPriceCents", "currentPeriodStart", "currentPeriodEnd", "graceEndsAt", "automaticRenewal", "stripeCustomerId", "stripeSubscriptionId", "stripeSubscriptionStatus", "stripeCancelAtPeriodEnd", "recurringPaymentReady", "entitlementRevokedAt"]) assert.ok(membershipColumns.includes(column));

    const commissionForeignKeys = normalize(await db.$queryRawUnsafe(`PRAGMA foreign_key_list("PartnerCommission")`));
    assert.ok(commissionForeignKeys.some((foreignKey: { table: string; from: string; to: string; on_delete: string }) => foreignKey.table === "Payment" && foreignKey.from === "paymentId" && foreignKey.to === "id" && foreignKey.on_delete === "SET NULL"));
    assert.deepEqual(normalize(await db.$queryRawUnsafe(`PRAGMA foreign_key_check`)), []);
  } finally {
    await db.$disconnect();
    rmSync(directory, { force: true, recursive: true });
  }
});
