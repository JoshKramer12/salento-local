import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXijnGlpytZm7rC";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const account = await getStripe().accounts.retrieve(CONNECTED_ID);
    if (account.country !== "IT" || account.email !== "stage5a-partner@example.test" ||
        account.controller?.stripe_dashboard?.type !== "express") {
      throw new Error("stage5a_connected_account_mismatch");
    }
    const otherUsers = await prisma.user.count({ where: { id: { not: PARTNER_ID } } });
    if (otherUsers) throw new Error("stage5a_database_not_empty_of_other_users");
    const user = await prisma.user.upsert({ where: { id: PARTNER_ID },
      update: {}, create: { id: PARTNER_ID, username: PARTNER_ID,
        email: "stage5a-partner@example.test", name: "Stage 5A Synthetic Partner",
        role: "GETTER", profileCompleted: true } });
    const profile = await prisma.localPartnerProfile.upsert({ where: { userId: user.id },
      update: {}, create: { userId: user.id, fullName: "Stage 5A Synthetic Partner",
        legalFullName: "Stage 5A Synthetic Partner", phone: "+393200000001",
        baseTownOrArea: "Lecce", preferredLanguage: "en",
        billingAddress: "Synthetic test address", taxIdOrVatNumber: "TEST-ONLY",
        stripeConnectedAccountId: CONNECTED_ID, preferredPayoutMethod: "STRIPE" } });
    if (profile.stripeConnectedAccountId !== CONNECTED_ID ||
        profile.stripePayoutsEnabled || profile.stripeOnboardingComplete) {
      throw new Error("stage5a_profile_readiness_mismatch");
    }
    console.log(JSON.stringify({ partnerId: user.id, connectedAccountId: CONNECTED_ID,
      localStripeStatus: profile.stripeAccountStatus, payoutsEnabled: profile.stripePayoutsEnabled }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_partner_seed_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
