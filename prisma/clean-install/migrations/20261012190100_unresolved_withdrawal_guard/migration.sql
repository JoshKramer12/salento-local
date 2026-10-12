-- Prisma's datamodel cannot express this partial unique index. It is required
-- to prevent a second unresolved withdrawal for the same Partner.
CREATE UNIQUE INDEX "PartnerWithdrawalRequest_one_unresolved_per_partner_key"
ON "PartnerWithdrawalRequest"("partnerUserId")
WHERE "status" NOT IN ('PAID', 'CANCELED');
