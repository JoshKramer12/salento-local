-- Nullable request provenance, resolution audit and independent delivery claims.
-- Preserve all historical Payment, membership, commission and agreement rows.
ALTER TABLE "Payment" ADD COLUMN "refundRequestedByUserId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundRequestAmountCents" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "refundRequestLocale" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankRefundResolvedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "bankRefundResolvedByUserId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankRefundResolutionNote" TEXT;
ALTER TABLE "Payment" ADD COLUMN "supportRefundRequestEmailClaimedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "supportRefundRequestEmailSentAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "supportRefundRequestEmailError" TEXT;
ALTER TABLE "Payment" ADD COLUMN "ownerRefundRequestEmailClaimedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "ownerRefundRequestEmailSentAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "ownerRefundRequestEmailError" TEXT;
ALTER TABLE "Payment" ADD COLUMN "partnerRefundRequestEmailClaimedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "partnerRefundRequestEmailSentAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "partnerRefundRequestEmailError" TEXT;
