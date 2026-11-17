-- AlterTable
ALTER TABLE "PartnerWithdrawal" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "PartnerWithdrawal" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "PartnerWithdrawal" ADD COLUMN "destinationExternalAccountId" TEXT;
ALTER TABLE "PartnerWithdrawal" ADD COLUMN "lastReconciledAt" DATETIME;

-- CreateTable
CREATE TABLE "PartnerWithdrawalAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INTENT',
    "idempotencyKey" TEXT NOT NULL,
    "connectedAccountId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "providerObjectId" TEXT,
    "errorCode" TEXT,
    "evidence" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReconciledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawalAttempt_amount_check" CHECK ("amountCents" > 0 AND "sequence" > 0),
    CONSTRAINT "PartnerWithdrawalAttempt_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "PartnerWithdrawal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalAttempt_idempotencyKey_key" ON "PartnerWithdrawalAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalAttempt_providerObjectId_key" ON "PartnerWithdrawalAttempt"("providerObjectId");

-- CreateIndex
CREATE INDEX "PartnerWithdrawalAttempt_status_requestedAt_idx" ON "PartnerWithdrawalAttempt"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "PartnerWithdrawal_status_lastReconciledAt_idx" ON "PartnerWithdrawal"("status", "lastReconciledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalAttempt_withdrawalId_operation_sequence_key" ON "PartnerWithdrawalAttempt"("withdrawalId", "operation", "sequence");
