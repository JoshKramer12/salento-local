-- AlterTable
ALTER TABLE "BusinessSubmission" ADD COLUMN "automaticRenewalAtAcceptance" BOOLEAN;
ALTER TABLE "BusinessSubmission" ADD COLUMN "businessTermsAcceptedAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "businessTermsVersion" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "contractualEmail" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "firstYearPriceCentsAtAcceptance" INTEGER;
ALTER TABLE "BusinessSubmission" ADD COLUMN "listingTermMonthsAtAcceptance" INTEGER;
ALTER TABLE "BusinessSubmission" ADD COLUMN "privacyPolicyVersionPresented" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "purchaseConfirmationSentAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "renewalPriceCentsAtAcceptance" INTEGER;
ALTER TABLE "BusinessSubmission" ADD COLUMN "signedAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "signerFullName" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "signerRole" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "signerRoleOther" TEXT;
