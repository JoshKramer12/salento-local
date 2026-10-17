import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { prisma } from "@/lib/prisma";
import { addUtcDays } from "@/lib/business-membership";
import { selectPartnerPaidBusinesses, selectPartnerPaidBusinessCommissions, getPartnerCommissionDisplay } from "@/lib/partner-dashboard-display";
import { payableCommissionWhere } from "@/lib/partner-ledger";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";
import { createRefundFixture } from "./helpers/refund-fixture";

const directory = mkdtempSync(join(tmpdir(), "salento-dashboard-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });
const now = new Date("2026-09-28T12:00:00Z");
let sequence = 0;
const fixture = (daysAgo = 1) => createRefundFixture(prisma, `dashboard-${++sequence}`, addUtcDays(now, -daysAgo));
async function dashboard(partnerId: string) {
  const rows = await prisma.businessSubmission.findMany({ where: { userId: partnerId }, include: {
    createdBusiness: true,
    payments: { orderBy: { createdAt: "desc" } },
    partnerCommissions: { include: { payment: true } },
  } });
  const payable = await prisma.partnerCommission.findMany({ where: { ...payableCommissionWhere(now), partnerUserId: partnerId }, select: { id: true } });
  const paid = selectPartnerPaidBusinesses(rows);
  const ledger = rows.flatMap((row) => row.partnerCommissions);
  return { paid, display: (id: string, locale: "en" | "it" = "en") => getPartnerCommissionDisplay(ledger.find((row) => row.id === id)!, ledger, new Set(payable.map((row) => row.id)), locale) };
}

test("dashboard route applies the tested selector before passing cards, and uses existing payout eligibility", () => {
  const route = readFileSync("src/app/(account)/dashboard/page.tsx", "utf8");
  assert.match(route, /const paidBusinesses = selectPartnerPaidBusinesses\(submissions\)/);
  assert.match(route, /submissions=\{paidBusinesses\}/);
  assert.match(route, /selectPartnerPaidBusinessCommissions\(partnerRecentCommissions, paidBusinesses\)\.slice\(0, 5\)/);
  assert.match(route, /payableCommissionWhere\(dashboardNow\)/);
});

test("pure draft, incomplete and unpaid submissions are excluded and still queryable as drafts", async () => {
  for (const status of ["DRAFT", "AWAITING_VERIFICATION", "AWAITING_PAYMENT"] as const) {
    const f = await fixture();
    await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "PENDING_PAYMENT", paidAt: null } });
    await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { status, paymentStatus: "PENDING_PAYMENT", createdBusinessId: null, amountPaidCents: 0 } });
    const before = await prisma.businessSubmission.count();
    assert.equal((await dashboard(f.partner.id)).paid.length, 0);
    assert.equal(await prisma.businessSubmission.count(), before);
    if (status === "DRAFT") assert.equal(await prisma.businessSubmission.count({ where: buildDraftLikeSubmissionWhere(f.partner.id) }), 1);
  }
});

test("submission PAID label, empty Business, failed payment and zero payment cannot establish paid history", async () => {
  const f = await fixture();
  for (const data of [{ status: "FAILED" as const }, { status: "PAID" as const, amountCents: 0 }]) {
    await prisma.payment.update({ where: { id: f.payment.id }, data });
    assert.equal((await dashboard(f.partner.id)).paid.length, 0);
  }
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "PAID", amountCents: 10000 } });
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { createdBusinessId: null } });
  assert.equal((await dashboard(f.partner.id)).paid.length, 0);
});

test("paid membership in refund hold is included with yellow, even if old eligibleAt is early", async () => {
  const f = await fixture();
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { eligibleAt: addUtcDays(now, -1), status: "AVAILABLE" } });
  const d = await dashboard(f.partner.id);
  assert.equal(d.paid.length, 1); assert.equal(d.display(f.commission.id).tone, "yellow");
});

test("exact day 14 eligibility is green from the authoritative payout query, even for PENDING ledger status", async () => {
  const f = await fixture(14); const d = await dashboard(f.partner.id);
  assert.equal(d.paid.length, 1);
  assert.equal(d.display(f.commission.id).tone, "green"); assert.match(d.display(f.commission.id).label, /Available/);
  assert.match(d.display(f.commission.id, "it").label, /Disponibile/);
});

test("test and unverified payments never become payable after the hold period", async () => {
  for (const stripeLivemode of [false, null]) {
    const f = await fixture(30);
    await prisma.payment.update({ where: { id: f.payment.id }, data: { stripeLivemode } });
    const eligible = await prisma.partnerCommission.count({ where: {
      ...payableCommissionWhere(now), partnerUserId: f.partner.id,
    } });
    assert.equal(eligible, 0);
    assert.equal((await dashboard(f.partner.id)).display(f.commission.id).tone, "yellow");
  }
});

test("requested, processing, action-required, support and failed refunds remain yellow, never cancelled", async () => {
  const f = await fixture(30);
  for (const refundStatus of ["requested", "pending", "requires_action", "support_required", "failed", "canceled"]) {
    await prisma.payment.update({ where: { id: f.payment.id }, data: { refundRequestedAt: now, refundStatus } });
    const d = await dashboard(f.partner.id);
    assert.equal(d.paid.length, 1); assert.equal(d.display(f.commission.id).tone, "yellow");
    assert.doesNotMatch(d.display(f.commission.id).label, /cancelled|Refunded/);
  }
  await prisma.payment.update({ where: { id: f.payment.id }, data: { refundStatus: "support_closed" } });
  assert.equal((await dashboard(f.partner.id)).display(f.commission.id).tone, "green");
});

