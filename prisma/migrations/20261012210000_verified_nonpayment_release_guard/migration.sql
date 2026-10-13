-- Additive guard for installations on the historical migration lineage.
CREATE UNIQUE INDEX "PartnerWithdrawalAuditEvent_one_nonpayment_release"
ON "PartnerWithdrawalAuditEvent"("withdrawalRequestId")
WHERE "reason" = 'verified_nonpayment_released';

-- Preflight existing references for duplicates before any live deployment.
CREATE UNIQUE INDEX "PartnerManualBankReturn_bankReturnReference_key"
ON "PartnerManualBankReturn"("bankReturnReference");
