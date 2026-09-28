import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync("prisma/migrations/20260927190000_add_self_service_refunds/migration.sql", "utf8");

test("refund migration adds nullable audit fields and preserves existing payments and commissions", () => {
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE "Payment"/);
  const directory = mkdtempSync(join(tmpdir(), "salento-refund-migration-"));
  const path = join(directory, "fixture.db");
  const sql = (command: string) => execFileSync("sqlite3", [path, command], { encoding: "utf8" }).trim();
  try {
    sql(`PRAGMA foreign_keys=ON;
      CREATE TABLE Payment (id TEXT PRIMARY KEY, status TEXT NOT NULL, amountCents INTEGER NOT NULL);
      CREATE TABLE PartnerCommission (id TEXT PRIMARY KEY, paymentId TEXT, status TEXT NOT NULL, FOREIGN KEY (paymentId) REFERENCES Payment(id));
      INSERT INTO Payment VALUES ('payment-1', 'PAID', 10000);
      INSERT INTO PartnerCommission VALUES ('commission-1', 'payment-1', 'PENDING');`);
    execFileSync("sqlite3", [path], { input: migration, encoding: "utf8" });
    assert.equal(sql("SELECT id || ':' || status || ':' || amountCents FROM Payment"), "payment-1:PAID:10000");
    assert.equal(sql("SELECT id || ':' || paymentId || ':' || status FROM PartnerCommission"), "commission-1:payment-1:PENDING");
    const columns = sql("PRAGMA table_info(Payment)");
    for (const name of ["refundRequestedAt", "stripeRefundId", "refundedAmountCents", "refundedAt", "selfServiceRefundedAt", "ownerRefundEmailSentAt", "partnerRefundEmailSentAt"]) assert.ok(columns.includes(name));
    assert.equal(sql("PRAGMA foreign_key_check"), "");
    assert.match(sql("PRAGMA index_list(Payment)"), /Payment_stripeRefundId_key/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("bank support migration is additive and leaves historical financial state unchanged", () => {
  const support = readFileSync("prisma/migrations/20260927230000_add_bank_refund_support/migration.sql", "utf8");
  assert.doesNotMatch(support, /DROP |DELETE |UPDATE |NOT NULL/);
  const directory = mkdtempSync(join(tmpdir(), "salento-bank-migration-"));
  const path = join(directory, "fixture.db");
  const sql = (command: string) => execFileSync("sqlite3", [path, command], { encoding: "utf8" }).trim();
  try {
    sql(`CREATE TABLE Payment (id TEXT PRIMARY KEY, status TEXT NOT NULL, amountCents INTEGER NOT NULL);
      INSERT INTO Payment VALUES ('historical', 'PAID', 10000);`);
    execFileSync("sqlite3", [path], { input: migration + support, encoding: "utf8" });
    assert.equal(sql("SELECT id || ':' || status || ':' || amountCents FROM Payment"), "historical:PAID:10000");
    assert.equal(sql("SELECT COUNT(*) FROM Payment WHERE refundRequestedAt IS NULL AND refundRequestedByUserId IS NULL AND bankRefundResolvedAt IS NULL AND ownerRefundRequestEmailSentAt IS NULL"), "1");
    assert.equal(sql("PRAGMA foreign_key_check"), "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
