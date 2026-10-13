import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AdminWithdrawalActions } from "@/components/account/admin-withdrawal-actions";
import { PartnerCashoutConfirmation } from "@/components/account/partner-cashout-confirmation";
import test, { after } from "node:test";
import { PartnerCashoutOverview } from "@/components/account/partner-cashout-overview";
import { addUtcDays } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import { encryptPayoutDestination } from "@/lib/partner-payout-methods";
import { getPartnerWithdrawalDashboard, withdrawalProcessingEnabled } from "@/lib/partner-withdrawal-dashboard";
import { createWithdrawalIdempotencyKey, recoverAcceptedWithdrawal } from "@/lib/partner-withdrawal-recovery";
import { availableWithdrawalAdminActions, cashoutBlockReason, maskWithdrawalDestination, withdrawalAuditReason, withdrawalBlockMessage, withdrawalErrorMessage, withdrawalStatusLabel } from "@/lib/partner-withdrawal-view";
import { createPartnerWithdrawalRequest } from "@/lib/partner-withdrawals";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-withdrawal-ui-"));
const dbPath = join(directory, "isolated.db");
writeFileSync(dbPath, "");
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PAYOUT_DATA_ENCRYPTION_KEY = "synthetic-ui-test-key";
process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
process.env.PARTNER_CASHOUT_PROCESSING_ENABLED = "false";
process.env.PARTNER_PAYOUT_MODE = "cashout";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
execFileSync("sqlite3", [dbPath, 'CREATE UNIQUE INDEX "PartnerWithdrawalRequest_one_unresolved_per_partner_key" ON "PartnerWithdrawalRequest"("partnerUserId") WHERE "status" NOT IN (\'PAID\', \'CANCELED\')']);
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
async function fixture(amountCents = 5000) {
  const f = await createRefundFixture(prisma, `cashout-ui-${++sequence}`, addUtcDays(new Date(), -20));
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { amountCents } });
  await prisma.localPartnerProfile.update({ where: { userId: f.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", payoutSetupStatus: "READY", stripeAccountStatus: "READY",
    stripePayoutsEnabled: true, stripeConnectedAccountId: `acct_${f.partner.id}`, stripePayoutAccountLast4: "1234",
  } });
  return f;
}

test("available, pending, processing, and paid come from the ledger without placeholders", async () => {
  const f = await fixture();
  const recentPayment = await prisma.payment.create({ data: {
    businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id,
    amountCents: 10000, method: "STRIPE_CHECKOUT", purpose: "INITIAL_MEMBERSHIP", status: "PAID", paidAt: new Date(),
  } });
  await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, businessId: f.business.id,
    paymentId: recentPayment.id, amountCents: 2000, type: "COMMISSION", status: "PENDING", sourceKey: `ui-pending:${f.partner.id}`, eligibleAt: addUtcDays(new Date(), 14) } });
  await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessSubmissionId: f.submission.id,
    amountCents: 1000, type: "COMMISSION", status: "PENDING", sourceKey: `ui-placeholder:${f.partner.id}` } });
  const before = await getPartnerWithdrawalDashboard(f.partner.id);
  assert.deepEqual([before.availableCents, before.pendingCents, before.processingCents, before.paidCents], [5000, 2000, 0, 0]);
  assert.equal(before.recentEarnings.length, 2);
  assert.equal(before.canRequest, true);
  assert.equal(before.destinationMasked, "•••• 1234");
  const key = createWithdrawalIdempotencyKey("12345678-1234-1234-1234-123456789abc");
  const created = await createPartnerWithdrawalRequest({ partnerUserId: f.partner.id, idempotencyKey: key });
  const afterRequest = await getPartnerWithdrawalDashboard(f.partner.id);
  assert.deepEqual([afterRequest.availableCents, afterRequest.pendingCents, afterRequest.processingCents, afterRequest.paidCents], [0, 2000, 5000, 0]);
  assert.equal(afterRequest.blockReason, "unresolved");
  assert.equal(afterRequest.history[0].status, "REQUESTED");
  assert.equal(afterRequest.history[0].destinationMasked.includes("acct_"), false);
  assert.equal(recoverAcceptedWithdrawal(afterRequest, key)?.id, created.id);
  assert.equal(recoverAcceptedWithdrawal(afterRequest, "different-key"), null);
  const request = await prisma.partnerWithdrawalRequest.findUniqueOrThrow({ where: { id: created.id } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PAID", paidAt: new Date() } });
  await prisma.partnerPayout.update({ where: { id: request.payoutId }, data: { status: "PAID", paidAt: new Date() } });
  await prisma.partnerWithdrawalRequest.update({ where: { id: created.id }, data: { status: "PAID", settlementVerifiedAt: new Date() } });
  const afterPaid = await getPartnerWithdrawalDashboard(f.partner.id);
  assert.deepEqual([afterPaid.availableCents, afterPaid.pendingCents, afterPaid.processingCents, afterPaid.paidCents], [0, 2000, 0, 5000]);
  assert.ok(afterPaid.history[0].settledAt);
});

