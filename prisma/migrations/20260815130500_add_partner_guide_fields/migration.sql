ALTER TABLE "LocalPartnerProfile"
ADD COLUMN "partnerGuideCompleted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LocalPartnerProfile"
ADD COLUMN "partnerGuideVersion" INTEGER NOT NULL DEFAULT 0;
