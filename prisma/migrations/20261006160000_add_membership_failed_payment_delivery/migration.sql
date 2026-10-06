-- New invoices alone create notification obligations; historical invoices are
-- deliberately not inserted into this additive table.
CREATE TABLE "MembershipFailedPaymentDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "graceEndsAt" DATETIME NOT NULL,
    "recipientEmail" TEXT,
    "locale" TEXT,
    "attemptedAt" DATETIME,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipFailedPaymentDelivery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MembershipFailedPaymentDelivery_stripeInvoiceId_key" ON "MembershipFailedPaymentDelivery"("stripeInvoiceId");
CREATE INDEX "MembershipFailedPaymentDelivery_acceptedAt_canceledAt_nextAttemptAt_idx" ON "MembershipFailedPaymentDelivery"("acceptedAt", "canceledAt", "nextAttemptAt");
CREATE INDEX "MembershipFailedPaymentDelivery_membershipId_idx" ON "MembershipFailedPaymentDelivery"("membershipId");
