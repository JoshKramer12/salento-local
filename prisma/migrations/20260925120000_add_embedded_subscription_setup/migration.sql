-- Durable associations for an initial embedded subscription payment. Nullable
-- IDs preserve historical Checkout payments and existing memberships.
ALTER TABLE "Payment" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeProductId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeSetupOperation" TEXT;
ALTER TABLE "Payment" ADD COLUMN "stripeSetupStartedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "stripeSetupGeneration" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "Payment_stripeSubscriptionId_key" ON "Payment"("stripeSubscriptionId");
