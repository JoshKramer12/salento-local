import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { prisma } from "@/lib/prisma";
import { attemptInvitationEmail, buildInvitationEmail, createOrRotateInvitation, deriveInvitationToken,
  getInvitationByToken, getOwnerDetailsHash, getPartnerListingMissingFields, PayLaterMissingFieldsError, requireVerifiedInvitation,
  startInvitationOtp, verifyInvitationOtp, closeInvitation, getInvitationUrl } from "@/lib/pay-later-invitations";
import { isValidOwnerSignature, chooseVerifiedPayLaterPayment, getVerifiedPayLaterPaymentDestination,
  buildPayLaterBankInstructionsEmail } from "@/lib/pay-later-payment";
import { reminderSequenceDue, retryPendingPayLaterBankInstructionsEmails, runPayLaterReminderJob } from "@/lib/pay-later-reminders";
import { assertPartnerPayoutHasOnlyLivePayments, ensurePendingPartnerCommissionForSubmission, getPartnerBalanceSummary, payableCommissionWhere } from "@/lib/partner-ledger";
import { syncStripePaymentFromWebhook } from "@/lib/stripe-payment-sync";
import { EMAIL_MANUAL_PAYMENT_FLOW } from "@/lib/no-email-payment";
import { assertFinancialPaymentAllowed, assertStripeObjectMode, getStripe, isPublicFinancialHold } from "@/lib/stripe";

const directory = mkdtempSync(join(tmpdir(), "salento-pay-later-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.PAY_LATER_ENABLED = "true";
process.env.PAY_LATER_TOKEN_SECRET = "pay-later-test-secret-12345678901234567890";
process.env.APP_URL = "https://salento.example.test";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let fixtureNumber = 0;
async function fixture() {
  const number = ++fixtureNumber;
  const partner = await prisma.user.create({ data: { role: "GETTER", email: `partner-${number}@example.test`, username: `pay-later-partner-${number}` } });
  const town = await prisma.town.upsert({ where: { id: "pay-later-test-town" }, update: {}, create: {
    id: "pay-later-test-town", slug: "pay-later-test-town", name: "Lecce", province: "LE",
    shortDescription: "Test", intro: "Test", history: "Test", practicalInfo: "Test",
    heroImageSeed: "test", latitude: 40.35, longitude: 18.17,
  } });
  const category = await prisma.category.upsert({ where: { id: "pay-later-test-category" }, update: {}, create: {
    id: "pay-later-test-category", slug: "pay-later-test-category", name: "Restaurants",
    description: "Test", icon: "restaurant", group: "FOOD",
  } });
  const submission = await prisma.businessSubmission.create({ data: {
    userId: partner.id, businessName: `Caffè Test ${number}`, townId: town.id,
    categoryId: category.id, address: "Via Test 1, Lecce", addressPlaceId: `place-${number}`,
    addressLatitude: 40.35, addressLongitude: 18.17, googleMapsUrl: "https://maps.example.test",
    phone: "+393200000001", whatsapp: "+393200000001", email: "business@example.test",
    openingHours: "[{}]", shortDescription: "Test business", longDescription: "A synthetic listing",
    ownerName: "Test Owner", ownerPhone: "+393200000002",
    ownerEmail: `owner-${number}@example.test`, photoUrls: ["/test/exterior.jpg", "/test/interior.jpg"],
  } });
  return { partner, submission };
}

const sent: Array<{ idempotencyKey?: string; text: string; to: string }> = [];
const sendEmail = async (message: { idempotencyKey?: string; text: string; to: string }) => {
  sent.push(message);
  return { provider: "resend" as const, messageId: `test-mail-${sent.length}`, success: true };
};
const day = 86_400_000;

test("saved Partner draft with possible phone numbers sends before signature without financial records", async () => {
  const { partner, submission } = await fixture();
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: {
    phone: "+393000000000", ownerPhone: "+441000000000",
  } });
  const saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
  assert.deepEqual(getPartnerListingMissingFields(saved), []);
  assert.notEqual(getOwnerDetailsHash(saved), getOwnerDetailsHash({ ...saved, ownerPhone: "+441000000001" }));
  assert.equal(saved.agreementSignature, null);
  assert.equal(saved.businessTermsAcceptedAt, null);
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const token = deriveInvitationToken(created);
  const before = sent.length;
  assert.equal(await attemptInvitationEmail(created.id, new Date(), sendEmail as never), "accepted");
  assert.equal(await attemptInvitationEmail(created.id, new Date(), sendEmail as never), "skipped");
  assert.equal(sent.length, before + 1);
  assert.equal(await startInvitationOtp(token, new Date(), sendEmail as never), "sent");
  const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  assert.equal(await verifyInvitationOtp(token, code + "0"), null);
  assert.ok(await verifyInvitationOtp(token, code));
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal(await prisma.businessMembership.count(), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal((await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "DRAFT");
  await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
});

test("missing saved details report the exact field and local edits require a confirmed save", async () => {
  const { partner, submission } = await fixture();
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { photoUrls: ["/test/exterior.jpg"] } });
  const saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
  assert.deepEqual(getPartnerListingMissingFields(saved), ["photoUrls"]);
  assert.deepEqual(getPartnerListingMissingFields({ ...saved, photoUrls: ["/test/exterior.jpg", "/test/interior.jpg"] }), []);
  await assert.rejects(createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" }),
    (error) => error instanceof PayLaterMissingFieldsError && error.fields.join() === "photoUrls");
  assert.equal(await prisma.businessSubmissionInvitation.count({ where: { businessSubmissionId: submission.id } }), 0);
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { photoUrls: ["/test/exterior.jpg", "/test/interior.jpg"] } });
  assert.ok(await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" }));
});

