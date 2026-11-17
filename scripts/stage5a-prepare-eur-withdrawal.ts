import { addUtcDays } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { getPartnerWithdrawableBalance, requestPartnerWithdrawal } from "@/lib/partner-withdrawals";
import { withVerifiedStage5aSandbox } from "@/lib/partner-withdrawal-sandbox-context";

const PARTNER_ID = "partner-stage5a-primary";
const CONNECTED_ID = "acct_1UXlICGlpyfRSSMc";
const PAYMENT_INTENT_ID = "pi_3UXlsVGlpy5eeaBP1e2gNFJ1";
const BUSINESS_ID = "business-stage5a-eur";
const SUBMISSION_ID = "submission-stage5a-eur";
const PAYMENT_ID = "payment-stage5a-eur";
const COMMISSION_ID = "commission-stage5a-eur";
const REQUEST_KEY = "stage5a-eur-withdrawal-0001";

async function main() {
  await withVerifiedStage5aSandbox(PARTNER_ID, async () => {
    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(PAYMENT_INTENT_ID);
    if (intent.status !== "succeeded" || intent.livemode !== false ||
        intent.amount !== 10000 || intent.currency !== "eur" ||
        intent.metadata.stage5a_synthetic !== "true" ||
        intent.metadata.stage5a_purpose !== "cashout-commission-funding") {
      throw new Error("stage5a_eur_payment_mismatch");
    }
    const chargeId = typeof intent.latest_charge === "string"
      ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) throw new Error("stage5a_eur_charge_missing");
    const charge = await stripe.charges.retrieve(chargeId);
    const transactionId = typeof charge.balance_transaction === "string"
      ? charge.balance_transaction : charge.balance_transaction?.id;
    if (!transactionId || !charge.paid || !charge.captured || charge.livemode !== false ||
        charge.amount !== 10000 || charge.currency !== "eur") {
      throw new Error("stage5a_eur_charge_mismatch");
    }
    const transaction = await stripe.balanceTransactions.retrieve(transactionId);
    if (transaction.currency !== "eur" || transaction.amount !== 10000 ||
        transaction.net < 5000 || transaction.source !== chargeId) {
      throw new Error("stage5a_eur_settlement_mismatch");
    }
    const paidAt = new Date(charge.created * 1000);
    await prisma.$transaction(async (tx) => {
      const [partner, profile, existingPayments, existingCommissions, existingWithdrawals] = await Promise.all([
        tx.user.findUnique({ where: { id: PARTNER_ID } }),
        tx.localPartnerProfile.findUnique({ where: { userId: PARTNER_ID } }),
        tx.payment.count({ where: { id: { not: PAYMENT_ID } } }),
        tx.partnerCommission.count({ where: { id: { not: COMMISSION_ID } } }),
        tx.partnerWithdrawal.count({ where: { requestKey: { not: REQUEST_KEY } } }),
      ]);
      if (!partner || partner.email !== "stage5a-partner@example.test" ||
          profile?.stripeConnectedAccountId !== CONNECTED_ID ||
          profile.stripeAccountStatus !== "READY" || !profile.stripePayoutsEnabled ||
          existingPayments || existingCommissions || existingWithdrawals) {
        throw new Error("stage5a_eur_fixture_not_isolated");
      }
      const town = await tx.town.upsert({ where: { id: "stage5a-eur-town" }, update: {},
        create: { id: "stage5a-eur-town", slug: "stage5a-eur-town", name: "Lecce",
          province: "LE", shortDescription: "Synthetic town", intro: "Test", history: "Test",
          practicalInfo: "Test", heroImageSeed: "test", latitude: 40.35, longitude: 18.17 } });
      const category = await tx.category.upsert({ where: { id: "stage5a-eur-category" }, update: {},
        create: { id: "stage5a-eur-category", slug: "stage5a-eur-category", name: "Tours",
          description: "Synthetic tours", icon: "tour", group: "TOURISM" } });
      await tx.business.upsert({ where: { id: BUSINESS_ID }, update: {}, create: {
        id: BUSINESS_ID, slug: BUSINESS_ID, name: "Stage 5A Synthetic Tour",
        address: "Synthetic test address, Lecce", shortDescription: "Test only",
        description: "Synthetic business for isolated Stripe Connect test",
        heroImageSeed: "test", latitude: 40.35, longitude: 18.17,
        townId: town.id, categoryId: category.id,
      } });
      await tx.businessSubmission.upsert({ where: { id: SUBMISSION_ID }, update: {}, create: {
        id: SUBMISSION_ID, userId: PARTNER_ID, status: "PUBLISHED", businessName: "Stage 5A Synthetic Tour",
        townId: town.id, categoryId: category.id, address: "Synthetic test address, Lecce",
        googleMapsUrl: "https://maps.google.com", phone: "+393200000001",
        whatsapp: "+393200000001", email: "stage5a-business@example.test", openingHours: "9-18",
        shortDescription: "Test only", longDescription: "Synthetic Stripe sandbox fixture",
        ownerName: "Test Owner", ownerPhone: "+393200000002",
        ownerEmail: "stage5a-owner@example.test", createdBusinessId: BUSINESS_ID,
        paymentStatus: "PAID", amountPaidCents: 10000, amountOwedCents: 0,
      } });
      await tx.businessMembership.upsert({ where: { businessId: BUSINESS_ID }, update: {}, create: {
        businessId: BUSINESS_ID, annualPriceCents: 10000, currentPeriodStart: paidAt,
        currentPeriodEnd: addUtcDays(paidAt, 365), graceEndsAt: addUtcDays(paidAt, 379),
        originatingPartnerUserId: PARTNER_ID,
      } });
      const payment = await tx.payment.upsert({ where: { id: PAYMENT_ID }, update: {}, create: {
        id: PAYMENT_ID, businessSubmissionId: SUBMISSION_ID, businessId: BUSINESS_ID,
        userId: PARTNER_ID, partnerUserId: PARTNER_ID, amountCents: 10000,
        currency: "eur", method: "STRIPE_CHECKOUT", purpose: "ANNUAL_RENEWAL",
        status: "PAID", paidAt, stripePaymentIntentId: intent.id, stripeLivemode: false,
      } });
      if (payment.stripePaymentIntentId !== intent.id || payment.stripeLivemode !== false ||
          payment.amountCents !== 10000 || payment.purpose !== "ANNUAL_RENEWAL") {
        throw new Error("stage5a_eur_local_payment_mismatch");
      }
      const commission = await tx.partnerCommission.upsert({ where: { id: COMMISSION_ID }, update: {}, create: {
        id: COMMISSION_ID, partnerUserId: PARTNER_ID, businessSubmissionId: SUBMISSION_ID,
        businessId: BUSINESS_ID, paymentId: PAYMENT_ID, amountCents: 5000,
        currency: "eur", type: "COMMISSION", status: "PENDING",
        sourceKey: "stage5a:synthetic:eur:commission", earnedAt: paidAt, eligibleAt: paidAt,
        stripePaymentIntentId: intent.id, stripeChargeId: charge.id,
      } });
      if (commission.amountCents !== 5000 || commission.paymentId !== PAYMENT_ID) {
        throw new Error("stage5a_eur_commission_mismatch");
      }
    });
    const auth = { authenticate: async () => ({ id: PARTNER_ID, role: "GETTER" as const,
      profileCompleted: true }), expectedAmountCents: 5000 };
    const existing = await prisma.partnerWithdrawal.findUnique({
      where: { partnerUserId_requestKey: { partnerUserId: PARTNER_ID, requestKey: REQUEST_KEY } },
    });
    if (!existing) {
      const before = await getPartnerWithdrawableBalance(auth);
      if (before.withdrawableCents !== 5000 || !before.destinationReady) {
        throw new Error("stage5a_eur_balance_mismatch");
      }
    }
    const withdrawal = await requestPartnerWithdrawal(REQUEST_KEY, auth);
    const again = await requestPartnerWithdrawal(REQUEST_KEY, auth);
    const allocations = await prisma.partnerWithdrawalCommission.findMany({
      where: { withdrawalId: withdrawal.id },
    });
    const commission = await prisma.partnerCommission.findUnique({ where: { id: COMMISSION_ID } });
    if (withdrawal.id !== again.id || withdrawal.requestedAmountCents !== 5000 ||
        withdrawal.currency !== "eur" || withdrawal.status !== "REQUESTED" ||
        withdrawal.stripeConnectedAccountId !== CONNECTED_ID ||
        allocations.length !== 1 || allocations[0].amountCents !== 5000 ||
        commission?.status !== "RESERVED") {
      throw new Error("stage5a_eur_reservation_mismatch");
    }
    console.log(JSON.stringify({ paymentIntentId: intent.id, balanceTransactionId: transaction.id,
      settlementStatus: transaction.status, settlementNetCents: transaction.net,
      withdrawalId: withdrawal.id, requestedAmountCents: withdrawal.requestedAmountCents,
      commissionStatus: commission.status, duplicateRequestReturnedSameId: again.id === withdrawal.id }));
  });
}

main().catch((error: unknown) => {
  const known = error instanceof Error && error.message.startsWith("stage5a_")
    ? error.message : "stage5a_eur_withdrawal_preparation_failed";
  console.error(known);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
