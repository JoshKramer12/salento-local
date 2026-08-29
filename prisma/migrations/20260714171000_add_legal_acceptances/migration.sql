CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "acceptanceContext" TEXT NOT NULL,
    "contextRef" TEXT NOT NULL DEFAULT '',
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LegalAcceptance_documentType_check" CHECK ("documentType" IN ('BUSINESS_TERMS', 'PARTNER_TERMS', 'PRIVACY_POLICY', 'COOKIE_POLICY')),
    CONSTRAINT "LegalAcceptance_acceptanceContext_check" CHECK ("acceptanceContext" IN ('BUSINESS_SIGNUP', 'PARTNER_SIGNUP', 'BUSINESS_CLAIM', 'BUSINESS_SUBMISSION'))
);

CREATE UNIQUE INDEX "LegalAcceptance_userId_documentType_documentVersion_acceptanceContext_contextRef_key"
ON "LegalAcceptance"("userId", "documentType", "documentVersion", "acceptanceContext", "contextRef");

CREATE INDEX "LegalAcceptance_userId_documentType_acceptedAt_idx"
ON "LegalAcceptance"("userId", "documentType", "acceptedAt");
