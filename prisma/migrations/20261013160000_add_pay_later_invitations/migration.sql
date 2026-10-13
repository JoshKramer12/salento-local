-- AlterTable
ALTER TABLE "BusinessSubmission" ADD COLUMN "payLaterConfirmedAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "payLaterDetailsHash" TEXT;
ALTER TABLE "BusinessSubmission" ADD COLUMN "payLaterSetupCompletedAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "payLaterSetupStartedAt" DATETIME;
ALTER TABLE "BusinessSubmission" ADD COLUMN "payLaterVerifiedAt" DATETIME;

-- CreateTable
CREATE TABLE "BusinessSubmissionInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessSubmissionId" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'it',
    "tokenNonce" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "tokenGeneration" INTEGER NOT NULL DEFAULT 1,
    "lastRotatedAt" DATETIME,
    "revokedAt" DATETIME,
    "declinedAt" DATETIME,
    "remindersStoppedAt" DATETIME,
    "completedAt" DATETIME,
    "emailAttemptedAt" DATETIME,
    "emailAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "emailNextAttemptAt" DATETIME,
    "emailAcceptedAt" DATETIME,
    "emailAcceptedGeneration" INTEGER,
    "emailProvider" TEXT,
    "emailProviderMessageId" TEXT,
    "emailFailureMessage" TEXT,
    "whatsappPreparedAt" DATETIME,
    "otpCodeHash" TEXT,
    "otpExpiresAt" DATETIME,
    "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "otpSentAt" DATETIME,
    "otpSendCount" INTEGER NOT NULL DEFAULT 0,
    "otpSendWindowStartedAt" DATETIME,
    "verifiedAt" DATETIME,
    "verifiedDetailsHash" TEXT,
    "verifiedSessionHash" TEXT,
    "verifiedSessionExpiresAt" DATETIME,
    "partnerCapturedSignature" TEXT,
    "reminderCursor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessSubmissionInvitation_businessSubmissionId_fkey" FOREIGN KEY ("businessSubmissionId") REFERENCES "BusinessSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessSubmissionInvitation_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessSubmissionInvitationReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invitationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attemptedAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "acceptedAt" DATETIME,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessSubmissionInvitationReminder_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "BusinessSubmissionInvitation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSubmissionInvitation_businessSubmissionId_key" ON "BusinessSubmissionInvitation"("businessSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSubmissionInvitation_tokenHash_key" ON "BusinessSubmissionInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "BusinessSubmissionInvitation_emailAcceptedAt_completedAt_revokedAt_idx" ON "BusinessSubmissionInvitation"("emailAcceptedAt", "completedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "BusinessSubmissionInvitation_partnerUserId_updatedAt_idx" ON "BusinessSubmissionInvitation"("partnerUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "BusinessSubmissionInvitationReminder_nextAttemptAt_acceptedAt_idx" ON "BusinessSubmissionInvitationReminder"("nextAttemptAt", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSubmissionInvitationReminder_invitationId_sequence_key" ON "BusinessSubmissionInvitationReminder"("invitationId", "sequence");
