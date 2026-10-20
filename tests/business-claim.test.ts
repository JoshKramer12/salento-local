import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBusinessClaimVerificationEmail,
  isBusinessAlreadyManaged,
} from "@/lib/business-claim";

const actions = readFileSync("src/app/(account)/actions.ts", "utf8");
const claimPage = readFileSync("src/app/(account)/claim/page.tsx", "utf8");
const publicBusinessPage = readFileSync("src/app/businesses/[slug]/page.tsx", "utf8");
const claimSearchRoute = readFileSync("src/app/api/claim-businesses/route.ts", "utf8");
const hero = readFileSync("src/components/business/business-hero.tsx", "utf8");
const verifyForm = readFileSync("src/components/account/business-claim-verify-form.tsx", "utf8");
const editPage = readFileSync("src/app/businesses/[slug]/edit/page.tsx", "utf8");
const legacyEmailPage = readFileSync("src/app/(account)/claim/email/page.tsx", "utf8");
const successPage = readFileSync("src/app/(account)/claim/success/page.tsx", "utf8");
const claimApproval = readFileSync("src/lib/business-claim.ts", "utf8");

test("claim verification uses only the stored owner email and respects the no-email flag", () => {
  assert.equal(getBusinessClaimVerificationEmail({ ownerEmail: " Owner@Example.com ", ownerHasNoEmail: false }), "owner@example.com");
  assert.equal(getBusinessClaimVerificationEmail({ ownerEmail: "owner@example.com", ownerHasNoEmail: true }), null);
  assert.equal(getBusinessClaimVerificationEmail({ ownerEmail: null, ownerHasNoEmail: false }), null);
});

test("claim eligibility is hidden for managed businesses", () => {
  assert.equal(isBusinessAlreadyManaged({ ownerUserId: "owner" }), true);
  assert.equal(isBusinessAlreadyManaged({ ownerAccessUserIds: [null, "owner"] }), true);
  assert.equal(isBusinessAlreadyManaged({ ownerAccessUserIds: [null], ownerUserId: null }), false);
});

test("public listing and claim request enforce the same managed-business and email-only safeguards", () => {
  assert.match(publicBusinessPage, /const claimHref = isBusinessAlreadyManaged/);
  assert.match(publicBusinessPage, /\?business=\$\{encodeURIComponent\(business\.slug\)\}/);
  assert.match(hero, /Claim listing/);
  assert.match(hero, /Rivendica attività/);
  assert.match(claimSearchRoute, /ownerUserId: null/);
  assert.match(claimSearchRoute, /ownerAccesses: \{[\s\S]*none: \{[\s\S]*userId: \{ not: null \}/);
  assert.match(claimPage, /maskVerificationRecipient\("EMAIL", verificationEmail\)/);
  assert.match(actions, /verificationChannel: "EMAIL"/);
  assert.doesNotMatch(actions.slice(actions.indexOf("export async function requestBusinessClaimAction"), actions.indexOf("export async function verifyBusinessClaimCodeAction")), /claimantEmail|claimantPhone|verificationChannel: getStringValue/);
});

test("claim verification approves ownership atomically and goes straight to success", () => {
  const verify = actions.slice(actions.indexOf("export async function verifyBusinessClaimCodeAction"), actions.indexOf("export async function resendBusinessClaimCodeAction"));
  const approval = claimApproval.slice(claimApproval.indexOf("export async function approveVerifiedBusinessClaim"));

  assert.match(verify, /prisma\.\$transaction\(\(tx\) => approveVerifiedBusinessClaim\(/);
  assert.match(verify, /redirect\(`\/claim\/success\?business=/);
  assert.doesNotMatch(verify, /\/claim\/email|completeBusinessClaimEmailChoiceAction/);
  assert.match(approval, /ownerUserId: null/);
  assert.match(approval, /ownerAccesses: \{ none: \{ userId: \{ not: null \} \} \}/);
  assert.match(approval, /status: "REJECTED"/);
  assert.match(approval, /verificationCodeHash: null/);
  assert.match(approval, /businessOwnerAccess\.upsert/);
  assert.doesNotMatch(approval, /tx\.user\.(?:update|updateMany)/);
  assert.doesNotMatch(approval, /tx\.businessSubmission\.(?:update|updateMany|create)/);
  assert.match(successPage, /canManageBusiness\(/);
});

test("legacy email-choice URLs only redirect authorized, approved claims", () => {
  assert.match(legacyEmailPage, /claim\.userId !== viewer\.id/);
  assert.match(legacyEmailPage, /claim\.status !== "APPROVED"/);
  assert.match(legacyEmailPage, /claim\.business\.ownerUserId !== viewer\.id/);
  assert.match(legacyEmailPage, /redirect\(`\/claim\/success\?business=/);
  assert.doesNotMatch(legacyEmailPage, /BusinessClaimEmailChoiceForm|emailChoice|\.update\(/);
  assert.doesNotMatch(actions, /completeBusinessClaimEmailChoiceAction/);
});

test("claim resend and invalid-code writes reserve their limits atomically", () => {
  const issueCode = actions.slice(actions.indexOf("async function issueBusinessClaimVerificationCode"), actions.indexOf("export async function loginAction"));
  const verifyCode = actions.slice(actions.indexOf("export async function verifyBusinessClaimCodeAction"), actions.indexOf("export async function resendBusinessClaimCodeAction"));

  assert.match(issueCode, /resendAvailableAt: \{ lte: now \}/);
  assert.match(issueCode, /resendCount: \{ lt: CLAIM_VERIFICATION_MAX_RESENDS \+ 1 \}/);
  assert.match(issueCode, /status: "AWAITING_VERIFICATION"/);
  assert.match(verifyCode, /verificationAttempts: \{ lt: CLAIM_VERIFICATION_MAX_ATTEMPTS \}/);
  assert.match(verifyCode, /prisma\.businessClaim\.updateMany/);
});

test("claimed listings keep the active access email separate from historical submission contact data", () => {
  const ownerEdit = actions.slice(actions.indexOf("export async function updateOwnedBusinessWithWizardAction"), actions.indexOf("export async function verifyBusinessSubmissionCodeAction"));

  assert.match(editPage, /const activeOwnerEmail = business\.ownerAccesses\[0\]\?\.email \?\? latestSubmission\?\.ownerEmail/);
  assert.match(ownerEdit, /const hasApprovedClaim = business\.claims\.length > 0/);
  assert.match(ownerEdit, /hasApprovedClaim[\s\S]*ownerEmail: parsed\.data\.ownerEmail/);
});

test("the verification form supports six digit entry, numeric keyboards, and paste", () => {
  assert.match(verifyForm, /Array\.from\(\{ length: codeLength \}/);
  assert.match(verifyForm, /inputMode="numeric"/);
  assert.match(verifyForm, /autoComplete=\{index === 0 \? "one-time-code" : "off"\}/);
  assert.match(verifyForm, /onPaste=/);
  assert.match(verifyForm, /name="code" type="hidden" value=\{digits\.join\(""\)\}/);
});
