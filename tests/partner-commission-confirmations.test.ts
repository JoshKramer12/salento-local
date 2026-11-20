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
import { ensurePartnerCommissionForSubmission, payableCommissionWhere } from "@/lib/partner-ledger";
import { buildOwnerListingEmailCopy } from "@/lib/business-owner-access";
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
  assert.match(mail.messages[0].text, /now published on Salento Local and its payment has been confirmed/);
  assert.match(mail.messages[0].text, /14-day refund period/);
  assert.match(mail.messages[0].text, /cannot be withdrawn or paid out as real money/);
  assert.match(mail.messages[0].html, /href="https:\/\/salento\.example\.test\/dashboard\/earnings"/);
  assert.equal(mail.messages[0].headers?.["X-Transactional-Message"], "partner-commission-confirmation");
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: f.submission.id, amountCents: 5000 } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date(Date.now() + 30 * 86_400_000)), businessSubmissionId: f.submission.id } }), 0);
  assert.ok((await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id } })).acceptedAt);
});

test("a synthetic LIVE €100 Partner membership earns one held €50 commission", async () => {
  const paidAt = new Date("2026-11-20T12:00:00.000Z");
  const f = await createRefundFixture(prisma, `live-canary-${++sequence}`, paidAt);
  await prisma.partnerCommission.delete({ where: { id: f.commission.id } });
  const params = { businessSubmissionId: f.submission.id, sourceEventId: "evt_live_synthetic", sourceEventType: "payment_intent.succeeded" };
  await ensurePartnerCommissionForSubmission(params, { revalidatePaths: () => {} });
  await ensurePartnerCommissionForSubmission(params, { revalidatePaths: () => {} });
  const commissions = await prisma.partnerCommission.findMany({ where: { businessSubmissionId: f.submission.id, type: "COMMISSION" } });
  assert.equal(commissions.length, 1);
  assert.equal(commissions[0].paymentId, f.payment.id);
  assert.equal(commissions[0].amountCents, 5000);
  assert.equal(commissions[0].status, "PENDING");
  assert.equal(commissions[0].eligibleAt?.toISOString(), "2026-12-04T12:00:00.000Z");
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date("2026-12-04T11:59:59.000Z")), id: commissions[0].id } }), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date("2026-12-04T12:00:00.000Z")), id: commissions[0].id } }), 1);
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
    assert.match(mail.messages[0].text, payLater ? /€50,00/ : /€50\.00/);
    if (payLater) {
      assert.match(mail.messages[0].text, /pubblicata/);
      assert.doesNotMatch(mail.messages[0].text, /modalità di prova Stripe/);
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

test("Italian and English commission emails reuse the publication card and link to Partner earnings", () => {
  const owner = buildOwnerListingEmailCopy({
    businessName: "Masseria", locale: "it", manageUrl: "https://salento.example.test/dashboard",
    ownerName: "Giulia", receiptUrl: "https://salento.example.test/receipt",
    viewUrl: "https://salento.example.test/businesses/masseria",
  });
  const cardStart = owner.html.slice(0, owner.html.indexOf('<p style="margin:0 0 18px">'));
  const url = "https://salento.example.test/dashboard/earnings";
  for (const locale of ["it", "en"] as const) {
    const message = buildPartnerCommissionConfirmationEmail({
      amountCents: 5000, businessName: "Masseria del Sole", earningsUrl: url,
      locale, partnerName: "Giulia Bianchi", testMode: false,
    });
    assert.ok(message.html.startsWith(cardStart));
    assert.match(message.html, /width="100%"/);
    assert.match(message.html, /max-width:600px/);
    assert.match(message.html, /background:#f4ede3/);
    assert.match(message.html, /background:#fffdf9/);
    assert.match(message.html, /border-radius:18px/);
    assert.match(message.html, /font-family:Georgia,'Times New Roman',serif/);
    assert.match(message.html, /background:#2a6257;border-radius:9px/);
    assert.ok(message.html.includes(`href="${url}"`));
    assert.ok(message.text.includes(url));
    assert.doesNotMatch(message.html, /simulat|simulated|non è prelevabile/);
    assert.doesNotMatch(message.text, /simulat|simulated|non è prelevabile/);
    assert.match(message.html, locale === "it" ? /Ciao Giulia/ : /Hello Giulia/);
    assert.match(message.subject, locale === "it" ? /Hai guadagnato una commissione di €50!/ : /You've earned a €50 commission!/);
  }
});

test("the commission footer uses the configured support contact", () => {
  const original = process.env.SUPPORT_EMAIL;
  process.env.SUPPORT_EMAIL = "support@example.test";
  try {
    const message = buildPartnerCommissionConfirmationEmail({
      amountCents: 5000, businessName: "Masseria", earningsUrl: "https://salento.example.test/dashboard/earnings",
      locale: "it", testMode: false,
    });
    assert.match(message.html, /mailto:support@example\.test/);
    assert.match(message.text, /Per assistenza, scrivi a support@example\.test/);
  } finally {
    if (original === undefined) delete process.env.SUPPORT_EMAIL;
    else process.env.SUPPORT_EMAIL = original;
  }
});

test("test payments disclose simulation, and dynamic Partner and business names are HTML escaped", () => {
  for (const locale of ["it", "en"] as const) {
    const message = buildPartnerCommissionConfirmationEmail({
      amountCents: 5000, businessName: '<script>alert("x")</script>',
      earningsUrl: "https://salento.example.test/dashboard/earnings", locale,
      partnerName: '<img src=x onerror=alert(1)> Bianchi', testMode: true,
    });
    assert.doesNotMatch(message.html, /<script>|<img/);
    assert.match(message.html, /&lt;script&gt;/);
    assert.match(message.html, /&lt;img/);
    assert.match(message.html, /font-size:13px;line-height:1.5/);
    assert.match(message.text, locale === "it" ? /€50,00/ : /€50\.00/);
    assert.match(message.text, locale === "it" ? /non è prelevabile né pagabile come denaro reale/ : /cannot be withdrawn or paid out as real money/);
    assert.doesNotMatch(message.subject, /TEST/);
  }
});

test("saved Partner language and name select the Italian confirmation", async () => {
  const f = await fixture();
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredLanguage: "it", fullName: "Giulia Bianchi",
  } });
  const id = await ensurePartnerCommissionConfirmationDeliveryForSubmission(f.submission.id);
  assert.ok(id);
  const mail = sentMessages();
  assert.equal(await attemptPartnerCommissionConfirmationForSubmission(f.submission.id, { sendEmail: mail.sendEmail }), "accepted");
  assert.match(mail.messages[0].subject, /Hai guadagnato una commissione di €50!/);
  assert.match(mail.messages[0].html, /Ciao Giulia/);
  assert.equal((await prisma.partnerCommissionConfirmationDelivery.findUniqueOrThrow({ where: { id } })).locale, "it");
});

test("migration creates an empty outbox without backfilling historical commissions", async () => {
  const sql = readFileSync("prisma/migrations/20261018130000_add_partner_commission_confirmation_delivery/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "PartnerCommissionConfirmationDelivery"/);
  assert.match(sql, /CREATE UNIQUE INDEX "PartnerCommissionConfirmationDelivery_commissionId_key"/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE "PartnerCommission"|DELETE FROM|DROP TABLE/);
  const f = await fixture();
  assert.equal(await prisma.partnerCommissionConfirmationDelivery.count({ where: { commissionId: f.commission.id } }), 0);
});