test("owner email correction is persisted on the same submission before invitation", async () => {
  const { partner, submission } = await fixture();
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { ownerEmail: "" } });
  await assert.rejects(createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" }),
    (error) => error instanceof PayLaterMissingFieldsError && error.fields.includes("ownerEmail"));
  const correctedEmail = `corrected-${submission.id}@example.test`;
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { ownerEmail: correctedEmail } });
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  assert.equal(created.recipientEmail, correctedEmail);
  assert.equal((await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } })).ownerEmail, correctedEmail);
  assert.equal(await prisma.businessSubmission.count({ where: { id: submission.id } }), 1);
});

test("owner-created invitation preserves valid renewal choices and stays unpaid in public Stripe sandbox", async () => {
  const { partner: owner, submission } = await fixture();
  await prisma.user.update({ where: { id: owner.id }, data: { role: "BUSINESS_OWNER" } });
  const previousEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME;
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousPublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const previousTestFlag = process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED;
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_only";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_only";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_synthetic_public_hold";
  delete process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED;
  try {
    assert.equal(isPublicFinancialHold(), true);
    assert.throws(assertFinancialPaymentAllowed, /public_financial_payment_paused/);
    const created = await createOrRotateInvitation({ partnerUserId: owner.id, submissionId: submission.id, locale: "en" });
    const token = deriveInvitationToken(created);
    assert.equal(await attemptInvitationEmail(created.id, new Date(), sendEmail as never), "accepted");
    assert.match(sent.at(-1)?.text ?? "", /temporarily paused/);
    assert.match(buildInvitationEmail({ businessName: "Synthetic", townName: "Lecce",
      ownerName: "Owner", locale: "en", url: "https://salento.example.test/pay-later",
      ownerSubmitted: true, paymentPaused: true }).html, /you saved the listing/);
    assert.equal(await startInvitationOtp(token, new Date(), sendEmail as never), "sent");
    const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    assert.ok(await verifyInvitationOtp(token, code));
    const invitation = await getInvitationByToken(token);
    assert.ok(invitation);
    const signature = JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }, { x: 2, y: 3 }]] });
    const approval = {
      method: "BANK_TRANSFER" as const, renewal: "MANUAL" as const, ownerConfirmed: true, termsAccepted: true,
      signerFullName: "Test Owner", signerRole: "OWNER", signerRoleOther: "", signature,
    };
    assert.deepEqual(await chooseVerifiedPayLaterPayment(invitation, approval), { status: "paused" });
    let saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(saved.status, "DRAFT");
    assert.equal(saved.paymentStatus, "NOT_REQUIRED");
    assert.equal(saved.paymentMethod, null);
    assert.equal(saved.agreementSignature, signature);
    assert.equal(saved.automaticRenewalAtAcceptance, false);
    assert.deepEqual(await chooseVerifiedPayLaterPayment(invitation, {
      ...approval, method: "ONLINE", renewal: "AUTO",
    }), { status: "paused" });
    saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(saved.automaticRenewalAtAcceptance, true);
    await assert.rejects(chooseVerifiedPayLaterPayment(invitation, {
      ...approval, method: "BANK_TRANSFER", renewal: "AUTO",
      signature: JSON.stringify({ version: 1, strokes: [[{ x: 3, y: 4 }, { x: 5, y: 6 }]] }),
    }), /bank_transfer_requires_manual_renewal/);
    saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(saved.automaticRenewalAtAcceptance, true);
    assert.equal(saved.agreementSignature, signature);
    assert.deepEqual(await chooseVerifiedPayLaterPayment(invitation, {
      ...approval, method: "ONLINE", renewal: "MANUAL",
    }), { status: "paused" });
    saved = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(saved.automaticRenewalAtAcceptance, false);
    await assert.rejects(syncStripePaymentFromWebhook({ amountPaidCents: 10_000,
      businessSubmissionId: submission.id, stripeEventId: "evt_synthetic_public_hold",
      paymentIntentId: "pi_synthetic_public_hold" }), /public_financial_payment_paused/);
    const payload = JSON.stringify({ id: `evt_public_hold_${submission.id}`, type: "checkout.session.completed",
      livemode: false, data: { object: { id: `cs_test_${submission.id}`, object: "checkout.session",
        metadata: { businessSubmissionId: submission.id, userId: owner.id }, amount_total: 10_000,
        currency: "eur", payment_status: "paid" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const webhookSignature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.${payload}`).digest("hex");
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const response = await POST(new Request("https://salento.example.test/api/stripe/webhook", {
      method: "POST", headers: { "stripe-signature": `t=${timestamp},v1=${webhookSignature}` }, body: payload,
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sandboxFinancialHold, true);
    assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
    assert.equal(await prisma.businessMembership.count(), 0);
    assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
    assert.equal((await runPayLaterReminderJob(new Date(Date.now() + 4 * day), sendEmail as never)).sent, 0);
    await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
  } finally {
    if (previousEnvironment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = previousEnvironment;
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousPublishableKey === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = previousPublishableKey;
    if (previousWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
    if (previousTestFlag === undefined) delete process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED;
    else process.env.PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED = previousTestFlag;
  }
});

test("invitation persists before mandatory email, OTP verifies once, rotation revokes old link", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
  const token = deriveInvitationToken(created);
  assert.equal(getInvitationUrl(created), `https://salento.example.test/pay-later#invite=${token}`);
  assert.equal(await prisma.businessSubmissionInvitation.count({ where: { businessSubmissionId: submission.id } }), 1);
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal(await startInvitationOtp(token), "unavailable");
  assert.equal(await attemptInvitationEmail(created.id, new Date(), sendEmail as never), "accepted");
  assert.equal(sent.at(-1)?.to, submission.ownerEmail);
  assert.match(sent.at(-1)?.text ?? "", /€100/);
  assert.equal(await startInvitationOtp(token, new Date(), sendEmail as never), "sent");
  const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  assert.equal(await verifyInvitationOtp(token, "000000"), null);
  const verified = await verifyInvitationOtp(token, code);
  assert.ok(verified);
  assert.ok(await requireVerifiedInvitation(token, verified.sessionToken));
  assert.equal(await verifyInvitationOtp(token, code), null);
  const rotated = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
  assert.equal(await getInvitationByToken(token), null);
  assert.equal(await startInvitationOtp(deriveInvitationToken(rotated)), "unavailable");
  assert.equal(await prisma.businessSubmissionInvitation.count({ where: { businessSubmissionId: submission.id } }), 1);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
  await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
});

test("verified detail changes invalidate payment approval before Stripe resource creation", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const token = deriveInvitationToken(created);
  await attemptInvitationEmail(created.id, new Date(), sendEmail as never);
  await startInvitationOtp(token, new Date(), sendEmail as never);
  const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  await verifyInvitationOtp(token, code);
  const invitation = await getInvitationByToken(token);
  assert.ok(invitation);
  assert.equal(invitation.verifiedDetailsHash, getOwnerDetailsHash(invitation.businessSubmission));
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { phone: "+393200000003" } });
  const signature = JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }, { x: 2, y: 3 }]] });
  assert.equal(isValidOwnerSignature(signature), true);
  await assert.rejects(chooseVerifiedPayLaterPayment(invitation, { method: "BANK_TRANSFER", renewal: "MANUAL",
    ownerConfirmed: true, termsAccepted: true, signerFullName: "Test Owner", signerRole: "OWNER",
    signerRoleOther: "", signature }), /pay_later_state_conflict/);
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
  await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
});

