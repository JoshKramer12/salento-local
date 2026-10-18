import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { prisma } from "@/lib/prisma";
import {
  attemptPartnerCommissionConfirmationForSubmission,
  buildPartnerCommissionConfirmationEmail,
  ensurePartnerCommissionConfirmationDeliveryForSubmission,
  retryPendingPartnerCommissionConfirmations,
} from "@/lib/partner-commission-confirmations";
import { payableCommissionWhere } from "@/lib/partner-ledger";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-partner-commission-email-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.APP_URL = "https://salento.example.test";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
const fixture = () => createRefundFixture(prisma, `confirmation-${++sequence}`);
function sentMessages() {
  const messages: Array<{ headers?: Record<string, string>; html: string; idempotencyKey?: string;
    subject: string; text: string; to: string }> = [];
  const sendEmail = async (message: typeof messages[number]) => {
    messages.push(message);
    return { provider: "resend" as const, messageId: `mail-${messages.length}`, success: true };
  };
  return { messages, sendEmail };
}

test("Pay Later bank transfer remains pending until Stripe-confirmed payment and publication", async () => {
  const f = await fixture();
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: {
    paymentMethod: "BANK_TRANSFER", paymentStatus: "AWAITING_BANK_TRANSFER", status: "AWAITING_PAYMENT",
  } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: {
    method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER", paidAt: null, stripeLivemode: false,
  } });
  assert.equal(await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id), null);
  assert.equal(await prisma.partnerCommissionConfirmationDelivery.count(), 0);
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "PAID", paidAt: new Date() } });
  assert.equal(await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id), null);
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: {
    paymentStatus: "PAID", status: "PUBLISHED",
  } });
  const id = await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id);
  assert.ok(id);
  assert.equal(await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id), id);
  const mail = sentMessages();
  assert.equal(await attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: mail.sendEmail }), "accepted");
  assert.equal(await attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: mail.sendEmail }), "skipped");
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0].to, f.partner.email);
  assert.match(mail.messages[0].text, /€50/);
  assert.match(mail.messages[0].text, /published and its initial payment has been confirmed/);
  assert.match(mail.messages[0].text, /14-day refund period/);
  assert.match(mail.messages[0].text, /test activity and cannot be withdrawn or paid out as real money/);
  assert.equal(mail.messages[0].headers?.["X-Transactional-Message"], "partner-commission-confirmation");
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: f.submission.id, amountCents: 5000 } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date(Date.now() + 30 * 86_400_000)), businessSubmissionId: f.submission.id } }), 0);
  assert.ok((await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id } })).acceptedAt);
});

test("Pay Now and Pay Later use one payment-linked delivery; failed sends retry with the same key", async () => {
  for (const payLater of [false, true]) {
    const f = await fixture();
    await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { paymentMethod: "ONLINE" } });
    if (payLater) {
      await prisma.businessSubmissionInvitation.create({ data: {
        businessSubmissionId: f.submission.id, partnerUserId: f.partner.id,
        tokenHash: `hash-${f.submission.id}`, tokenNonce: `nonce-${f.submission.id}`,
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        locale: "it", recipientEmail: f.owner.email!,
      } });
      await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: { preferredLanguage: "it" } });
    }
    await prisma.payment.update({ where: { id: f.payment.id }, data: { stripeLivemode: payLater ? true : false } });
    const id = await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id);
    assert.ok(id);
    const keys: string[] = [];
    assert.equal(await attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: async (message) => {
      keys.push(message.idempotencyKey!);
      throw new Error("temporary_provider_failure");
    } }), "pending");
    const pending = await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id } });
    assert.equal(pending.acceptedAt, null);
    assert.equal(pending.failureMessage, "temporary_provider_failure");
    const mail = sentMessages();
    assert.deepEqual(await retryPendingPartnerCommissionConfirmations({
      now: new Date(pending.nextAttemptAt!.getTime() + 1),
      sendEmail: async (message) => { keys.push(message.idempotencyKey!); return mail.sendEmail(message); },
    }), { accepted: 1, due: 1 });
    assert.deepEqual(keys, [keys[0], keys[0]]);
    assert.equal(mail.messages.length, 1);
    assert.equal(mail.messages[0].to, f.partner.email);
    assert.match(mail.messages[0].text, payLater ? /50,00\s*€/ : /€50/);
    if (payLater) {
      assert.match(mail.messages[0].text, /pubblicata/);
      assert.doesNotMatch(mail.messages[0].text, /modalità test Stripe/);
    } else {
      assert.match(mail.messages[0].text, /Stripe test mode/);
    }
  }
});

test("reversed and refunded commissions cannot trigger pending messages", async () => {
  for (const reversal of ["commission", "payment"] as const) {
    const f = await fixture();
    const id = await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id);
    assert.ok(id);
    if (reversal === "commission") {
      await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "REVERSED" } });
    } else {
      await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED" } });
    }
    const mail = sentMessages();
    assert.equal(await attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: mail.sendEmail }), "canceled");
    assert.equal(mail.messages.length, 0);
    assert.ok((await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id } })).canceledAt);
  }
});

test("concurrent webhook attempts claim one delivery and an uncertain send stops before the provider key expires", async () => {
  const f = await fixture();
  const id = await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id);
  assert.ok(id);
  const mail = sentMessages();
  const results = await Promise.all([
    attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return mail.sendEmail(message);
    } }),
    attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: mail.sendEmail }),
  ]);
  assert.deepEqual(results.sort(), ["accepted", "skipped"]);
  assert.equal(mail.messages.length, 1);

  const another = await fixture();
  const anotherId = await ensurePartnerCommissionConfirmationDeliveryForSubmission(another.submission.id);
  assert.ok(anotherId);
  const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.partnerCommissionConfirmationDelivery.update({ where: { id: anotherId }, data: {
    firstAttemptedAt: old, nextAttemptAt: old,
  } });
  const never = sentMessages();
  assert.equal(await attemptPartnerCommissionConfirmationForSubmission(another.submission.id, { sendEmail: never.sendEmail }), "review");
  assert.equal(never.messages.length, 0);
  assert.equal((await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id: anotherId } })).nextAttemptAt, null);
});

test("non-Partner and unverified historical payment mode do not create a delivery", async () => {
  const f = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { stripeLivemode: null } });
  assert.equal(await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id), null);
  await prisma.payment.update({ where: { id: f.payment.id }, data: { stripeLivemode: true } });
  await prisma.user.update({ where: { id: f.partner.id }, data: { role: "BUSINESS_OWNER" } });
  assert.equal(await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id), null);
});

test("localized email escapes business names and distinguishes recorded commission from payout", () => {
  const message = buildPartnerCommissionConfirmationEmail({
    amountCents: 5000, businessName: '<script>alert("x")</script>',
    earningsUrl: "https://salento.example.test/dashboard/earnings", locale: "it", testMode: true,
  });
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.text, /50,00\s*€/);
  assert.match(message.text, /non può essere prelevata/);
  assert.doesNotMatch(message.subject, /TEST/);
});

test("migration creates an empty outbox without backfilling historical commissions", async () => {
  const sql = readFileSync("prisma/migrations/20261018130000_add_partner_commission_confirmation_delivery/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "PartnerCommissionConfirmationDelivery"/);
  assert.match(sql, /CREATE UNIQUE INDEX "PartnerCommissionConfirmationDelivery_commissionId_key"/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "PartnerCommission"|DELETE FROM|DROP TABLE/);
  const f = await fixture();
  assert.equal(await prisma.partnerCommissionConfirmationDelivery.count({ where: { commissionId: f.commission.id } }), 0);
});
