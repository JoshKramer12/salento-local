-- Additive payment-outcome delivery tracking. No historical Payment is inserted
-- here, so deploying this migration cannot send an email for an old purchase.
CREATE TABLE "MembershipPaymentOutcomeDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "businessName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "locale" TEXT,
    "attemptedAt" DATETIME,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipPaymentOutcomeDelivery_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MembershipPaymentOutcomeDelivery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MembershipPaymentOutcomeDelivery_paymentId_key" ON "MembershipPaymentOutcomeDelivery"("paymentId");
CREATE INDEX "MembershipPaymentOutcomeDelivery_acceptedAt_nextAttemptAt_idx" ON "MembershipPaymentOutcomeDelivery"("acceptedAt", "nextAttemptAt");
CREATE INDEX "MembershipPaymentOutcomeDelivery_membershipId_idx" ON "MembershipPaymentOutcomeDelivery"("membershipId");