test("six reminders follow original acceptance clock, retry one failure, and stop after payment", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const acceptedAt = new Date();
  await attemptInvitationEmail(created.id, acceptedAt, sendEmail as never);
  const anchor = (await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } })).emailAcceptedAt!;
  assert.deepEqual([0, 2, 3, 6, 13, 20, 27, 34, 40].map((days) => reminderSequenceDue(anchor, new Date(anchor.getTime() + days * day))),
    [0, 0, 1, 2, 3, 4, 5, 6, 6]);
  let reminderCount = 0;
  const reminders = async (message: { text: string; idempotencyKey?: string }) => {
    assert.match(message.text, /€100/);
    assert.ok(message.idempotencyKey);
    reminderCount++;
    return { provider: "resend" as const, messageId: `reminder-${reminderCount}`, success: true };
  };
  for (const dueDay of [3, 6, 13, 20, 27, 34]) {
    const dueAt = new Date(anchor.getTime() + dueDay * day + 1_000);
    assert.equal((await runPayLaterReminderJob(dueAt, reminders as never)).sent, 1);
    assert.equal((await runPayLaterReminderJob(dueAt, reminders as never)).sent, 0);
  }
  assert.equal(reminderCount, 6);
  assert.equal((await runPayLaterReminderJob(new Date(anchor.getTime() + 40 * day), reminders as never)).sent, 0);
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: { paymentStatus: "PAID" } });
  assert.equal((await runPayLaterReminderJob(new Date(anchor.getTime() + 41 * day), reminders as never)).sent, 0);
});

