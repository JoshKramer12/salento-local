-- Durable evidence separates a recorded transfer from an attempted payout.
-- Existing rows remain NULL and cannot be auto-continued.
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "stripeTransferRecordedAt" DATETIME;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "payoutDispatchStartedAt" DATETIME;
