import type { BusinessSubmissionInvitation } from "@prisma/client";
import { ensureEmbeddedSubscription } from "@/lib/embedded-subscription";
import { LISTING_OFFER, LISTING_SIGNER_ROLE_VALUES } from "@/lib/listing-offer";
import { createNoEmailPaymentToken, ensureManualElementPaymentIntent } from "@/lib/no-email-payment";
import { getOwnerDetailsHash } from "@/lib/pay-later-invitations";
import { prisma } from "@/lib/prisma";
import { ensureStripeBankTransferIntent, extractStripeBankTransferInstructions } from "@/lib/stripe-checkout";
import { getPaymentElementPublishableKey, getStripe } from "@/lib/stripe";

export type PayLaterPaymentChoice = {
  method: "ONLINE" | "BANK_TRANSFER";
  renewal: "AUTO" | "MANUAL";
  ownerConfirmed: boolean;
  termsAccepted: boolean;
  signerFullName: string;
  signerRole: string;
  signerRoleOther: string;
  signature: string;
};

export function isValidOwnerSignature(signature: string) {
  if (signature.length < 2 || signature.length > 50_000) return false;
  try {
    const value = JSON.parse(signature) as { version?: unknown; strokes?: unknown };
    return value.version === 1 && Array.isArray(value.strokes) &&
      value.strokes.some((stroke) => Array.isArray(stroke) && stroke.length > 0) &&
      value.strokes.every((stroke) => Array.isArray(stroke) && stroke.every((point) =>
        point && typeof point.x === "number" && typeof point.y === "number" &&
        Number.isFinite(point.x) && Number.isFinite(point.y)));
  } catch { return false; }
}

function validateChoice(choice: PayLaterPaymentChoice) {
  return choice.ownerConfirmed && choice.termsAccepted &&
    ["ONLINE", "BANK_TRANSFER"].includes(choice.method) &&
    ["AUTO", "MANUAL"].includes(choice.renewal) &&
    choice.signerFullName.trim().length >= 2 && choice.signerFullName.trim().length <= 120 &&
    LISTING_SIGNER_ROLE_VALUES.some((role) => role === choice.signerRole) &&
    (choice.signerRole !== "OTHER_AUTHORIZED_REPRESENTATIVE" || Boolean(choice.signerRoleOther.trim())) &&
    choice.signerRoleOther.length <= 120 && isValidOwnerSignature(choice.signature);
}

