-- Phone-only owners do not have an email address. Rebuild the two small
-- identity tables so email can be nullable while retaining every existing
-- email account and invitation unchanged.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "phone" TEXT,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "emailVerified" DATETIME,
    "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_User" ("id", "email", "username", "name", "passwordHash", "image", "role", "sessionVersion", "emailVerified", "profileCompleted", "createdAt", "updatedAt")
SELECT "id", "email", "username", "name", "passwordHash", "image", "role", "sessionVersion", "emailVerified", "profileCompleted", "createdAt", "updatedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

CREATE TABLE "new_BusinessOwnerAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "userId" TEXT,
    "sourceSubmissionId" TEXT,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessOwnerAccess_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessOwnerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_BusinessOwnerAccess" ("id", "businessId", "email", "userId", "sourceSubmissionId", "verifiedAt", "activatedAt", "createdAt", "updatedAt")
SELECT "id", "businessId", "email", "userId", "sourceSubmissionId", "verifiedAt", "activatedAt", "createdAt", "updatedAt"
FROM "BusinessOwnerAccess";

DROP TABLE "BusinessOwnerAccess";
ALTER TABLE "new_BusinessOwnerAccess" RENAME TO "BusinessOwnerAccess";
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_email_key" ON "BusinessOwnerAccess"("businessId", "email");
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_phone_key" ON "BusinessOwnerAccess"("businessId", "phone");
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_userId_key" ON "BusinessOwnerAccess"("businessId", "userId");
CREATE UNIQUE INDEX "BusinessOwnerAccess_sourceSubmissionId_key" ON "BusinessOwnerAccess"("sourceSubmissionId");
CREATE INDEX "BusinessOwnerAccess_email_userId_idx" ON "BusinessOwnerAccess"("email", "userId");
CREATE INDEX "BusinessOwnerAccess_phone_userId_idx" ON "BusinessOwnerAccess"("phone", "userId");

PRAGMA foreign_keys=ON;
