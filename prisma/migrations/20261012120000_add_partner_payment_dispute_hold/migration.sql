-- Additive hold records only. Historical disputes are not inferred or repaired.
CREATE TABLE "PartnerPaymentDispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "holdActive" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "PartnerPaymentDispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PartnerPaymentDispute_stripeDisputeId_key" ON "PartnerPaymentDispute"("stripeDisputeId");
CREATE INDEX "PartnerPaymentDispute_paymentId_holdActive_idx" ON "PartnerPaymentDispute"("paymentId", "holdActive");
