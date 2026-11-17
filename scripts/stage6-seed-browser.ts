import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createRefundFixture } from "../tests/helpers/refund-fixture";

const databaseUrl = process.env.DATABASE_URL ?? "";
const password = process.env.STAGE6_BROWSER_PASSWORD ?? "";
if (!databaseUrl.startsWith("file:/tmp/salento-stage6-browser.") ||
    process.env.RAILWAY_ENVIRONMENT_NAME === "production" ||
    process.env.STRIPE_SECRET_KEY || process.env.STAGE6_ISOLATED_TEST !== "true" ||
    password.length < 20) {
  throw new Error("stage6_browser_fixture_requires_isolated_local_database_and_no_stripe_key");
}

async function main() {
  const old = new Date(Date.now() - 16 * 86_400_000);
  const passwordHash = await bcrypt.hash(password, 12);
  const states = ["zero", "test-unverified", "pending", "eligible", "below-minimum", "active", "completed", "action-required"] as const;
  for (const state of states) {
    const fixture = await createRefundFixture(prisma, `stage6-${state}`, state === "pending" ? new Date() : old);
    await prisma.user.update({ where: { id: fixture.partner.id }, data: { passwordHash } });
    await prisma.localPartnerProfile.update({ where: { userId: fixture.partner.id }, data: {
      preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: `acct_stage6_synthetic_${state}`,
      stripeAccountStatus: "READY", stripePayoutsEnabled: true, stripeDetailsSubmitted: true,
      stripeOnboardingComplete: true, stripeLastSyncedAt: new Date(),
      stripePayoutAccountLast4: "4821", stripePayoutBankName: "Synthetic Test Bank",
    } });
    if (state === "zero") {
      await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: { status: "REVERSED" } });
    } else if (state === "test-unverified") {
      await prisma.payment.update({ where: { id: fixture.payment.id }, data: { stripeLivemode: false } });
      const other = await createRefundFixture(prisma, "stage6-unverified-extra", old);
      await prisma.businessSubmission.update({ where: { id: other.submission.id }, data: { userId: fixture.partner.id } });
      await prisma.businessMembership.update({ where: { id: other.membership.id }, data: { originatingPartnerUserId: fixture.partner.id } });
      await prisma.payment.update({ where: { id: other.payment.id }, data: { userId: fixture.partner.id, partnerUserId: fixture.partner.id, stripeLivemode: null } });
      await prisma.partnerCommission.update({ where: { id: other.commission.id }, data: { partnerUserId: fixture.partner.id } });
    } else if (state === "below-minimum") {
      await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: { amountCents: 4000 } });
    } else if (state === "active" || state === "action-required") {
      await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: { status: "RESERVED" } });
      const withdrawal = await prisma.partnerWithdrawal.create({ data: {
        partnerUserId: fixture.partner.id, activePartnerUserId: fixture.partner.id,
        requestKey: `stage6-synthetic-${state}`, grossEligibleCents: 5000, requestedAmountCents: 5000,
        status: state === "active" ? "REQUESTED" : "ACTION_REQUIRED",
        stripeConnectedAccountId: `acct_stage6_synthetic_${state}`,
        destinationLast4: "4821", destinationVerifiedAt: new Date(),
      } });
      await prisma.partnerWithdrawalCommission.create({ data: {
        withdrawalId: withdrawal.id, commissionId: fixture.commission.id, amountCents: 5000,
      } });
    } else if (state === "completed") {
      const run = await prisma.partnerPayoutRun.create({ data: {
        runKey: "stage6-synthetic-completed", scheduledFor: old, status: "COMPLETED",
      } });
      const payout = await prisma.partnerPayout.create({ data: {
        payoutRunId: run.id, partnerUserId: fixture.partner.id, amountCents: 5000,
        status: "PAID", paidAt: old,
      } });
      await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: {
        status: "PAID", payoutId: payout.id, paidAt: old,
      } });
      const withdrawal = await prisma.partnerWithdrawal.create({ data: {
        partnerUserId: fixture.partner.id, requestKey: "stage6-synthetic-completed",
        grossEligibleCents: 5000, requestedAmountCents: 5000, status: "PAID",
        stripeConnectedAccountId: `acct_stage6_synthetic_${state}`,
        destinationLast4: "4821", destinationVerifiedAt: old,
        payoutId: payout.id, completedAt: old,
      } });
      await prisma.partnerWithdrawalCommission.create({ data: {
        withdrawalId: withdrawal.id, commissionId: fixture.commission.id, amountCents: 5000,
      } });
    }
  }
  console.log(JSON.stringify({ states, emailTemplate: "partner-stage6-{state}@example.test", isolated: true }));
  await prisma.$disconnect();
}

main().catch(async (error) => { await prisma.$disconnect(); throw error; });