export async function chooseVerifiedPayLaterPayment(invitation: BusinessSubmissionInvitation, choice: PayLaterPaymentChoice) {
  if (!validateChoice(choice)) throw new Error("owner_approval_incomplete");
  if (choice.method === "ONLINE" && !getPaymentElementPublishableKey()) throw new Error("online_payment_unavailable");
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.businessSubmission.findUniqueOrThrow({ where: { id: invitation.businessSubmissionId } });
    const currentInvitation = await tx.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    const partner = await tx.user.findUnique({ where: { id: submission.userId }, select: { role: true } });
    if (!currentInvitation.verifiedAt || currentInvitation.revokedAt || currentInvitation.declinedAt ||
      currentInvitation.completedAt || currentInvitation.recipientEmail !== submission.ownerEmail.trim().toLowerCase() ||
      currentInvitation.verifiedDetailsHash !== getOwnerDetailsHash(submission) ||
      submission.createdBusinessId || submission.paymentStatus === "PAID" || submission.status === "PUBLISHED" ||
      submission.userId !== invitation.partnerUserId || partner?.role !== "GETTER")
      throw new Error("pay_later_state_conflict");
    const conflictingPayment = await tx.payment.findFirst({
      where: { businessSubmissionId: submission.id, purpose: "INITIAL_MEMBERSHIP",
        OR: [{ status: "PAID" }, { stripeCheckoutSessionId: { not: null }, status: "PENDING_PAYMENT" },
          { method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER" }] }, select: { id: true },
    });
    if (conflictingPayment && !submission.paymentMethod) throw new Error("pay_later_payment_conflict");
    if (submission.paymentMethod) {
      if (submission.paymentMethod !== choice.method || !submission.payLaterSetupStartedAt ||
        submission.payLaterDetailsHash !== getOwnerDetailsHash(submission)) throw new Error("pay_later_payment_locked");
      if (submission.payLaterSetupCompletedAt)
        return { submissionId: submission.id, method: choice.method, prepared: true } as const;
      if (submission.payLaterSetupStartedAt > new Date(now.getTime() - 2 * 60_000))
        throw new Error("pay_later_setup_in_progress");
      const claimed = await tx.businessSubmission.updateMany({
        where: { id: submission.id, payLaterSetupStartedAt: submission.payLaterSetupStartedAt,
          payLaterSetupCompletedAt: null, paymentStatus: { not: "PAID" } },
        data: { payLaterSetupStartedAt: now },
      });
      if (!claimed.count) throw new Error("pay_later_setup_in_progress");
      return { submissionId: submission.id, method: choice.method, prepared: false } as const;
    }
    if (submission.status !== "DRAFT" || submission.paymentStatus !== "NOT_REQUIRED") throw new Error("pay_later_state_conflict");
    const detailsHash = getOwnerDetailsHash(submission);
    const updated = await tx.businessSubmission.updateMany({
      where: { id: submission.id, status: "DRAFT", paymentMethod: null, paymentStatus: "NOT_REQUIRED",
        updatedAt: submission.updatedAt },
      data: {
        agreementSignature: choice.signature, signerFullName: choice.signerFullName.trim(),
        signerRole: choice.signerRole, signerRoleOther: choice.signerRoleOther.trim() || null,
        signedAt: now, businessTermsAcceptedAt: now,
        businessTermsVersion: LISTING_OFFER.businessTermsVersion,
        privacyPolicyVersionPresented: LISTING_OFFER.privacyPolicyVersion,
        firstYearPriceCentsAtAcceptance: LISTING_OFFER.annualPriceCents,
        renewalPriceCentsAtAcceptance: LISTING_OFFER.renewalPriceCents,
        listingTermMonthsAtAcceptance: LISTING_OFFER.termMonths,
        automaticRenewalAtAcceptance: choice.method === "ONLINE" && choice.renewal === "AUTO",
        payLaterConfirmedAt: now, payLaterVerifiedAt: currentInvitation.verifiedAt,
        payLaterDetailsHash: detailsHash, payLaterSetupStartedAt: now,
        paymentMethod: choice.method, paymentStatus: choice.method === "ONLINE" ? "PENDING_PAYMENT" : "AWAITING_BANK_TRANSFER",
        status: "AWAITING_PAYMENT",
      },
    });
    if (updated.count !== 1) throw new Error("pay_later_concurrent_change");
    return { submissionId: submission.id, method: choice.method, prepared: false } as const;
  });
  if (!result.prepared) {
    const submission = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    if (choice.method === "ONLINE") {
      const prepared = submission.automaticRenewalAtAcceptance
        ? await ensureEmbeddedSubscription(submission.id)
        : await ensureManualElementPaymentIntent(submission.id);
      if (!prepared) throw new Error("pay_later_payment_setup_unavailable");
    } else {
      await ensureStripeBankTransferIntent({
        idempotencyKey: `pay-later-bank:${submission.id}`,
        submission: { amountOwedCents: submission.amountOwedCents, businessName: submission.businessName,
          email: submission.email, id: submission.id, ownerEmail: submission.ownerEmail,
          ownerName: submission.ownerName, ownerPhone: submission.ownerPhone, userId: submission.userId },
        // The submitter is the original Partner. The verified owner is never substituted here.
        viewer: { id: invitation.partnerUserId, role: "GETTER", email: null },
      });
    }
    await prisma.businessSubmission.updateMany({
      where: { id: result.submissionId, payLaterSetupStartedAt: submission.payLaterSetupStartedAt,
        payLaterSetupCompletedAt: null, paymentStatus: { not: "PAID" } },
      data: { payLaterSetupCompletedAt: new Date() },
    });
  }
  return getVerifiedPayLaterPaymentDestination(result.submissionId, result.method);
}

export async function resumeVerifiedPayLaterPayment(invitation: BusinessSubmissionInvitation) {
  const submission = await prisma.businessSubmission.findUniqueOrThrow({ where: { id: invitation.businessSubmissionId } });
  if (submission.paymentMethod !== "ONLINE" && submission.paymentMethod !== "BANK_TRANSFER")
    throw new Error("pay_later_payment_unavailable");
  if (submission.payLaterSetupCompletedAt || submission.paymentStatus === "PAID")
    return getVerifiedPayLaterPaymentDestination(submission.id, submission.paymentMethod);
  if (!submission.payLaterConfirmedAt || !submission.businessTermsAcceptedAt || !submission.agreementSignature ||
    !submission.signerFullName || !submission.signerRole) throw new Error("pay_later_payment_unavailable");
  return chooseVerifiedPayLaterPayment(invitation, {
    method: submission.paymentMethod,
    renewal: submission.automaticRenewalAtAcceptance ? "AUTO" : "MANUAL",
    ownerConfirmed: true, termsAccepted: true, signerFullName: submission.signerFullName,
    signerRole: submission.signerRole, signerRoleOther: submission.signerRoleOther ?? "",
    signature: submission.agreementSignature,
  });
}

export async function getVerifiedPayLaterPaymentDestination(submissionId: string, method: "ONLINE" | "BANK_TRANSFER") {
  const submission = await prisma.businessSubmission.findUnique({ where: { id: submissionId } });
  if (!submission || submission.paymentMethod !== method) throw new Error("pay_later_payment_unavailable");
  if (submission.paymentStatus === "PAID" || submission.status === "PUBLISHED") return { status: "paid" as const };
  if (!submission.payLaterSetupCompletedAt || submission.payLaterDetailsHash !== getOwnerDetailsHash(submission))
    throw new Error("pay_later_payment_unavailable");
  if (method === "ONLINE") {
    const payment = await prisma.payment.findUnique({ where: { id: `initial-element:${submissionId}` } });
    if (!payment?.stripePaymentIntentId || payment.status !== "PENDING_PAYMENT" ||
      payment.partnerUserId !== submission.userId) throw new Error("pay_later_payment_unavailable");
    return { status: "online" as const, href: `/pay/element/${encodeURIComponent(createNoEmailPaymentToken(payment.id))}` };
  }
  const payment = await prisma.payment.findFirst({ where: { businessSubmissionId: submissionId,
    method: "BANK_TRANSFER", status: "AWAITING_BANK_TRANSFER" }, orderBy: { createdAt: "desc" } });
  if (!payment?.stripePaymentIntentId || payment.partnerUserId !== submission.userId) throw new Error("pay_later_payment_unavailable");
  const intent = await getStripe().paymentIntents.retrieve(payment.stripePaymentIntentId);
  const instructions = extractStripeBankTransferInstructions(intent);
  if (!instructions || intent.amount !== payment.amountCents || intent.currency !== payment.currency) throw new Error("pay_later_bank_instructions_unavailable");
  return { status: "bank" as const, instructions };
}
