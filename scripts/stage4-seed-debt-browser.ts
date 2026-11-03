import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { reversePartnerCommissionForPayment } from "@/lib/partner-ledger";
import { createRefundFixture } from "../tests/helpers/refund-fixture";

const databaseUrl = process.env.DATABASE_URL ?? "";
const browserPassword = process.env.STAGE4_BROWSER_PASSWORD ?? "";
if (!databaseUrl.startsWith("file:/tmp/salento-stage4-isolated.") ||
    process.env.RAILWAY_ENVIRONMENT_NAME === "production" ||
    process.env.STRIPE_SECRET_KEY || process.env.STAGE4_ISOLATED_TEST !== "true" ||
    browserPassword.length < 20) {
  throw new Error("stage4_debt_fixture_requires_isolated_local_database_and_no_stripe_key");
}

async function main() {
  const old = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000);
  const fixture = await createRefundFixture(prisma, "stage4-browser-debt", old);
  await prisma.user.update({ where: { id: fixture.partner.id }, data: {
    passwordHash: await bcrypt.hash(browserPassword, 12),
  } });
  await prisma.localPartnerProfile.update({ where: { userId: fixture.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: "acct_stage4_debt_synthetic_only",
    stripeAccountStatus: "READY", stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true, stripeOnboardingComplete: true,
    stripePayoutAccountLast4: "4821", stripePayoutBankName: "Synthetic Test Bank",
    stripeLastSyncedAt: new Date(),
  } });
  const run = await prisma.partnerPayoutRun.create({ data: {
    runKey: "stage4-browser-debt-paid-run", scheduledFor: old, status: "COMPLETED",
  } });
  const payout = await prisma.partnerPayout.create({ data: {
    payoutRunId: run.id, partnerUserId: fixture.partner.id, amountCents: 5000,
    status: "PAID", paidAt: old,
  } });
  await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: {
    status: "PAID", payoutId: payout.id, paidAt: old,
  } });
  await reversePartnerCommissionForPayment({
    eventType: "charge.refunded", reason: "isolated_stage4_refund",
    sourceEventId: "stage4-browser-debt-refund", paymentId: fixture.payment.id,
  }, { revalidatePaths: () => {} });
  await prisma.payment.update({ where: { id: fixture.payment.id }, data: { status: "REFUNDED" } });
  console.log(JSON.stringify({ partnerEmail: fixture.partner.email,
    debtCents: 5000, warning: "Synthetic paid/refund evidence only; no Stripe or customer operation" }));
  await prisma.$disconnect();
}

main().catch(async (error) => { await prisma.$disconnect(); throw error; });
