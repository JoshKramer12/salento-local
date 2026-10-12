-- Evidence only. Historical paid payouts and commissions are not rewritten.
CREATE TABLE "PartnerManualBankReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalRequestId" TEXT NOT NULL,
    "bankReturnReference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "evidenceEncrypted" TEXT NOT NULL,
    "verifiedByUserId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerManualBankReturn_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "PartnerWithdrawalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerManualBankReturn_withdrawalRequestId_key" ON "PartnerManualBankReturn"("withdrawalRequestId");
