-- Additive processing evidence. Historical records remain unchanged.
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "dispatchStartedAt" DATETIME;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "manualTransferInitiatedAt" DATETIME;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "manualTransferReference" TEXT;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "manualBankName" TEXT;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "manualInitiatedByUserId" TEXT;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "settlementVerifiedAt" DATETIME;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "settlementVerifiedByUserId" TEXT;
ALTER TABLE "PartnerWithdrawalRequest" ADD COLUMN "settlementEvidenceEncrypted" TEXT;
ALTER TABLE "PartnerWithdrawalAuditEvent" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "PartnerWithdrawalAuditEvent" ADD COLUMN "provider" TEXT;
ALTER TABLE "PartnerWithdrawalAuditEvent" ADD COLUMN "providerReference" TEXT;
ALTER TABLE "PartnerWithdrawalAuditEvent" ADD COLUMN "evidenceEncrypted" TEXT;
