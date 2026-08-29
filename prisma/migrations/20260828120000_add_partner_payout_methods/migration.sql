-- Preserve all existing Stripe-connected Partners by making Stripe the default.
CREATE TABLE "new_LocalPartnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "legalFullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "baseTownOrArea" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL,
    "heardAbout" TEXT,
    "birthDate" DATETIME,
    "billingAddress" TEXT NOT NULL,
    "taxIdOrVatNumber" TEXT NOT NULL,
    "understandsNoCash" BOOLEAN NOT NULL DEFAULT false,
    "understandsNoPricing" BOOLEAN NOT NULL DEFAULT false,
    "understandsNoNegotiation" BOOLEAN NOT NULL DEFAULT false,
    "understandsDirectPayment" BOOLEAN NOT NULL DEFAULT false,
    "stripeConnectedAccountId" TEXT,
    "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeRequirementsDue" JSONB,
    "stripeAccountStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "stripeDisabledReason" TEXT,
    "stripeOnboardingStartedAt" DATETIME,
    "stripeOnboardingCompletedAt" DATETIME,
    "stripeLastSyncedAt" DATETIME,
    "stripeCurrentDeadline" DATETIME,
    "stripePayoutAccountLast4" TEXT,
    "stripePayoutBankName" TEXT,
    "preferredPayoutMethod" TEXT NOT NULL DEFAULT 'STRIPE',
    "payoutSetupStatus" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "payoutMethodUpdatedAt" DATETIME,
    "paypalPayoutEmail" TEXT,
    "bankPayoutIbanEncrypted" TEXT,
    "bankPayoutAccountLast4" TEXT,
    "bankPayoutAccountHolder" TEXT,
    "partnerGuideCompleted" BOOLEAN NOT NULL DEFAULT false,
    "partnerGuideVersion" INTEGER NOT NULL DEFAULT 0,
    "partnerOnboardingCompletedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocalPartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LocalPartnerProfile" (
  "id", "userId", "fullName", "legalFullName", "phone", "whatsapp", "baseTownOrArea", "preferredLanguage", "heardAbout", "birthDate", "billingAddress", "taxIdOrVatNumber", "understandsNoCash", "understandsNoPricing", "understandsNoNegotiation", "understandsDirectPayment", "stripeConnectedAccountId", "stripeOnboardingComplete", "stripeDetailsSubmitted", "stripePayoutsEnabled", "stripeChargesEnabled", "stripeRequirementsDue", "stripeAccountStatus", "stripeDisabledReason", "stripeOnboardingStartedAt", "stripeOnboardingCompletedAt", "stripeLastSyncedAt", "stripeCurrentDeadline", "stripePayoutAccountLast4", "stripePayoutBankName", "partnerGuideCompleted", "partnerGuideVersion", "partnerOnboardingCompletedAt", "completedAt", "createdAt", "updatedAt"
) SELECT
  "id", "userId", "fullName", "legalFullName", "phone", "whatsapp", "baseTownOrArea", "preferredLanguage", "heardAbout", "birthDate", "billingAddress", "taxIdOrVatNumber", "understandsNoCash", "understandsNoPricing", "understandsNoNegotiation", "understandsDirectPayment", "stripeConnectedAccountId", "stripeOnboardingComplete", "stripeDetailsSubmitted", "stripePayoutsEnabled", "stripeChargesEnabled", "stripeRequirementsDue", "stripeAccountStatus", "stripeDisabledReason", "stripeOnboardingStartedAt", "stripeOnboardingCompletedAt", "stripeLastSyncedAt", "stripeCurrentDeadline", "stripePayoutAccountLast4", "stripePayoutBankName", "partnerGuideCompleted", "partnerGuideVersion", "partnerOnboardingCompletedAt", "completedAt", "createdAt", "updatedAt"
FROM "LocalPartnerProfile";
DROP TABLE "LocalPartnerProfile";
ALTER TABLE "new_LocalPartnerProfile" RENAME TO "LocalPartnerProfile";
CREATE UNIQUE INDEX "LocalPartnerProfile_userId_key" ON "LocalPartnerProfile"("userId");
CREATE UNIQUE INDEX "LocalPartnerProfile_stripeConnectedAccountId_key" ON "LocalPartnerProfile"("stripeConnectedAccountId");

ALTER TABLE "PartnerPayout" ADD COLUMN "payoutMethod" TEXT NOT NULL DEFAULT 'STRIPE';
ALTER TABLE "PartnerPayout" ADD COLUMN "providerPayoutId" TEXT;
ALTER TABLE "PartnerPayout" ADD COLUMN "providerBatchId" TEXT;
ALTER TABLE "PartnerPayout" ADD COLUMN "providerReference" TEXT;
CREATE UNIQUE INDEX "PartnerPayout_providerPayoutId_key" ON "PartnerPayout"("providerPayoutId");
