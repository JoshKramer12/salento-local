-- New records only. No historical payout or commission row is changed.
CREATE TABLE "PartnerWithdrawalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payoutMethod" TEXT NOT NULL,
    "destinationSnapshotEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawalRequest_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerWithdrawalRequest_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PartnerWithdrawalAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalRequestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerWithdrawalAuditEvent_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "PartnerWithdrawalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerWithdrawalRequest_payoutId_key" ON "PartnerWithdrawalRequest"("payoutId");
CREATE UNIQUE INDEX "PartnerWithdrawalRequest_partnerUserId_idempotencyKey_key" ON "PartnerWithdrawalRequest"("partnerUserId", "idempotencyKey");
CREATE UNIQUE INDEX "PartnerWithdrawalRequest_one_unresolved_per_partner_key" ON "PartnerWithdrawalRequest"("partnerUserId") WHERE "status" NOT IN ('PAID', 'CANCELED');
CREATE INDEX "PartnerWithdrawalRequest_partnerUserId_status_createdAt_idx" ON "PartnerWithdrawalRequest"("partnerUserId", "status", "createdAt");
CREATE INDEX "PartnerWithdrawalAuditEvent_withdrawalRequestId_createdAt_idx" ON "PartnerWithdrawalAuditEvent"("withdrawalRequestId", "createdAt");
