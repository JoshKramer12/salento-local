import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { prisma } from "@/lib/prisma";
import { attemptPurchaseConfirmationDeliveryForSubmission,
  ensurePurchaseConfirmationDeliveryForSubmission, retryPendingPurchaseConfirmations } from "@/lib/purchase-confirmation-delivery";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-purchase-confirmation-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
async function fixture() { return createRefundFixture(prisma, `purchase-mail-${++sequence}`); }

test("email failure remains durable while the initial payment, membership and €50 commission stay complete", async () => {
  const f = await fixture();
  assert.equal(await prisma.purchaseConfirmationDelivery.count(), 0);
  const id = await ensurePurchaseConfirmationDeliveryForSubmission(f.submission.id);
  assert.ok(id);
  assert.equal(await ensurePurchaseConfirmationDeliveryForSubmission(f.submission.id), id);
  let sends = 0;
  const first = await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, {
    sendConfirmation: async () => { sends++; throw new Error("synthetic_provider_unavailable"); },
  });
  assert.equal(first, "pending");
  const pending = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { businessSubmissionId: f.submission.id } });
  assert.equal(pending.attemptCount, 1);
  assert.equal(pending.failureMessage, "synthetic_provider_unavailable");
  assert.equal(pending.acceptedAt, null);
  assert.ok(pending.nextAttemptAt);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: f.payment.id } })).status, "PAID");
  assert.equal(await prisma.businessMembership.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { paymentId: f.payment.id, amountCents: 5000 } }), 1);
  assert.equal(await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, {
    sendConfirmation: async () => { sends++; return true; },
  }), "skipped");
  assert.equal(sends, 1);
  const retryAt = new Date(pending.nextAttemptAt!.getTime() + 1);
  const result = await retryPendingPurchaseConfirmations({ now: retryAt,
    sendConfirmation: async ({ submissionId }) => {
      sends++;
      await prisma.businessSubmission.update({ where: { id: submissionId },
        data: { purchaseConfirmationSentAt: retryAt } });
      return true;
    },
  });
  assert.deepEqual(result, { accepted: 1, due: 1 });
  assert.equal(sends, 2);
  const accepted = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { id } });
  assert.equal(accepted.acceptedAt?.getTime(), retryAt.getTime());
  assert.equal(accepted.nextAttemptAt, null);
  assert.deepEqual(await retryPendingPurchaseConfirmations({ now: new Date(retryAt.getTime() + 60_000),
    sendConfirmation: async () => { sends++; return true; } }), { accepted: 0, due: 0 });
  assert.equal(sends, 2);
});

test("unknown email outcome stops at the provider idempotency window for manual review", async () => {
  const f = await fixture();
  const id = await ensurePurchaseConfirmationDeliveryForSubmission(f.submission.id);
  assert.ok(id);
  const now = new Date();
  assert.equal(await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, { now,
    sendConfirmation: async () => { throw new Error("synthetic_timeout"); } }), "pending");
  const reviewAt = new Date(now.getTime() + 23 * 60 * 60 * 1000 + 1);
  assert.equal(await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, { now: reviewAt,
    sendConfirmation: async () => { throw new Error("should_not_resend"); } }), "review");
  const row = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { id } });
  assert.equal(row.nextAttemptAt, null);
  assert.equal(row.failureMessage, "purchase_confirmation_requires_review");
});

test("a refund before email retry stops the pending purchase confirmation", async () => {
  const f = await fixture();
  await ensurePurchaseConfirmationDeliveryForSubmission(f.submission.id);
  assert.equal(await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, {
    sendConfirmation: async () => { throw new Error("synthetic_provider_unavailable"); },
  }), "pending");
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED" } });
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { paymentStatus: "REFUNDED" } });
  const pending = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { businessSubmissionId: f.submission.id } });
  let sends = 0;
  assert.equal(await attemptPurchaseConfirmationDeliveryForSubmission(f.submission.id, {
    now: new Date(pending.nextAttemptAt!.getTime() + 1),
    sendConfirmation: async () => { sends++; return true; },
  }), "review");
  assert.equal(sends, 0);
  const stopped = await prisma.purchaseConfirmationDelivery.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(stopped.failureMessage, "purchase_confirmation_no_longer_eligible");
  assert.equal(stopped.nextAttemptAt, null);
});

test("email delivery is never backfilled for existing paid rows", async () => {
  const sql = readFileSync("prisma/migrations/20261028180000_webhook_processing_attempts/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "PurchaseConfirmationDelivery"/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "BusinessSubmission"|UPDATE "Payment"/);
  const before = await prisma.purchaseConfirmationDelivery.count();
  await fixture();
  assert.equal(await prisma.purchaseConfirmationDelivery.count(), before);
});
