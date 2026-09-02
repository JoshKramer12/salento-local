CREATE TABLE "BusinessOwnerAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "sourceSubmissionId" TEXT,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessOwnerAccess_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessOwnerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_email_key" ON "BusinessOwnerAccess"("businessId", "email");
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_userId_key" ON "BusinessOwnerAccess"("businessId", "userId");
CREATE UNIQUE INDEX "BusinessOwnerAccess_sourceSubmissionId_key" ON "BusinessOwnerAccess"("sourceSubmissionId");
CREATE INDEX "BusinessOwnerAccess_email_userId_idx" ON "BusinessOwnerAccess"("email", "userId");

CREATE TABLE "BusinessOwnerAccessInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessOwnerAccessId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessOwnerAccessInvitation_businessOwnerAccessId_fkey" FOREIGN KEY ("businessOwnerAccessId") REFERENCES "BusinessOwnerAccess" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BusinessOwnerAccessInvitation_tokenHash_key" ON "BusinessOwnerAccessInvitation"("tokenHash");
CREATE INDEX "BusinessOwnerAccessInvitation_businessOwnerAccessId_expiresAt_idx" ON "BusinessOwnerAccessInvitation"("businessOwnerAccessId", "expiresAt");

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- Backfill the durable relationship for already published, email-based
-- submissions. This does not send email or alter payment/publication state.
INSERT OR IGNORE INTO "BusinessOwnerAccess" (
    "id", "businessId", "email", "userId", "sourceSubmissionId", "verifiedAt", "activatedAt", "createdAt", "updatedAt"
)
SELECT
    'boa-' || lower(hex(randomblob(12))),
    submission."createdBusinessId",
    lower(trim(submission."ownerEmail")),
    (
        SELECT user."id"
        FROM "User" AS user
        WHERE lower(user."email") = lower(trim(submission."ownerEmail"))
        LIMIT 1
    ),
    submission."id",
    CURRENT_TIMESTAMP,
    CASE WHEN EXISTS (
        SELECT 1 FROM "User" AS user
        WHERE lower(user."email") = lower(trim(submission."ownerEmail"))
    ) THEN CURRENT_TIMESTAMP ELSE NULL END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "BusinessSubmission" AS submission
WHERE submission."status" = 'PUBLISHED'
  AND submission."createdBusinessId" IS NOT NULL
  AND submission."ownerHasNoEmail" = 0
  AND trim(submission."ownerEmail") <> '';

UPDATE "Business"
SET "ownerUserId" = (
    SELECT access."userId"
    FROM "BusinessOwnerAccess" AS access
    WHERE access."businessId" = "Business"."id"
      AND access."userId" IS NOT NULL
    ORDER BY access."createdAt" ASC
    LIMIT 1
)
WHERE "ownerUserId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "BusinessOwnerAccess" AS access
    WHERE access."businessId" = "Business"."id"
      AND access."userId" IS NOT NULL
  );