test("completed refund and reversed commission stay visible historically in red", async () => {
  const f = await fixture(30);
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "REFUNDED", refundedAt: now, refundedAmountCents: 10000, refundStatus: "succeeded" } });
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "REVERSED" } });
  await prisma.businessMembership.update({ where: { id: f.membership.id }, data: { entitlementRevokedAt: now } });
  const before = { businesses: await prisma.business.count(), payments: await prisma.payment.count(), submissions: await prisma.businessSubmission.count() };
  const d = await dashboard(f.partner.id);
  assert.equal(d.paid.length, 1); assert.equal(d.display(f.commission.id).tone, "red");
  assert.match(d.display(f.commission.id).label, /Refunded.*cancelled/);
  assert.match(d.display(f.commission.id, "it").label, /Rimborsata.*annullata/);
  assert.deepEqual({ businesses: await prisma.business.count(), payments: await prisma.payment.count(), submissions: await prisma.businessSubmission.count() }, before);
});

test("expired membership and legacy Business with exact submission payment link remain visible", async () => {
  const f = await fixture(400);
  assert.equal((await dashboard(f.partner.id)).paid.length, 1);
  assert.equal((await dashboard(f.partner.id)).display(f.commission.id).tone, "green");
  await prisma.businessMembership.delete({ where: { id: f.membership.id } });
  await prisma.payment.update({ where: { id: f.payment.id }, data: { businessId: null } });
  assert.equal((await dashboard(f.partner.id)).paid.length, 1);
  const other = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { businessId: other.business.id } });
  assert.equal((await dashboard(f.partner.id)).paid.length, 0);
});

test("paid reversal debt is matched by exact commission ID; missing attribution cannot appear available", async () => {
  const f = await fixture(30);
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PAID" } });
  assert.equal((await dashboard(f.partner.id)).display(f.commission.id).tone, "green");
  await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, paymentId: f.payment.id, businessSubmissionId: f.submission.id, type: "REVERSAL", status: "DEBT", amountCents: -5000, sourceKey: `commission:reversal:${f.commission.id}` } });
  assert.equal((await dashboard(f.partner.id)).display(f.commission.id).tone, "red");
  await prisma.partnerCommission.update({ where: { id: f.commission.id }, data: { status: "PENDING", paymentId: null } });
  // A different unresolved historical commission has no payout-query evidence.
  const unresolved = await prisma.partnerCommission.create({ data: { partnerUserId: f.partner.id, businessSubmissionId: f.submission.id, type: "COMMISSION", status: "PENDING", amountCents: 5000, sourceKey: "commission:submission:unresolved" } });
  assert.equal((await dashboard(f.partner.id)).display(unresolved.id).tone, "yellow");
});

test("renewal stays payment-specific and neither creates nor rewrites the initial commission", async () => {
  const f = await fixture(400);
  const payment = await prisma.payment.create({ data: { businessSubmissionId: f.submission.id, businessId: f.business.id, userId: f.partner.id, partnerUserId: f.partner.id, method: "STRIPE_CHECKOUT", amountCents: 10000, purpose: "REACTIVATION", status: "PAID", paidAt: now, stripeLivemode: true } });
  const commission = await prisma.partnerCommission.create({ data: { businessSubmissionId: f.submission.id, businessId: f.business.id, paymentId: payment.id, partnerUserId: f.partner.id, amountCents: 1500, type: "COMMISSION", status: "PENDING", eligibleAt: now, sourceKey: `commission:renewal:${payment.id}` } });
  const d = await dashboard(f.partner.id);
  assert.equal(d.paid.length, 1); assert.equal(d.display(commission.id).tone, "green");
  assert.equal((await prisma.partnerCommission.findUniqueOrThrow({ where: { id: f.commission.id } })).paymentId, f.payment.id);
  assert.equal(await prisma.partnerCommission.count({ where: { businessSubmissionId: f.submission.id, amountCents: 5000 } }), 1);
});


test("pre-payment commission placeholders cannot enter recent earnings or crowd out paid history", async () => {
  const f = await fixture();
  await prisma.payment.update({ where: { id: f.payment.id }, data: { status: "PENDING_PAYMENT", paidAt: null } });
  await prisma.businessSubmission.update({ where: { id: f.submission.id }, data: { status: "AWAITING_PAYMENT", createdBusinessId: null } });
  const unpaid = await dashboard(f.partner.id);
  assert.equal(selectPartnerPaidBusinessCommissions([f.commission], unpaid.paid).length, 0);
  const paidFixture = await fixture(30);
  const paid = await dashboard(paidFixture.partner.id);
  const placeholders = Array.from({ length: 6 }, (_, i) => ({ ...f.commission, id: `placeholder-${i}` }));
  assert.deepEqual(selectPartnerPaidBusinessCommissions([...placeholders, paidFixture.commission], paid.paid).slice(0, 5).map((row) => row.id), [paidFixture.commission.id]);
});
