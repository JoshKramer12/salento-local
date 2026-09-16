-- Additive reminder-delivery observability. Existing rows were only retained
-- after a successful provider call, so backfilling them as accepted preserves
-- their established idempotency behavior.
ALTER TABLE "MembershipReminder" ADD COLUMN "attemptedAt" DATETIME;
ALTER TABLE "MembershipReminder" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "MembershipReminder" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MembershipReminder" ADD COLUMN "provider" TEXT;
ALTER TABLE "MembershipReminder" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "MembershipReminder" ADD COLUMN "failureMessage" TEXT;

UPDATE "MembershipReminder"
SET "attemptedAt" = "sentAt",
    "acceptedAt" = "sentAt",
    "attemptCount" = 1
WHERE "acceptedAt" IS NULL;

CREATE INDEX "MembershipReminder_acceptedAt_idx" ON "MembershipReminder"("acceptedAt");
