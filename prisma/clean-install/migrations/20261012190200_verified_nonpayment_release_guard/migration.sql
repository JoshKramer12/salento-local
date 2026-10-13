-- A withdrawal may release its original reservation only once.
CREATE UNIQUE INDEX "PartnerWithdrawalAuditEvent_one_nonpayment_release"
ON "PartnerWithdrawalAuditEvent"("withdrawalRequestId")
WHERE "reason" = 'verified_nonpayment_released';

-- A single bank return reference cannot credit two withdrawals.
CREATE UNIQUE INDEX "PartnerManualBankReturn_bankReturnReference_key"
ON "PartnerManualBankReturn"("bankReturnReference");
