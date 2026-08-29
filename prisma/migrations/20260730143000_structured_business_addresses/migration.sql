ALTER TABLE "Business"
ADD COLUMN "addressPlaceId" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressStreetNumber" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressRoute" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressLocality" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressProvince" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressRegion" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressPostalCode" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "Business"
ADD COLUMN "addressCountryCode" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressPlaceId" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressLatitude" REAL;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressLongitude" REAL;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressStreetNumber" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressRoute" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressLocality" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressProvince" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressRegion" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressPostalCode" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "BusinessSubmission"
ADD COLUMN "addressCountryCode" TEXT;
