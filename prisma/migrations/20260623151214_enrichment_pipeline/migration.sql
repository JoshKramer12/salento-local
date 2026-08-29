-- AlterTable
ALTER TABLE "Business" ADD COLUMN "email" TEXT;
ALTER TABLE "Business" ADD COLUMN "lastEnrichedAt" DATETIME;
ALTER TABLE "Business" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "Business" ADD COLUMN "subcategory" TEXT;

-- CreateTable
CREATE TABLE "BusinessSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceKey" TEXT,
    "license" TEXT,
    "reuseStatus" TEXT NOT NULL DEFAULT 'ALLOWED',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "fieldMask" JSONB,
    "payload" JSONB,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessSource_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BusinessSource_businessId_idx" ON "BusinessSource"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSource_businessId_sourceType_sourceUrl_key" ON "BusinessSource"("businessId", "sourceType", "sourceUrl");
