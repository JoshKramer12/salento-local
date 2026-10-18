CREATE TABLE "PartnerCommissionConfirmationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commissionId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "locale" TEXT,
    "attemptedAt" DATETIME,
    "firstAttemptedAt" DATETIME,
    "nextAttemptAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "canceledAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerCommissionConfirmationDelivery_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "PartnerCommission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerCommissionConfirmationDelivery_commissionId_key" ON "PartnerCommissionConfirmationDelivery"("commissionId");
CREATE INDEX "PartnerCommissionConfirmationDelivery_acceptedAt_canceledAt_nextAttemptAt_idx" ON "PartnerCommissionConfirmationDelivery"("acceptedAt", "canceledAt", "nextAttemptAt");