test("feature flags, minimum, destination, open request, and debt produce safe UI states", async () => {
  const low = await fixture(4900);
  assert.equal((await getPartnerWithdrawalDashboard(low.partner.id)).blockReason, "minimum");
  assert.match(withdrawalBlockMessage("minimum", "en", "€50.00"), /€50.00/);
  await prisma.localPartnerProfile.update({ where: { userId: low.partner.id }, data: { stripePayoutsEnabled: false } });
  assert.equal((await getPartnerWithdrawalDashboard(low.partner.id)).blockReason, "setup");
  await prisma.localPartnerProfile.update({ where: { userId: low.partner.id }, data: { preferredPayoutMethod: "HYPE", payoutSetupStatus: "READY", bankPayoutIbanEncrypted: encryptPayoutDestination("IT00INVALID"), bankPayoutAccountLast4: "0000" } });
  assert.equal((await getPartnerWithdrawalDashboard(low.partner.id)).blockReason, "setup");
  process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "false";
  assert.equal((await getPartnerWithdrawalDashboard(low.partner.id)).blockReason, "disabled");
  assert.equal(withdrawalProcessingEnabled(), false);
  process.env.PARTNER_CASHOUT_REQUESTS_ENABLED = "true";
  const debt = await fixture();
  await prisma.partnerCommission.create({ data: { partnerUserId: debt.partner.id, businessId: debt.business.id,
    businessSubmissionId: debt.submission.id, paymentId: debt.payment.id, amountCents: -5000,
    type: "REVERSAL", status: "DEBT", sourceKey: `ui-debt:${debt.partner.id}` } });
  assert.equal((await getPartnerWithdrawalDashboard(debt.partner.id)).blockReason, "debt");
});

test("bilingual labels, masking, and responsive balance/history markup", async () => {
  assert.equal(withdrawalStatusLabel("ACTION_REQUIRED", "en"), "Needs attention");
  assert.equal(withdrawalStatusLabel("ACTION_REQUIRED", "it"), "Richiede attenzione");
  assert.equal(withdrawalAuditReason("destination_revealed", "it"), "Dati bancari visualizzati");
  assert.match(withdrawalErrorMessage("settlement_evidence_required", "en"), /20 characters/);
  assert.equal(maskWithdrawalDestination("PAYPAL", "person@example.test"), "pe••••@example.test");
  assert.equal(cashoutBlockReason({ enabled: true, available: 5000, minimum: 5000, setupReady: true, unresolved: false, debt: false, held: 0 }), null);
  const f = await fixture();
  const data = await getPartnerWithdrawalDashboard(f.partner.id);
  const en = renderToStaticMarkup(createElement(PartnerCashoutOverview, { data, locale: "en" }));
  const it = renderToStaticMarkup(createElement(PartnerCashoutOverview, { data, locale: "it" }));
  assert.match(en, /Available to withdraw/);
  assert.match(en, /Cash out/);
  assert.match(en, /Pending/);
  assert.match(en, /Processing/);
  assert.match(en, /Net paid out/);
  assert.match(en, /Recent earnings/);
  assert.match(en, /Withdrawal history/);
  assert.match(it, /Disponibile da prelevare/);
  assert.match(it, /Storico prelievi/);
  assert.match(en, /w-full/);
  assert.match(en, /sm:grid-cols-3/);
  const blocked = renderToStaticMarkup(createElement(PartnerCashoutOverview, { data: { ...data, canRequest: false, blockReason: "minimum" }, locale: "en" }));
  assert.doesNotMatch(blocked, /href="\/dashboard\/earnings\/cash-out"/);
});

