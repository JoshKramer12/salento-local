import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createRefundFixture } from "../tests/helpers/refund-fixture";

const databaseUrl = process.env.DATABASE_URL ?? "";
const browserPassword = process.env.STAGE4_BROWSER_PASSWORD ?? "";
if (!databaseUrl.startsWith("file:/tmp/salento-stage4-isolated.") ||
    process.env.RAILWAY_ENVIRONMENT_NAME === "production" ||
    process.env.STRIPE_SECRET_KEY || process.env.STAGE4_ISOLATED_TEST !== "true" ||
    browserPassword.length < 20) {
  throw new Error("stage4_browser_fixture_requires_isolated_local_database_and_no_stripe_key");
}

async function main() {
  const old = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000);
  const first = await createRefundFixture(prisma, "stage4-browser-first", old);
  const second = await createRefundFixture(prisma, "stage4-browser-second", old);
  const held = await createRefundFixture(prisma, "stage4-browser-held", new Date());

  for (const fixture of [second, held]) {
    await prisma.businessSubmission.update({ where: { id: fixture.submission.id }, data: { userId: first.partner.id } });
    await prisma.businessMembership.update({ where: { id: fixture.membership.id }, data: { originatingPartnerUserId: first.partner.id } });
    await prisma.payment.update({ where: { id: fixture.payment.id }, data: {
      userId: first.partner.id, partnerUserId: first.partner.id,
    } });
    await prisma.partnerCommission.update({ where: { id: fixture.commission.id }, data: { partnerUserId: first.partner.id } });
  }

  await prisma.user.update({ where: { id: first.partner.id }, data: {
    passwordHash: await bcrypt.hash(browserPassword, 12),
  } });
  await prisma.localPartnerProfile.update({ where: { userId: first.partner.id }, data: {
    preferredPayoutMethod: "STRIPE", stripeConnectedAccountId: "acct_stage4_synthetic_only",
    stripeAccountStatus: "READY", stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true, stripeOnboardingComplete: true,
    stripePayoutAccountLast4: "4821", stripePayoutBankName: "Synthetic Test Bank",
    stripeLastSyncedAt: new Date(),
  } });

  console.log(JSON.stringify({ databaseUrl, partnerEmail: first.partner.email,
    partnerId: first.partner.id, eligibleCents: 10000, pendingCents: 5000,
    warning: "Synthetic live-eligible ledger fixture; no Stripe or customer operation" }));
  await prisma.$disconnect();
}

main().catch(async (error) => { await prisma.$disconnect(); throw error; });
