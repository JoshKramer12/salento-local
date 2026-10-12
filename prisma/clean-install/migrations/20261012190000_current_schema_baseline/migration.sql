-- CreateTable
CREATE TABLE "Town" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'Puglia',
    "shortDescription" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "history" TEXT NOT NULL,
    "practicalInfo" TEXT NOT NULL,
    "heroImageSeed" TEXT NOT NULL,
    "imageUrl" TEXT,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "population" INTEGER,
    "areaKm2" REAL,
    "elevationM" INTEGER,
    "wikipediaTitle" TEXT,
    "wikidataId" TEXT,
    "officialWebsite" TEXT,
    "sourceUrl" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TownAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "townId" TEXT NOT NULL,
    CONSTRAINT "TownAlias_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
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

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,

    PRIMARY KEY ("identifier", "token")
);

-- CreateTable
CREATE TABLE "SecurityRateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "sourceKey" TEXT,
    "externalSource" TEXT,
    "sourceUrl" TEXT,
    "name" TEXT NOT NULL,
    "subcategory" TEXT,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressPlaceId" TEXT,
    "addressStreetNumber" TEXT,
    "addressRoute" TEXT,
    "addressLocality" TEXT,
    "addressProvince" TEXT,
    "addressRegion" TEXT,
    "addressPostalCode" TEXT,
    "addressCountry" TEXT,
    "addressCountryCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "openingHoursText" TEXT,
    "rating" REAL NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "priceLevel" INTEGER,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isOpenNow" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceConfidence" INTEGER NOT NULL DEFAULT 0,
    "lastVerifiedAt" DATETIME,
    "lastEnrichedAt" DATETIME,
    "isLikelyClosed" BOOLEAN NOT NULL DEFAULT false,
    "mapsUrl" TEXT,
    "heroImageSeed" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "rawTags" JSONB,
    "categoryId" TEXT NOT NULL,
    "townId" TEXT NOT NULL,
    "localityId" TEXT,
    "ownerUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Business_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Business_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Business_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Business_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "annualPriceCents" INTEGER NOT NULL,
    "currentPeriodStart" DATETIME NOT NULL,
    "currentPeriodEnd" DATETIME NOT NULL,
    "graceEndsAt" DATETIME NOT NULL,
    "automaticRenewal" BOOLEAN NOT NULL DEFAULT false,
    "originatingPartnerUserId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeSubscriptionStatus" TEXT,
    "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "recurringPaymentReady" BOOLEAN NOT NULL DEFAULT false,
    "entitlementRevokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessMembership_originatingPartnerUserId_fkey" FOREIGN KEY ("originatingPartnerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "cycleEndsAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptedAt" DATETIME,
    "acceptedAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    CONSTRAINT "MembershipReminder_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipPaymentOutcomeDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "businessName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "locale" TEXT,
    "attemptedAt" DATETIME,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipPaymentOutcomeDelivery_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MembershipPaymentOutcomeDelivery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipFailedPaymentDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "graceEndsAt" DATETIME NOT NULL,
    "recipientEmail" TEXT,
    "locale" TEXT,
    "attemptedAt" DATETIME,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipFailedPaymentDelivery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessOwnerAccess" (
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "practicalInfo" TEXT NOT NULL,
    "heroImageSeed" TEXT NOT NULL,
    "imageUrl" TEXT,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "placeType" TEXT NOT NULL DEFAULT 'LOCALITY',
    "sourceUrl" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "townId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Locality_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "businessName" TEXT NOT NULL,
    "townId" TEXT NOT NULL,
    "localityId" TEXT,
    "categoryId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressPlaceId" TEXT,
    "addressLatitude" REAL,
    "addressLongitude" REAL,
    "addressStreetNumber" TEXT,
    "addressRoute" TEXT,
    "addressLocality" TEXT,
    "addressProvince" TEXT,
    "addressRegion" TEXT,
    "addressPostalCode" TEXT,
    "addressCountry" TEXT,
    "addressCountryCode" TEXT,
    "googleMapsUrl" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "openingHours" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "longDescription" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerPhone" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerHasNoEmail" BOOLEAN NOT NULL DEFAULT false,
    "signerFullName" TEXT,
    "signerRole" TEXT,
    "signerRoleOther" TEXT,
    "agreementSignature" TEXT,
    "signedAt" DATETIME,
    "businessTermsAcceptedAt" DATETIME,
    "businessTermsVersion" TEXT,
    "privacyPolicyVersionPresented" TEXT,
    "firstYearPriceCentsAtAcceptance" INTEGER,
    "renewalPriceCentsAtAcceptance" INTEGER,
    "listingTermMonthsAtAcceptance" INTEGER,
    "automaticRenewalAtAcceptance" BOOLEAN,
    "contractualEmail" TEXT,
    "purchaseConfirmationSentAt" DATETIME,
    "photoUrls" JSONB,
    "paymentMethod" TEXT,
    "businessPriceCents" INTEGER NOT NULL DEFAULT 10000,
    "commissionCents" INTEGER NOT NULL DEFAULT 5000,
    "platformShareCents" INTEGER NOT NULL DEFAULT 5000,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "amountOwedCents" INTEGER NOT NULL DEFAULT 10000,
    "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "bankTransferReference" TEXT,
    "createdBusinessId" TEXT,
    "verificationChannel" TEXT,
    "verificationCodeHash" TEXT,
    "verificationCodeExpiresAt" DATETIME,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationLastSentAt" DATETIME,
    "verificationSentTo" TEXT,
    "verificationVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessSubmission_townId_fkey" FOREIGN KEY ("townId") REFERENCES "Town" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BusinessSubmission_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BusinessSubmission_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BusinessSubmission_createdBusinessId_fkey" FOREIGN KEY ("createdBusinessId") REFERENCES "Business" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessSubmissionId" TEXT NOT NULL,
    "businessId" TEXT,
    "userId" TEXT NOT NULL,
    "partnerUserId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "method" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'INITIAL_MEMBERSHIP',
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeInvoiceId" TEXT,
    "stripeProductId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeSetupOperation" TEXT,
    "stripeSetupStartedAt" DATETIME,
    "stripeSetupGeneration" INTEGER NOT NULL DEFAULT 0,
    "stripeLastEventId" TEXT,
    "bankTransferReference" TEXT,
    "paidAt" DATETIME,
    "refundInstructionsEmail" TEXT,
    "refundRequestedAt" DATETIME,
    "refundRequestedByUserId" TEXT,
    "refundRequestAmountCents" INTEGER,
    "refundRequestLocale" TEXT,
    "bankRefundResolvedAt" DATETIME,
    "bankRefundResolvedByUserId" TEXT,
    "bankRefundResolutionNote" TEXT,
    "supportRefundRequestEmailClaimedAt" DATETIME,
    "supportRefundRequestEmailSentAt" DATETIME,
    "supportRefundRequestEmailError" TEXT,
    "ownerRefundRequestEmailClaimedAt" DATETIME,
    "ownerRefundRequestEmailSentAt" DATETIME,
    "ownerRefundRequestEmailError" TEXT,
    "partnerRefundRequestEmailClaimedAt" DATETIME,
    "partnerRefundRequestEmailSentAt" DATETIME,
    "partnerRefundRequestEmailError" TEXT,
    "stripeRefundId" TEXT,
    "refundStatus" TEXT,
    "refundedAmountCents" INTEGER,
    "refundedAt" DATETIME,
    "selfServiceRefundedAt" DATETIME,
    "ownerRefundEmailSentAt" DATETIME,
    "partnerRefundEmailSentAt" DATETIME,
    "ownerRefundEmailClaimedAt" DATETIME,
    "partnerRefundEmailClaimedAt" DATETIME,
    "ownerRefundEmailError" TEXT,
    "partnerRefundEmailError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_businessSubmissionId_fkey" FOREIGN KEY ("businessSubmissionId") REFERENCES "BusinessSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocalPartnerProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "legalFullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "baseTownOrArea" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL,
    "heardAbout" TEXT,
    "birthDate" DATETIME,
    "billingAddress" TEXT NOT NULL,
    "taxIdOrVatNumber" TEXT NOT NULL,
    "understandsNoCash" BOOLEAN NOT NULL DEFAULT false,
    "understandsNoPricing" BOOLEAN NOT NULL DEFAULT false,
    "understandsNoNegotiation" BOOLEAN NOT NULL DEFAULT false,
    "understandsDirectPayment" BOOLEAN NOT NULL DEFAULT false,
    "stripeConnectedAccountId" TEXT,
    "stripeOnboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeRequirementsDue" JSONB,
    "stripeAccountStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "stripeDisabledReason" TEXT,
    "stripeOnboardingStartedAt" DATETIME,
    "stripeOnboardingCompletedAt" DATETIME,
    "stripeLastSyncedAt" DATETIME,
    "stripeCurrentDeadline" DATETIME,
    "stripePayoutAccountLast4" TEXT,
    "stripePayoutBankName" TEXT,
    "preferredPayoutMethod" TEXT NOT NULL DEFAULT 'STRIPE',
    "payoutSetupStatus" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "payoutMethodUpdatedAt" DATETIME,
    "paypalPayoutEmail" TEXT,
    "bankPayoutIbanEncrypted" TEXT,
    "bankPayoutAccountLast4" TEXT,
    "bankPayoutAccountHolder" TEXT,
    "partnerGuideCompleted" BOOLEAN NOT NULL DEFAULT false,
    "partnerGuideVersion" INTEGER NOT NULL DEFAULT 0,
    "partnerOnboardingCompletedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocalPartnerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerCommission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerUserId" TEXT NOT NULL,
    "businessSubmissionId" TEXT,
    "businessId" TEXT,
    "paymentId" TEXT,
    "payoutId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceEventType" TEXT,
    "sourceEventId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeChargeId" TEXT,
    "stripeTransferId" TEXT,
    "stripePayoutId" TEXT,
    "earnedAt" DATETIME,
    "eligibleAt" DATETIME,
    "transferredAt" DATETIME,
    "paidAt" DATETIME,
    "reversedAt" DATETIME,
    "reversalReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerCommission_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartnerCommission_businessSubmissionId_fkey" FOREIGN KEY ("businessSubmissionId") REFERENCES "BusinessSubmission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartnerCommission_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerCommission_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartnerCommission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "PartnerPayoutRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runKey" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "summary" JSONB,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PartnerPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutRunId" TEXT NOT NULL,
    "partnerUserId" TEXT NOT NULL,
    "localPartnerProfileId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "initiatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "failedAt" DATETIME,
    "actionRequiredAt" DATETIME,
    "canceledAt" DATETIME,
    "failureMessage" TEXT,
    "stripeConnectedAccountId" TEXT,
    "stripeTransferId" TEXT,
    "stripePayoutId" TEXT,
    "bankAccountLast4" TEXT,
    "bankName" TEXT,
    "payoutMethod" TEXT NOT NULL DEFAULT 'STRIPE',
    "providerPayoutId" TEXT,
    "providerBatchId" TEXT,
    "providerReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerPayout_localPartnerProfileId_fkey" FOREIGN KEY ("localPartnerProfileId") REFERENCES "LocalPartnerProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PartnerPayout_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PartnerPayout_payoutRunId_fkey" FOREIGN KEY ("payoutRunId") REFERENCES "PartnerPayoutRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerWithdrawalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payoutMethod" TEXT NOT NULL,
    "destinationSnapshotEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "failureReason" TEXT,
    "dispatchStartedAt" DATETIME,
    "stripeTransferRecordedAt" DATETIME,
    "payoutDispatchStartedAt" DATETIME,
    "manualTransferInitiatedAt" DATETIME,
    "manualTransferReference" TEXT,
    "manualBankName" TEXT,
    "manualInitiatedByUserId" TEXT,
    "settlementVerifiedAt" DATETIME,
    "settlementVerifiedByUserId" TEXT,
    "settlementEvidenceEncrypted" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PartnerWithdrawalRequest_partnerUserId_fkey" FOREIGN KEY ("partnerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerWithdrawalRequest_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PartnerPayout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerWithdrawalAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalRequestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "provider" TEXT,
    "providerReference" TEXT,
    "evidenceEncrypted" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerWithdrawalAuditEvent_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "PartnerWithdrawalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PartnerManualBankReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawalRequestId" TEXT NOT NULL,
    "bankReturnReference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "evidenceEncrypted" TEXT NOT NULL,
    "verifiedByUserId" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerManualBankReturn_withdrawalRequestId_fkey" FOREIGN KEY ("withdrawalRequestId") REFERENCES "PartnerWithdrawalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stripeEventId" TEXT NOT NULL,
    "endpointType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "stripeObjectId" TEXT,
    "stripeAccountId" TEXT,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "summary" JSONB,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "claimantName" TEXT NOT NULL,
    "claimantPosition" TEXT NOT NULL,
    "claimantEmail" TEXT,
    "claimantPhone" TEXT,
    "claimantWhatsapp" TEXT,
    "message" TEXT,
    "verificationChannel" TEXT,
    "businessContactEmail" TEXT,
    "businessContactWhatsapp" TEXT,
    "verificationCodeHash" TEXT,
    "verificationCodeExpiresAt" DATETIME,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationLastSentAt" DATETIME,
    "verificationSentTo" TEXT,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "resendAvailableAt" DATETIME,
    "verifiedAt" DATETIME,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessClaim_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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
    CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BusinessImage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessHour" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "BusinessHour_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "senderName" TEXT,
    "senderEmail" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ListingFeedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceKey" TEXT,
    "license" TEXT,
    "reuseStatus" TEXT NOT NULL DEFAULT 'ALLOWED',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "fieldMask" JSONB,
    "payload" JSONB,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessSource_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessTag" (
    "businessId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("businessId", "tagId"),
    CONSTRAINT "BusinessTag_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Town_slug_key" ON "Town"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TownAlias_slug_key" ON "TownAlias"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE INDEX "SecurityRateLimit_expiresAt_idx" ON "SecurityRateLimit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Business_sourceKey_key" ON "Business"("sourceKey");

-- CreateIndex
CREATE INDEX "Business_isLikelyClosed_townId_isFeatured_reviewCount_rating_name_idx" ON "Business"("isLikelyClosed", "townId", "isFeatured", "reviewCount", "rating", "name");

-- CreateIndex
CREATE INDEX "Business_isLikelyClosed_categoryId_isFeatured_reviewCount_rating_name_idx" ON "Business"("isLikelyClosed", "categoryId", "isFeatured", "reviewCount", "rating", "name");

-- CreateIndex
CREATE INDEX "Business_isLikelyClosed_localityId_isFeatured_reviewCount_rating_name_idx" ON "Business"("isLikelyClosed", "localityId", "isFeatured", "reviewCount", "rating", "name");

-- CreateIndex
CREATE INDEX "Business_ownerUserId_updatedAt_idx" ON "Business"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMembership_businessId_key" ON "BusinessMembership"("businessId");

-- CreateIndex
CREATE INDEX "BusinessMembership_originatingPartnerUserId_idx" ON "BusinessMembership"("originatingPartnerUserId");

-- CreateIndex
CREATE INDEX "BusinessMembership_currentPeriodEnd_graceEndsAt_idx" ON "BusinessMembership"("currentPeriodEnd", "graceEndsAt");

-- CreateIndex
CREATE INDEX "MembershipReminder_membershipId_cycleEndsAt_idx" ON "MembershipReminder"("membershipId", "cycleEndsAt");

-- CreateIndex
CREATE INDEX "MembershipReminder_sentAt_idx" ON "MembershipReminder"("sentAt");

-- CreateIndex
CREATE INDEX "MembershipReminder_acceptedAt_idx" ON "MembershipReminder"("acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipReminder_membershipId_cycleEndsAt_type_key" ON "MembershipReminder"("membershipId", "cycleEndsAt", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPaymentOutcomeDelivery_paymentId_key" ON "MembershipPaymentOutcomeDelivery"("paymentId");

-- CreateIndex
CREATE INDEX "MembershipPaymentOutcomeDelivery_acceptedAt_nextAttemptAt_idx" ON "MembershipPaymentOutcomeDelivery"("acceptedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MembershipPaymentOutcomeDelivery_membershipId_idx" ON "MembershipPaymentOutcomeDelivery"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipFailedPaymentDelivery_stripeInvoiceId_key" ON "MembershipFailedPaymentDelivery"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "MembershipFailedPaymentDelivery_acceptedAt_canceledAt_nextAttemptAt_idx" ON "MembershipFailedPaymentDelivery"("acceptedAt", "canceledAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MembershipFailedPaymentDelivery_membershipId_idx" ON "MembershipFailedPaymentDelivery"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnerAccess_sourceSubmissionId_key" ON "BusinessOwnerAccess"("sourceSubmissionId");

-- CreateIndex
CREATE INDEX "BusinessOwnerAccess_email_userId_idx" ON "BusinessOwnerAccess"("email", "userId");

-- CreateIndex
CREATE INDEX "BusinessOwnerAccess_phone_userId_idx" ON "BusinessOwnerAccess"("phone", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_email_key" ON "BusinessOwnerAccess"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_phone_key" ON "BusinessOwnerAccess"("businessId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnerAccess_businessId_userId_key" ON "BusinessOwnerAccess"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessOwnerAccessInvitation_tokenHash_key" ON "BusinessOwnerAccessInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "BusinessOwnerAccessInvitation_businessOwnerAccessId_expiresAt_idx" ON "BusinessOwnerAccessInvitation"("businessOwnerAccessId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Locality_slug_key" ON "Locality"("slug");

-- CreateIndex
CREATE INDEX "BusinessSubmission_userId_status_idx" ON "BusinessSubmission"("userId", "status");

-- CreateIndex
CREATE INDEX "BusinessSubmission_townId_idx" ON "BusinessSubmission"("townId");

-- CreateIndex
CREATE INDEX "BusinessSubmission_categoryId_idx" ON "BusinessSubmission"("categoryId");

-- CreateIndex
CREATE INDEX "BusinessSubmission_userId_createdAt_idx" ON "BusinessSubmission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessSubmission_userId_updatedAt_idx" ON "BusinessSubmission"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeInvoiceId_key" ON "Payment"("stripeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeSubscriptionId_key" ON "Payment"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeLastEventId_key" ON "Payment"("stripeLastEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId");

-- CreateIndex
CREATE INDEX "Payment_businessSubmissionId_createdAt_idx" ON "Payment"("businessSubmissionId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_partnerUserId_createdAt_idx" ON "Payment"("partnerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_method_idx" ON "Payment"("status", "method");

-- CreateIndex
CREATE UNIQUE INDEX "LocalPartnerProfile_userId_key" ON "LocalPartnerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalPartnerProfile_stripeConnectedAccountId_key" ON "LocalPartnerProfile"("stripeConnectedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCommission_sourceKey_key" ON "PartnerCommission"("sourceKey");

-- CreateIndex
CREATE INDEX "PartnerCommission_partnerUserId_status_eligibleAt_idx" ON "PartnerCommission"("partnerUserId", "status", "eligibleAt");

-- CreateIndex
CREATE INDEX "PartnerCommission_businessSubmissionId_type_idx" ON "PartnerCommission"("businessSubmissionId", "type");

-- CreateIndex
CREATE INDEX "PartnerCommission_stripePaymentIntentId_idx" ON "PartnerCommission"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "PartnerCommission_partnerUserId_createdAt_idx" ON "PartnerCommission"("partnerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPaymentDispute_stripeDisputeId_key" ON "PartnerPaymentDispute"("stripeDisputeId");

-- CreateIndex
CREATE INDEX "PartnerPaymentDispute_paymentId_holdActive_idx" ON "PartnerPaymentDispute"("paymentId", "holdActive");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayoutRun_runKey_key" ON "PartnerPayoutRun"("runKey");

-- CreateIndex
CREATE INDEX "PartnerPayoutRun_scheduledFor_status_idx" ON "PartnerPayoutRun"("scheduledFor", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayout_stripeTransferId_key" ON "PartnerPayout"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayout_stripePayoutId_key" ON "PartnerPayout"("stripePayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerPayout_providerPayoutId_key" ON "PartnerPayout"("providerPayoutId");

-- CreateIndex
CREATE INDEX "PartnerPayout_partnerUserId_status_initiatedAt_idx" ON "PartnerPayout"("partnerUserId", "status", "initiatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalRequest_payoutId_key" ON "PartnerWithdrawalRequest"("payoutId");

-- CreateIndex
CREATE INDEX "PartnerWithdrawalRequest_partnerUserId_status_createdAt_idx" ON "PartnerWithdrawalRequest"("partnerUserId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerWithdrawalRequest_partnerUserId_idempotencyKey_key" ON "PartnerWithdrawalRequest"("partnerUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PartnerWithdrawalAuditEvent_withdrawalRequestId_createdAt_idx" ON "PartnerWithdrawalAuditEvent"("withdrawalRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerManualBankReturn_withdrawalRequestId_key" ON "PartnerManualBankReturn"("withdrawalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_endpointType_eventType_createdAt_idx" ON "StripeWebhookEvent"("endpointType", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessClaim_businessId_status_idx" ON "BusinessClaim"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessClaim_userId_status_idx" ON "BusinessClaim"("userId", "status");

-- CreateIndex
CREATE INDEX "LegalAcceptance_userId_documentType_acceptedAt_idx" ON "LegalAcceptance"("userId", "documentType", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalAcceptance_userId_documentType_documentVersion_acceptanceContext_contextRef_key" ON "LegalAcceptance"("userId", "documentType", "documentVersion", "acceptanceContext", "contextRef");

-- CreateIndex
CREATE INDEX "BusinessImage_businessId_sortOrder_idx" ON "BusinessImage"("businessId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHour_businessId_dayOfWeek_key" ON "BusinessHour"("businessId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Review_businessId_createdAt_idx" ON "Review"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessSource_businessId_idx" ON "BusinessSource"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSource_businessId_sourceType_sourceUrl_key" ON "BusinessSource"("businessId", "sourceType", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");