test("paid webhook creates one published membership and original Partner commission from payment date", async () => {
  const { partner, submission } = await fixture();
  const invitation = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
  await attemptInvitationEmail(invitation.id, new Date(), sendEmail as never);
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: {
    paymentMethod: "ONLINE", paymentStatus: "PENDING_PAYMENT", status: "AWAITING_PAYMENT",
    agreementSignature: JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }]] }),
    signedAt: new Date(), businessTermsAcceptedAt: new Date(),
  } });
  await prisma.payment.create({ data: { id: `initial-element:${submission.id}`,
    businessSubmissionId: submission.id, userId: partner.id, partnerUserId: partner.id,
    method: "STRIPE_CHECKOUT", amountCents: 10000, status: "PENDING_PAYMENT",
    stripePaymentIntentId: `pi_pay_later_${submission.id}` } });
  await ensurePendingPartnerCommissionForSubmission({ businessSubmissionId: submission.id, revalidatePaths: false });
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
  const event = { amountPaidCents: 10000, businessSubmissionId: submission.id, revalidatePaths: false,
    paymentIntentId: `pi_pay_later_${submission.id}`, stripeEventId: `evt_pay_later_${submission.id}` };
  await syncStripePaymentFromWebhook(event);
  await syncStripePaymentFromWebhook(event);
  const paidSubmission = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
  assert.equal(paidSubmission.status, "PUBLISHED");
  assert.equal(paidSubmission.paymentStatus, "PAID");
  assert.ok(paidSubmission.createdBusinessId);
  const membership = await prisma.businessMembership.findUniqueOrThrow({ where: { businessId: paidSubmission.createdBusinessId! } });
  assert.equal(membership.originatingPartnerUserId, partner.id);
  assert.equal(await prisma.businessMembership.count({ where: { businessId: paidSubmission.createdBusinessId! } }), 1);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: `initial-element:${submission.id}` } });
  assert.equal(payment.partnerUserId, partner.id);
  assert.equal(payment.status, "PAID");
  const commission = await prisma.partnerCommission.findUniqueOrThrow({ where: { sourceKey: `commission:submission:${submission.id}` } });
  assert.equal(commission.partnerUserId, partner.id);
  assert.equal(commission.paymentId, payment.id);
  assert.equal(commission.amountCents, 5000);
  assert.equal(commission.eligibleAt?.getTime(), payment.paidAt!.getTime() + 14 * day);
  assert.equal(commission.earnedAt?.getTime(), payment.paidAt!.getTime());
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 1);
  assert.ok((await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).completedAt);
});

test("Pay Later bank instructions survive continuation, email once, and stay pending until confirmed", async () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_synthetic_bank_confirmation";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_bank_confirmation";
  try {
  for (const ownerSubmitted of [false, true]) {
    const { partner, submission } = await fixture();
    if (ownerSubmitted) await prisma.user.update({ where: { id: partner.id }, data: { role: "BUSINESS_OWNER" } });
    const invitation = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
    await attemptInvitationEmail(invitation.id, new Date(), sendEmail as never);
    const token = deriveInvitationToken(invitation);
    await startInvitationOtp(token, new Date(), sendEmail as never);
    const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    assert.ok(await verifyInvitationOtp(token, code));
    const detailsHash = getOwnerDetailsHash(await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } }));
    await prisma.businessSubmission.update({ where: { id: submission.id }, data: {
      paymentMethod: "BANK_TRANSFER", paymentStatus: "AWAITING_BANK_TRANSFER", status: "AWAITING_PAYMENT",
      amountOwedCents: 10000, automaticRenewalAtAcceptance: false,
      agreementSignature: JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }]] }),
      signedAt: new Date(), businessTermsAcceptedAt: new Date(),
      payLaterConfirmedAt: new Date(), payLaterDetailsHash: detailsHash, payLaterSetupCompletedAt: new Date(),
      bankTransferReference: `RF-${submission.id}`,
    } });
    const intentId = `pi_bank_${submission.id}`;
    await prisma.payment.create({ data: { id: `initial-bank:${submission.id}`,
      businessSubmissionId: submission.id, userId: partner.id,
      partnerUserId: ownerSubmitted ? null : partner.id,
      method: "BANK_TRANSFER", amountCents: 10000, status: "AWAITING_BANK_TRANSFER",
      bankTransferReference: `RF-${submission.id}`, stripePaymentIntentId: intentId,
    } });
    const instructions = { accountHolderName: "Stripe Payments Europe", amountRemainingCents: 10000,
      bic: "TESTBIC", hostedInstructionsUrl: "https://payments.example.test/instructions",
      iban: "IE123456789", reference: `RF-${submission.id}` };
    const emails: Array<{ to: string; text: string }> = [];
    let failFirstEmail = ownerSubmitted;
    const dependencies = { prepareBankIntent: async () => ({ instructions, paymentIntentId: intentId,
      status: "requires_action" as const }),
      sendEmail: async (message: { to: string; text: string }) => {
        if (failFirstEmail) { failFirstEmail = false; throw new Error("synthetic_email_failure"); }
        emails.push(message); return { provider: "resend" as const, messageId: "bank-instructions", success: true };
      } };
    const first = await getVerifiedPayLaterPaymentDestination(submission.id, "BANK_TRANSFER", dependencies as never);
    if (ownerSubmitted) {
      assert.equal(emails.length, 0);
      await prisma.payment.update({ where: { id: `initial-bank:${submission.id}` },
        data: { bankInstructionsEmailClaimedAt: new Date(Date.now() - 16 * 60_000) } });
    }
    const reopened = await getVerifiedPayLaterPaymentDestination(submission.id, "BANK_TRANSFER", dependencies as never);
    assert.deepEqual(first, { status: "bank", instructions });
    assert.deepEqual(reopened, first);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, submission.ownerEmail);
    assert.match(emails[0].text, /€100\.00/);
    assert.match(emails[0].text, new RegExp(instructions.reference));
    assert.ok((await prisma.payment.findUniqueOrThrow({ where: { id: `initial-bank:${submission.id}` } })).bankInstructionsEmailSentAt);
    assert.equal((await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "AWAITING_PAYMENT");
    assert.equal(await prisma.businessMembership.count({ where: { business: { submissions: { some: { id: submission.id } } } } }), 0);
    assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
    assert.equal(await prisma.partnerCommissionConfirmationDelivery.count({ where: {
      commission: { businessSubmissionId: submission.id },
    } }), 0);
    const event = { amountPaidCents: 10000, businessSubmissionId: submission.id, method: "BANK_TRANSFER" as const,
      paymentIntentId: intentId, stripeEventId: `evt_bank_${submission.id}`, stripeLivemode: false,
      revalidatePaths: false };
    await syncStripePaymentFromWebhook(event);
    await syncStripePaymentFromWebhook(event);
    const published = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    assert.equal(published.status, "PUBLISHED");
    assert.equal(await prisma.businessMembership.count({ where: { businessId: published.createdBusinessId! } }), 1);
    assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), ownerSubmitted ? 0 : 1);
    assert.equal(await prisma.partnerCommissionConfirmationDelivery.count({ where: {
      commission: { businessSubmissionId: submission.id },
    } }), ownerSubmitted ? 0 : 1);
  }
  const safeEmail = buildPayLaterBankInstructionsEmail({ businessName: "Caffè", locale: "it", sandbox: true,
    instructions: { accountHolderName: "Stripe", amountRemainingCents: 10000, bic: "BIC",
      hostedInstructionsUrl: "https://example.test", iban: "IE123", reference: "RF-123" } });
  assert.match(safeEmail.text, /non inviare denaro reale/);
  assert.doesNotMatch(safeEmail.subject, /TEST/);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = previousPublishable;
  }
});

