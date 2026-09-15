-- Business-scoped membership foundation. This is additive and leaves all
-- existing business, payment, owner-access, and Partner commission data intact.
CREATE TABLE "BusinessMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "annualPriceCents" INTEGER NOT NULL,
    "currentPeriodStart" DATETIME NOT NULL,
    "currentPeriodEnd" DATETIME NOT NULL,
    "graceEndsAt" DATETIME NOT NULL,
    "automaticRenewal" BOOLEAN NOT NULL DEFAULT false,
    "originatingPartnerUserId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeSubscriptionStatus" TEXT,
    "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "recurringPaymentReady" BOOLEAN NOT NULL DEFAULT false,
    "entitlementRevokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessMembership_originatingPartnerUserId_fkey" FOREIGN KEY ("originatingPartnerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- This migration must not rebuild Payment: PartnerCommission.paymentId is a
-- live foreign key to Payment.id. SQLite additive columns preserve every
-- historical payment and commission relationship.
ALTER TABLE "Payment" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'INITIAL_MEMBERSHIP';
ALTER TABLE "Payment" ADD COLUMN "stripeInvoiceId" TEXT;
CREATE UNIQUE INDEX "Payment_stripeInvoiceId_key" ON "Payment"("stripeInvoiceId");

CREATE TABLE "MembershipReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "cycleEndsAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipReminder_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MembershipReminder_membershipId_cycleEndsAt_type_key" ON "MembershipReminder"("membershipId", "cycleEndsAt", "type");
CREATE INDEX "MembershipReminder_membershipId_cycleEndsAt_idx" ON "MembershipReminder"("membershipId", "cycleEndsAt");
CREATE INDEX "MembershipReminder_sentAt_idx" ON "MembershipReminder"("sentAt");

CREATE UNIQUE INDEX "BusinessMembership_businessId_key" ON "BusinessMembership"("businessId");
CREATE INDEX "BusinessMembership_originatingPartnerUserId_idx" ON "BusinessMembership"("originatingPartnerUserId");
CREATE INDEX "BusinessMembership_currentPeriodEnd_graceEndsAt_idx" ON "BusinessMembership"("currentPeriodEnd", "graceEndsAt");
