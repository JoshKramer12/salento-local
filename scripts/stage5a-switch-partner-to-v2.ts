import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { syncPartnerStripeAccountStatus } from "@/lib/partner-connect";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const ORIGINAL_ACCOUNT_ID = "acct_1UXijnGlpytZm7rC";
const TEST_ACCOUNT_ID = "acct_1UXlICGlpyfRSSMc";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const account = await getStripe().accounts.retrieve(TEST_ACCOUNT_ID);
    if (account.country !== "IT" || account.email !== "stage5a-v2-partner@example.test" ||
        account.controller?.stripe_dashboard?.type !== "express" || !account.details_submitted ||
        !account.payouts_enabled || account.capabilities?.transfers !== "active" ||
        account.requirements?.currently_due?.length) {
      throw new Error("stage5a_v2_account_mismatch");
    }
    await prisma.$transaction(async (tx) => {
      const [profile, otherUsers, payments, commissions, payouts, withdrawals] = await Promise.all([
        tx.localPartnerProfile.findUnique({ where: { userId: PARTNER_ID } }),
        tx.user.count({ where: { id: { not: PARTNER_ID } } }),
        tx.payment.count(), tx.partnerCommission.count(), tx.partnerPayout.count(),
        tx.partnerWithdrawal.count(),
      ]);
      if (!profile || ![ORIGINAL_ACCOUNT_ID, TEST_ACCOUNT_ID].includes(profile.stripeConnectedAccountId ?? "") ||
          otherUsers || payments || commissions || payouts || withdrawals) {
        throw new Error("stage5a_v2_switch_has_financial_state");
      }
      const completedAt = profile.completedAt ?? new Date();
      const partnerOnboardingCompletedAt = profile.partnerOnboardingCompletedAt ?? completedAt;
      if (profile.stripeConnectedAccountId === TEST_ACCOUNT_ID) {
        await tx.localPartnerProfile.update({ where: { id: profile.id }, data: {
          completedAt, partnerOnboardingCompletedAt,
        } });
        return;
      }
      await tx.localPartnerProfile.update({ where: { id: profile.id }, data: {
        stripeConnectedAccountId: TEST_ACCOUNT_ID,
        completedAt,
        partnerOnboardingCompletedAt,
        stripeOnboardingComplete: false,
        stripeDetailsSubmitted: false,
        stripePayoutsEnabled: false,
        stripeChargesEnabled: false,
        stripeAccountStatus: "INCOMPLETE",
        stripeDisabledReason: null,
        stripeOnboardingCompletedAt: null,
        stripeLastSyncedAt: null,
        stripeCurrentDeadline: null,
        stripePayoutAccountLast4: null,
        stripePayoutBankName: null,
      } });
    });
    const result = await syncPartnerStripeAccountStatus(PARTNER_ID, { force: true });
    const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: PARTNER_ID } });
    if (result?.connectedAccountId !== TEST_ACCOUNT_ID || !profile ||
        profile.stripeConnectedAccountId !== TEST_ACCOUNT_ID || !profile.stripeOnboardingComplete ||
        profile.stripeAccountStatus !== "READY" || !profile.stripePayoutsEnabled ||
        profile.stripePayoutAccountLast4 !== "3456") {
      throw new Error("stage5a_v2_synced_state_mismatch");
    }
    console.log(JSON.stringify({ partnerId: PARTNER_ID, connectedAccountId: TEST_ACCOUNT_ID,
      localStripeStatus: profile.stripeAccountStatus, payoutsEnabled: profile.stripePayoutsEnabled,
      bankLast4: profile.stripePayoutAccountLast4 }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_v2_partner_switch_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