async function pendingBankEmailFixture(locale: "en" | "it") {
  const { partner, submission } = await fixture();
  const invitation = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale });
  await attemptInvitationEmail(invitation.id, new Date(), sendEmail as never);
  const token = deriveInvitationToken(invitation);
  await startInvitationOtp(token, new Date(), sendEmail as never);
  const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  assert.ok(await verifyInvitationOtp(token, code));
  const detailsHash = getOwnerDetailsHash(await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } }));
  await prisma.businessSubmission.update({ where: { id: submission.id }, data: {
    paymentMethod: "BANK_TRANSFER", paymentStatus: "AWAITING_BANK_TRANSFER", status: "AWAITING_PAYMENT",
    amountOwedCents: 10000, automaticRenewalAtAcceptance: false,
    agreementSignature: JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }]] }),
    signedAt: new Date(), businessTermsAcceptedAt: new Date(), payLaterConfirmedAt: new Date(),
    payLaterDetailsHash: detailsHash, payLaterSetupCompletedAt: new Date(),
    bankTransferReference: `RF-${submission.id}`,
  } });
  const payment = await prisma.payment.create({ data: {
    id: `initial-bank:${submission.id}`, businessSubmissionId: submission.id,
    userId: partner.id, partnerUserId: partner.id, method: "BANK_TRANSFER",
    amountCents: 10000, status: "AWAITING_BANK_TRANSFER",
    bankTransferReference: `RF-${submission.id}`, stripePaymentIntentId: `pi_bank_${submission.id}`,
  } });
  const instructions = { accountHolderName: "Stripe Payments Europe", amountRemainingCents: 10000,
    bic: "TESTBIC", hostedInstructionsUrl: "https://payments.example.test/instructions",
    iban: "IE123456789", reference: `RF-${submission.id}` };
  const prepareBankIntent = async () => ({ instructions, paymentIntentId: payment.stripePaymentIntentId!,
    status: "requires_action" as const });
  return { instructions, payment, prepareBankIntent, submission };
}

