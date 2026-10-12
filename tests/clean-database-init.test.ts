import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createRefundFixture } from "./helpers/refund-fixture";

test("clean-install baseline creates every model and supports connected financial writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "salento-clean-baseline-test-"));
  const path = join(directory, "new.db");
  const url = `file:${path}`;
  try {
    execFileSync(process.execPath, ["scripts/init-clean-database.mjs", path], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const tables = new Set((await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name));
      for (const model of Prisma.dmmf.datamodel.models) assert.ok(tables.has(model.dbName ?? model.name), `missing table ${model.name}`);
      const guard = await db.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'PartnerWithdrawalRequest_one_unresolved_per_partner_key'`;
      assert.equal(guard.length, 1, "the partial uniqueness guard must be installed");
      assert.equal(await db.user.count(), 0, "the clean path must not seed test users");
      assert.equal(await db.payment.count(), 0, "the clean path must not seed payments");
      assert.equal(await db.partnerPayout.count(), 0, "the clean path must not seed payouts");
      const fixture = await createRefundFixture(db, "fresh-install");
      await db.account.create({ data: { userId: fixture.partner.id, type: "oauth", provider: "synthetic", providerAccountId: "synthetic-id" } });
      await db.session.create({ data: { userId: fixture.partner.id, sessionToken: "synthetic-session", expires: new Date(Date.now() + 3600_000) } });
      const run = await db.partnerPayoutRun.create({ data: { runKey: "fresh-install-test", scheduledFor: new Date(), status: "RUNNING" } });
      const payout = await db.partnerPayout.create({ data: { payoutRunId: run.id, partnerUserId: fixture.partner.id, amountCents: 5000, payoutMethod: "STRIPE", status: "SCHEDULED" } });
      const request = await db.partnerWithdrawalRequest.create({ data: { partnerUserId: fixture.partner.id, idempotencyKey: "fresh-install-test-key", payoutId: payout.id, amountCents: 5000, payoutMethod: "STRIPE", destinationSnapshotEncrypted: "synthetic-no-secret" } });
      await db.partnerWithdrawalAuditEvent.create({ data: { withdrawalRequestId: request.id, toStatus: "REQUESTED" } });
      await db.partnerCommission.update({ where: { id: fixture.commission.id }, data: { payoutId: payout.id, status: "RESERVED" } });
      assert.equal((await db.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: request.id }, include: { payout: { include: { commissions: true } }, auditEvents: true } })).payout.commissions.length, 1);
      assert.equal(await db.businessMembership.count(), 1);
      assert.equal(await db.payment.count(), 1);
    } finally {
      await db.$disconnect();
    }
    assert.equal(execFileSync("sqlite3", [path, "PRAGMA integrity_check;"]).toString().trim(), "ok");
    assert.equal(execFileSync("sqlite3", [path, "PRAGMA foreign_key_check;"]).toString().trim(), "");
    const diff = spawnSync("node_modules/.bin/prisma", ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.equal(diff.status, 0, diff.stdout + diff.stderr);
    const original = readFileSync(path);
    const repeat = spawnSync(process.execPath, ["scripts/init-clean-database.mjs", path], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    assert.notEqual(repeat.status, 0, "existing databases must be refused");
    assert.deepEqual(readFileSync(path), original, "refusal must not alter the existing database");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