test("Admin action availability follows provider and transfer state", () => {
  const stripe = availableWithdrawalAdminActions("STRIPE", "REQUESTED", false, false);
  assert.equal(stripe.process, true);
  assert.equal(stripe.reconcile, false);
  const pendingStripe = availableWithdrawalAdminActions("STRIPE", "PROCESSING", true, false);
  assert.equal(pendingStripe.process, false);
  assert.equal(pendingStripe.reconcile, true);
  const paypal = availableWithdrawalAdminActions("PAYPAL", "ACTION_REQUIRED", true, false);
  assert.equal(paypal.process, false);
  assert.equal(paypal.reconcile, true);
  const manualBefore = availableWithdrawalAdminActions("POSTEPAY", "PROCESSING", false, false);
  assert.equal(manualBefore.recordTransfer, true);
  assert.equal(manualBefore.cancelUnsent, true);
  const manualSent = availableWithdrawalAdminActions("HYPE", "PROCESSING", false, true);
  assert.equal(manualSent.cancelUnsent, false);
  assert.equal(manualSent.settleOrFlag, true);
  const paid = availableWithdrawalAdminActions("STRIPE", "PAID", true, false);
  assert.equal(paid.process || paid.reconcile, false);
  assert.equal(availableWithdrawalAdminActions("HYPE", "PAID", false, true).flagAfterSettlement, true);
});

test("confirmation and Admin controls render only actions allowed by state and feature gate", async () => {
  const f = await fixture();
  const data = await getPartnerWithdrawalDashboard(f.partner.id);
  const render = (node: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: {} as never }, node));
  const confirmation = render(createElement(PartnerCashoutConfirmation, { initialData: data, locale: "en" }));
  assert.match(confirmation, /Confirm cash out/);
  assert.match(confirmation, /full available balance/);
  assert.doesNotMatch(confirmation, /type="number"/);
  const common = { id: "sample", dispatchStarted: false, manualInitiated: false, canContinueStripe: false, needsPaypalBatch: false, returnRecorded: false, returnCreditApproved: false, amountCents: 5000 };
  const disabled = render(createElement(AdminWithdrawalActions, { ...common, locale: "en", method: "STRIPE", status: "REQUESTED", processingEnabled: false, reconciliationEnabled: false }));
  assert.match(disabled, /Processing and reconciliation are disabled/);
  assert.doesNotMatch(disabled, /Start provider processing/);
  const stripe = render(createElement(AdminWithdrawalActions, { ...common, locale: "en", method: "STRIPE", status: "REQUESTED", processingEnabled: true, reconciliationEnabled: true }));
  assert.match(stripe, /Start provider processing/);
  assert.match(stripe, /Check evidence/);
  assert.doesNotMatch(stripe, /View bank details/);
  const paypal = render(createElement(AdminWithdrawalActions, { ...common, locale: "en", method: "PAYPAL", status: "PROCESSING", dispatchStarted: true, processingEnabled: false, reconciliationEnabled: true, needsPaypalBatch: true }));
  assert.match(paypal, /Reconcile provider status/);
  assert.match(paypal, /Attach existing PayPal batch/);
  assert.doesNotMatch(paypal, /Start provider processing/);
  const bank = render(createElement(AdminWithdrawalActions, { ...common, locale: "it", method: "POSTEPAY", status: "PROCESSING", processingEnabled: true, reconciliationEnabled: true }));
  assert.match(bank, /Visualizza dati bancari/);
  assert.match(bank, /Registra bonifico/);
  assert.doesNotMatch(bank, /IT60X0542811101000000123456/);
});
