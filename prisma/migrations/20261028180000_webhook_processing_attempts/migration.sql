ALTER TABLE "StripeWebhookEvent" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PurchaseConfirmationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessSubmissionId" TEXT NOT NULL,
  "attemptedAt" DATETIME,
  "firstAttemptedAt" DATETIME,
  "nextAttemptAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" DATETIME,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "failureMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PurchaseConfirmationDelivery_businessSubmissionId_fkey" FOREIGN KEY ("businessSubmissionId") REFERENCES "BusinessSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PurchaseConfirmationDelivery_businessSubmissionId_key" ON "PurchaseConfirmationDelivery"("businessSubmissionId");
CREATE INDEX "PurchaseConfirmationDelivery_acceptedAt_nextAttemptAt_idx" ON "PurchaseConfirmationDelivery"("acceptedAt", "nextAttemptAt");