test("15-minute bank email job retries a known failure while preserving the same payment and provider key", async () => {
  const { payment, prepareBankIntent, submission } = await pendingBankEmailFixture("en");
  const keys: string[] = [];
  const first = await getVerifiedPayLaterPaymentDestination(submission.id, "BANK_TRANSFER", {
    prepareBankIntent: prepareBankIntent as never,
    sendEmail: async (message) => { keys.push(message.idempotencyKey!); throw new Error("synthetic_provider_failure"); },
  });
  assert.equal(first.status, "bank");
  const afterFailure = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
  assert.ok(afterFailure.bankInstructionsEmailFirstAttemptedAt);
  assert.equal(afterFailure.bankInstructionsEmailSentAt, null);
  assert.equal((await retryPendingPayLaterBankInstructionsEmails(new Date(), {
    prepareBankIntent: prepareBankIntent as never,
    sendEmail: async () => { throw new Error("lease_must_prevent_send"); },
  })).due, 0);
  await prisma.payment.update({ where: { id: payment.id }, data: {
    bankInstructionsEmailClaimedAt: new Date(Date.now() - 16 * 60_000),
  } });
  const messages: Array<{ idempotencyKey?: string; text: string; to: string }> = [];
  const retried = await retryPendingPayLaterBankInstructionsEmails(new Date(), {
    prepareBankIntent: prepareBankIntent as never,
    sendEmail: async (message) => {
      keys.push(message.idempotencyKey!);
      messages.push(message);
      return { provider: "resend" as const, messageId: "retry-bank-mail", success: true };
    },
  });
  assert.deepEqual(retried, { due: 1, attempted: 1 });
  assert.deepEqual(keys, [keys[0], keys[0]]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, submission.ownerEmail);
  assert.match(messages[0].text, /Amount: €100\.00/);
  assert.match(messages[0].text, /Reference: RF-/);
  assert.ok((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).bankInstructionsEmailSentAt);
  assert.deepEqual(await retryPendingPayLaterBankInstructionsEmails(new Date(), {
    prepareBankIntent: prepareBankIntent as never,
    sendEmail: async () => { throw new Error("already_sent"); },
  }), { due: 0, attempted: 0 });
});

