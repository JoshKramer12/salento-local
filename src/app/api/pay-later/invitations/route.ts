import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRequestClientAddress, consumeSecurityRateLimit } from "@/lib/security-rate-limit";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";
import { attemptInvitationEmail, buildPayLaterWhatsAppUrl, createOrRotateInvitation, invitationIsOpen, isPayLaterEnabled } from "@/lib/pay-later-invitations";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  if (!isPayLaterEnabled()) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  if (!hasSameOriginOrNoOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const viewer = (await auth())?.user;
  if (!viewer?.id || viewer.role !== "GETTER") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const submissionId = new URL(request.url).searchParams.get("submissionId") ?? "";
  if (!/^[a-z0-9_-]{20,40}$/i.test(submissionId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const invitation = await prisma.businessSubmissionInvitation.findFirst({
    where: { businessSubmissionId: submissionId, partnerUserId: viewer.id },
    include: { businessSubmission: { select: { ownerEmail: true, status: true, paymentMethod: true } } },
  });
  const recipientMatches = invitation?.recipientEmail === invitation?.businessSubmission.ownerEmail.trim().toLowerCase();
  const open = Boolean(invitation && recipientMatches && !invitation.revokedAt && !invitation.declinedAt &&
    !invitation.completedAt && invitation.tokenExpiresAt > new Date() &&
    invitation.businessSubmission.status === "DRAFT" && !invitation.businessSubmission.paymentMethod);
  const email = open && invitation?.emailAcceptedGeneration === invitation?.tokenGeneration
    ? "accepted" : open && invitation?.emailFirstAttemptedAt ? "pending" : "idle";
  return NextResponse.json({ email }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isPayLaterEnabled()) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  if (!hasSameOriginOrNoOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const viewer = (await auth())?.user;
  if (!viewer?.id || viewer.role !== "GETTER") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { submissionId, mode, locale } = input as Record<string, unknown>;
  if (typeof submissionId !== "string" || !/^[a-z0-9_-]{20,40}$/i.test(submissionId) ||
    (mode !== "email" && mode !== "email_whatsapp" && mode !== "share" && mode !== "revoke") || (locale !== "it" && locale !== "en")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const limit = await consumeSecurityRateLimit({ clientAddress: getRequestClientAddress(request.headers),
    namespace: mode === "share" ? "pay-later-partner-share" : mode === "revoke" ? "pay-later-partner-revoke" : "pay-later-partner-invitation",
    subject: `${viewer.id}:${submissionId}`, limit: mode === "share" || mode === "revoke" ? 10 : 1,
    windowMs: mode === "share" || mode === "revoke" ? 60 * 60_000 : 5 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "cooldown", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
  try {
    if (mode === "revoke") {
      const updated = await prisma.businessSubmissionInvitation.updateMany({
        where: { businessSubmissionId: submissionId, partnerUserId: viewer.id,
          completedAt: null, businessSubmission: { status: "DRAFT", paymentMethod: null,
            paymentStatus: "NOT_REQUIRED" } },
        data: { revokedAt: new Date(), verifiedSessionHash: null, verifiedSessionExpiresAt: null,
          otpCodeHash: null, otpExpiresAt: null, emailNextAttemptAt: null },
      });
      return NextResponse.json({ status: updated.count ? "revoked" : "unavailable" },
        { status: updated.count ? 200 : 409, headers: { "Cache-Control": "no-store" } });
    }
    if (mode === "share") {
      const existing = await prisma.businessSubmissionInvitation.findFirst({
        where: { businessSubmissionId: submissionId, partnerUserId: viewer.id },
        include: { businessSubmission: true },
      });
      if (!existing || !invitationIsOpen(existing, existing.businessSubmission) ||
        existing.emailAcceptedGeneration !== existing.tokenGeneration ||
        existing.recipientEmail !== existing.businessSubmission.ownerEmail.trim().toLowerCase()) {
        return NextResponse.json({ error: "pay_later_submission_ineligible" }, { status: 409 });
      }
      const whatsappUrl = buildPayLaterWhatsAppUrl(existing);
      if (!whatsappUrl) return NextResponse.json({ error: "invalid_phone" }, { status: 409 });
      await prisma.businessSubmissionInvitation.update({ where: { id: existing.id },
        data: { whatsappPreparedAt: new Date() } });
      return NextResponse.json({ whatsappUrl }, { headers: { "Cache-Control": "no-store" } });
    }
    const created = await createOrRotateInvitation({ partnerUserId: viewer.id, submissionId, locale });
    const email = await attemptInvitationEmail(created.id);
    const invitation = await prisma.businessSubmissionInvitation.findUniqueOrThrow({ where: { id: created.id } });
    const whatsappUrl = email === "accepted" && mode === "email_whatsapp"
      ? buildPayLaterWhatsAppUrl(invitation) : null;
    if (whatsappUrl) await prisma.businessSubmissionInvitation.update({
      where: { id: invitation.id }, data: { whatsappPreparedAt: new Date() },
    });
    return NextResponse.json({ email, whatsappUrl, invitationId: invitation.id },
      { status: email === "accepted" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unavailable";
    return NextResponse.json({ error: code === "pay_later_submission_ineligible" ? code : "unavailable" },
      { status: code === "pay_later_submission_ineligible" ? 409 : 503 });
  }
}
