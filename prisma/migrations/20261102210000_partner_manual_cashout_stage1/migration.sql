-- CreateTable
CREATE TABLE "PartnerWithdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerUserId" TEXT NOT NULL,
    "activePartnerUserId" TEXT,
    "requestKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "grossEligibleCents" INTEGER NOT NULL,
    "debtRecoveredCents" INTEGER NOT NULL DEFAULT 0,
    "requestedAmountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "payoutMethod" TEXT NOT NULL DEFAULT 'STRIPE',
    "stripeConnectedAccountId" TEXT NOT NULL,
    "destinationLast4" TEXT,
    "destinationVerifiedAt" DATETIME NOT NULL,
    "payoutId" TEXT,
    "providerStartedAt" DATETIME,
    "canceledAt" DATETIME,
    "completedAt" DATETIME,
    "failureCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawal_amount_check" CHECK ("grossEligibleCents" >= "requestedAmountCents" AND "requestedAmountCents" >= 5000 AND "debtRecoveredCents" >= 0),
    CONSTRAINT "PartnerWithdrawal_active_owner_check" CHECK ("activePartnerUserId" IS NULL OR "activePartnerUserId" = "partnerUserId"),
    CONSTRAINT "PartnerWithdrawal_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerWithdrawal_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerWithdrawalCommission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerWithdrawalCommission_amount_check" CHECK ("amountCents" > 0),
    CONSTRAINT "PartnerWithdrawalCommission_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "PartnerWithdrawal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerWithdrawalCommission_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "PartnerCommission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerWithdrawalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerWithdrawalEvent_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "PartnerWithdrawal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerDebtRecovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerUserId" TEXT NOT NULL,
    "debtCommissionId" TEXT NOT NULL,
    "creditCommissionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerDebtRecovery_amount_check" CHECK ("amountCents" > 0),
    CONSTRAINT "PartnerDebtRecovery_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerDebtRecovery_debtCommissionId_fkey" FOREIGN KEY ("debtCommissionId") REFERENCES "PartnerCommission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerDebtRecovery_creditCommissionId_fkey" FOREIGN KEY ("creditCommissionId") REFERENCES "PartnerCommission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawal_activePartnerUserId_key" ON "PartnerWithdrawal"("activePartnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawal_payoutId_key" ON "PartnerWithdrawal"("payoutId");

-- CreateIndex
CREATE INDEX "PartnerWithdrawal_partnerUserId_createdAt_idx" ON "PartnerWithdrawal"("partnerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerWithdrawal_status_createdAt_idx" ON "PartnerWithdrawal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawal_partnerUserId_requestKey_key" ON "PartnerWithdrawal"("partnerUserId", "requestKey");

-- CreateIndex
CREATE INDEX "PartnerWithdrawalCommission_commissionId_releasedAt_idx" ON "PartnerWithdrawalCommission"("commissionId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalCommission_withdrawalId_commissionId_key" ON "PartnerWithdrawalCommission"("withdrawalId", "commissionId");

-- CreateIndex
CREATE INDEX "PartnerWithdrawalEvent_withdrawalId_createdAt_idx" ON "PartnerWithdrawalEvent"("withdrawalId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerDebtRecovery_partnerUserId_createdAt_idx" ON "PartnerDebtRecovery"("partnerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerDebtRecovery_debtCommissionId_voidedAt_idx" ON "PartnerDebtRecovery"("debtCommissionId", "voidedAt");

-- CreateIndex
CREATE INDEX "PartnerDebtRecovery_creditCommissionId_voidedAt_idx" ON "PartnerDebtRecovery"("creditCommissionId", "voidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerDebtRecovery_debtCommissionId_creditCommissionId_key" ON "PartnerDebtRecovery"("debtCommissionId", "creditCommissionId");