test("overlapping daily and 15-minute bank scans claim one send; 23-hour cutoff still stops uncertain delivery", async () => {
  const { payment, prepareBankIntent, submission } = await pendingBankEmailFixture("it");
  let sends = 0;
  const dependencies = {
    prepareBankIntent: prepareBankIntent as never,
    sendEmail: async (message: { to: string; text: string; idempotencyKey?: string }) => {
      sends++;
      assert.equal(message.to, submission.ownerEmail);
      assert.match(message.text, /Importo: 100,00\s*€/);
      assert.equal(message.idempotencyKey, `pay-later-bank-instructions:${payment.id}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { provider: "resend" as const, messageId: "one-bank-mail", success: true };
    },
  };
  await Promise.all([
    retryPendingPayLaterBankInstructionsEmails(new Date(), dependencies),
    retryPendingPayLaterBankInstructionsEmails(new Date(), dependencies),
  ]);
  assert.equal(sends, 1);
  assert.ok((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).bankInstructionsEmailSentAt);

  const uncertain = await pendingBankEmailFixture("en");
  await prisma.payment.update({ where: { id: uncertain.payment.id }, data: {
    bankInstructionsEmailClaimedAt: new Date(Date.now() - 24 * 60 * 60_000),
    bankInstructionsEmailFirstAttemptedAt: new Date(Date.now() - 24 * 60 * 60_000),
  } });
  assert.deepEqual(await retryPendingPayLaterBankInstructionsEmails(new Date(), {
    prepareBankIntent: uncertain.prepareBankIntent as never,
    sendEmail: async () => { throw new Error("uncertain_delivery_must_not_retry"); },
  }), { due: 0, attempted: 0 });
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: uncertain.payment.id } })).bankInstructionsEmailSentAt, null);
});

test("verified Stripe test events publish Pay Now and Pay Later once, with commissions excluded from payouts", async () => {
  const names = ["RAILWAY_ENVIRONMENT_NAME", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    RAILWAY_ENVIRONMENT_NAME: "production", STRIPE_SECRET_KEY: "sk_test_synthetic_only",
    STRIPE_PUBLISHABLE_KEY: "pk_test_synthetic_only", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_payments",
    PRODUCTION_STRIPE_TEST_PAYMENTS_ENABLED: "true",
  });
  try {
    assert.equal(isPublicFinancialHold(), false);
    assert.doesNotThrow(assertFinancialPaymentAllowed);
    assert.throws(() => assertStripeObjectMode(true), /stripe_payment_mode_mismatch/);
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_mismatched";
    assert.equal(isPublicFinancialHold(), true);
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_synthetic_only";
    assert.doesNotMatch(buildInvitationEmail({ businessName: "Synthetic", townName: "Lecce", ownerName: "Owner",
      locale: "en", url: "https://salento.example.test/pay-later" }).text, /\bTEST\b/);
    for (const flow of ["Pay Now", "Pay Later"]) {
      const { partner, submission } = await fixture();
      if (flow === "Pay Later") {
        const invitation = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
        const token = deriveInvitationToken(invitation);
        await attemptInvitationEmail(invitation.id, new Date(), sendEmail as never);
        assert.equal(await startInvitationOtp(token, new Date(), sendEmail as never), "sent");
        const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
        assert.ok(code);
        assert.ok(await verifyInvitationOtp(token, code));
      }
      await prisma.businessSubmission.update({ where: { id: submission.id }, data: {
        paymentMethod: "ONLINE", paymentStatus: "PENDING_PAYMENT", status: "AWAITING_PAYMENT",
        amountOwedCents: 10000, agreementSignature: JSON.stringify({ version: 1, strokes: [[{ x: 1, y: 2 }]] }),
        signedAt: new Date(), businessTermsAcceptedAt: new Date(), automaticRenewalAtAcceptance: false,
      } });
      const paymentId = `initial-element:${submission.id}`;
      const intentId = `pi_test_${submission.id}`;
      await prisma.payment.create({ data: { id: paymentId, businessSubmissionId: submission.id,
        userId: partner.id, partnerUserId: partner.id, method: "STRIPE_CHECKOUT", amountCents: 10000,
        status: "PENDING_PAYMENT", stripePaymentIntentId: intentId } });
      const event = JSON.stringify({ id: `evt_test_${submission.id}`, type: "payment_intent.succeeded", livemode: false,
        data: { object: { id: intentId, object: "payment_intent", livemode: false, amount: 10000,
          amount_received: 10000, currency: "eur", status: "succeeded", metadata: {
            businessSubmissionId: submission.id, partnerId: partner.id, paymentFlow: EMAIL_MANUAL_PAYMENT_FLOW,
            paymentId, userId: partner.id,
          } } } });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET!)
        .update(`${timestamp}.${event}`).digest("hex");
      const verified = getStripe().webhooks.constructEvent(event, `t=${timestamp},v1=${signature}`, process.env.STRIPE_WEBHOOK_SECRET!);
      assert.equal(verified.livemode, false);
      assertStripeObjectMode(verified.livemode);
      const coreEvent = { amountPaidCents: 10000, businessSubmissionId: submission.id,
        paymentIntentId: intentId, stripeEventId: verified.id, stripeLivemode: verified.livemode,
        revalidatePaths: false };
      await syncStripePaymentFromWebhook(coreEvent);
      await syncStripePaymentFromWebhook(coreEvent);
      const paid = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      assert.equal(paid.status, "PAID");
      assert.equal(paid.stripeLivemode, false);
      assert.equal((await prisma.businessSubmission.findUniqueOrThrow({ where: { id: submission.id } })).status, "PUBLISHED");
      assert.equal(await prisma.businessMembership.count({ where: { business: { submissions: { some: { id: submission.id } } } } }), 1);
      assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id, amountCents: 5000 } }), 1);
      assert.equal(await prisma.partnerCommissionConfirmationDelivery.count({ where: {
        commission: { businessSubmissionId: submission.id },
      } }), 1);
      assert.equal(await prisma.partnerCommission.count({ where: { ...payableCommissionWhere(new Date(Date.now() + 30 * day)), businessSubmissionId: submission.id } }), 0);
      const balance = await getPartnerBalanceSummary(partner.id);
      assert.equal(balance.available, 0);
      assert.equal(balance.pending, 0);
      assert.equal(balance.testActivity, 5000);
      assert.equal(balance.unverifiedActivity, 0);
    }
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("provider payout boundary rejects test and historical payments even when already reserved", async () => {
  for (const stripeLivemode of [false, null, true]) {
    const db = { partnerPayout: { findUnique: async () => ({ amountCents: 5000,
      commissions: [{ amountCents: 5000, status: "RESERVED", type: "COMMISSION",
        payment: { status: "PAID", stripeLivemode } }] }) } };
    if (stripeLivemode === true) await assertPartnerPayoutHasOnlyLivePayments("synthetic-payout", db as never);
    else await assert.rejects(assertPartnerPayoutHasOnlyLivePayments("synthetic-payout", db as never),
      /partner_payout_requires_verified_live_payments/);
  }
});

test("email failure remains pending and retries with the same invitation, without a payment or commission", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const token = deriveInvitationToken(created);
  const failed = await attemptInvitationEmail(created.id, new Date(), async () => { throw new Error("synthetic-provider-failure"); });
  assert.equal(failed, "pending");
  let invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(invitation.emailAcceptedAt, null);
  assert.equal(invitation.emailFailureMessage, "email_provider_failed");
  assert.equal(await startInvitationOtp(token), "unavailable");
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: submission.id } }), 0);
  assert.equal(await attemptInvitationEmail(created.id, new Date(invitation.emailNextAttemptAt!.getTime() + 1), sendEmail as never), "accepted");
  invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(invitation.emailAcceptedGeneration, invitation.tokenGeneration);
  assert.ok(invitation.emailProviderMessageId);
  assert.equal(await attemptInvitationEmail(created.id, new Date(invitation.emailNextAttemptAt?.getTime() ?? Date.now()), sendEmail as never), "skipped");
  await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { revokedAt: new Date() } });
});

test("invitation retry stops before the provider idempotency window expires", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const initial = new Date();
  await attemptInvitationEmail(created.id, initial, async () => { throw new Error("synthetic-provider-failure"); });
  const late = new Date(initial.getTime() + 23 * 60 * 60 * 1000 + 1);
  let sends = 0;
  await attemptInvitationEmail(created.id, late, async () => {
    sends++;
    return { provider: "resend" as const, messageId: "unexpected", success: true };
  });
  const invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(sends, 0);
  assert.equal(invitation.emailNextAttemptAt, null);
  assert.equal(invitation.emailFailureMessage, "delivery_uncertain_requires_review");
});

test("OTP limits and expiry fail closed, unauthorized Partner cannot rotate, expired link preserves draft", async () => {
  const { partner, submission } = await fixture();
  const stranger = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  const token = deriveInvitationToken(created);
  await assert.rejects(createOrRotateInvitation({ partnerUserId: stranger.partner.id, submissionId: submission.id, locale: "en" }), /pay_later_submission_ineligible/);
  await attemptInvitationEmail(created.id, new Date(), sendEmail as never);
  const sentAt = new Date();
  assert.equal(await startInvitationOtp(token, sentAt, sendEmail as never), "sent");
  const firstCode = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(firstCode);
  const wrong = firstCode === "000000" ? "999999" : "000000";
  for (let index = 0; index < 5; index++) assert.equal(await verifyInvitationOtp(token, wrong), null);
  assert.equal(await verifyInvitationOtp(token, firstCode), null);
  assert.equal(await startInvitationOtp(token, new Date(sentAt.getTime() + 2 * 60_000 + 1), sendEmail as never), "sent");
  const secondCode = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(secondCode);
  assert.equal(await verifyInvitationOtp(token, secondCode, new Date(sentAt.getTime() + 13 * 60_000)), null);
  await prisma.businessSubmissionInvitation.update({ where: { id: created.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await getInvitationByToken(token), null);
  assert.ok(await prisma.businessSubmission.findUnique({ where: { id: submission.id } }));
});

test("reminder provider failure retries once under concurrent scheduler runs and stops on opt-out or decline", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
  await attemptInvitationEmail(created.id, new Date(), sendEmail as never);
  const invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
  const dueAt = new Date(invitation.emailAcceptedAt!.getTime() + 3 * day + 1);
  const failed = await runPayLaterReminderJob(dueAt, async () => { throw new Error("synthetic-provider-failure"); });
  assert.equal(failed.sent, 0);
  const reminder = await prisma.businessSubmissionInvitationReminder.findUniqueOrThrow({ where: {
    invitationId_sequence: { invitationId: created.id, sequence: 1 },
  } });
  assert.equal(reminder.failureMessage, "email_provider_failed");
  let count = 0;
  const retry = async () => { count++; return { provider: "resend" as const, messageId: "retry-ok", success: true }; };
  const retryAt = new Date(reminder.nextAttemptAt!.getTime() + 1);
  const results = await Promise.all([runPayLaterReminderJob(retryAt, retry as never), runPayLaterReminderJob(retryAt, retry as never)]);
  assert.equal(results.reduce((sum, row) => sum + row.sent, 0), 1);
  assert.equal(count, 1);
  assert.equal(await closeInvitation(created.id, "stop"), true);
  assert.equal((await runPayLaterReminderJob(new Date(invitation.emailAcceptedAt!.getTime() + 6 * day + 1), retry as never)).sent, 0);
  await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "it" });
  assert.ok((await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } })).remindersStoppedAt);
  const another = await fixture();
  const declined = await createOrRotateInvitation({ partnerUserId: another.partner.id, submissionId: another.submission.id, locale: "it" });
  await attemptInvitationEmail(declined.id, new Date(), sendEmail as never);
  assert.equal(await closeInvitation(declined.id, "decline"), true);
  assert.equal((await runPayLaterReminderJob(new Date(Date.now() + 3 * day + 1_000), retry as never)).sent, 0);
  assert.equal(await prisma.payment.count({ where: { businessSubmissionId: submission.id } }), 0);
});

test("reminder retry stops before the provider idempotency window expires", async () => {
  const { partner, submission } = await fixture();
  const created = await createOrRotateInvitation({ partnerUserId: partner.id, submissionId: submission.id, locale: "en" });
  await attemptInvitationEmail(created.id, new Date(), sendEmail as never);
  const invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
  const dueAt = new Date(invitation.emailAcceptedAt!.getTime() + 3 * day + 1);
  await runPayLaterReminderJob(dueAt, async () => { throw new Error("synthetic-provider-failure"); });
  const late = new Date(dueAt.getTime() + 23 * 60 * 60 * 1000 + 1);
  let sends = 0;
  await runPayLaterReminderJob(late, async () => {
    sends++;
    return { provider: "resend" as const, messageId: "unexpected", success: true };
  });
  const reminder = await prisma.businessSubmissionInvitationReminder.findUniqueOrThrow({
    where: { invitationId_sequence: { invitationId: created.id, sequence: 1 } },
  });
  assert.equal(sends, 0);
  assert.equal(reminder.nextAttemptAt, null);
  assert.equal(reminder.failureMessage, "delivery_uncertain_requires_review");
});
