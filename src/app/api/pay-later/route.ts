import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRequestClientAddress, consumeSecurityRateLimit } from "@/lib/security-rate-limit";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";
import { closeInvitation, getInvitationByToken, getPayLaterSessionCookieName, isPayLaterEnabled, requireVerifiedInvitation, startInvitationOtp, verifyInvitationOtp } from "@/lib/pay-later-invitations";
import { chooseVerifiedPayLaterPayment, resumeVerifiedPayLaterPayment, type PayLaterPaymentChoice } from "@/lib/pay-later-payment";
import { prisma } from "@/lib/prisma";

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function POST(request: Request) {
  if (!isPayLaterEnabled()) return NextResponse.json({ error: "unavailable" }, { status: 404, headers: noStore });
  if (!hasSameOriginOrNoOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  const body = input as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  const invitation = await getInvitationByToken(token);
  if (!invitation) return NextResponse.json({ error: "unavailable" }, { status: 404, headers: noStore });
  const action = body.action;
  if (action === "load") {
    const sessionToken = (await cookies()).get(getPayLaterSessionCookieName(invitation.id))?.value;
    const verified = await requireVerifiedInvitation(token, sessionToken);
    const submission = verified ? await prisma.businessSubmission.findUnique({
      where: { id: verified.businessSubmissionId }, include: { town: true, category: true },
    }) : null;
    const photos = submission && Array.isArray(submission.photoUrls)
      ? submission.photoUrls.filter((url): url is string => typeof url === "string" && Boolean(url.trim())) : [];
    return NextResponse.json({ verified: Boolean(verified),
      emailHint: invitation.recipientEmail.replace(/^(.).+(@.*)$/, "$1•••$2"),
      submission: submission ? {
        businessName: submission.businessName, address: submission.address, town: submission.town.name,
        category: submission.category.name, description: submission.longDescription,
        openingHours: submission.openingHours, phone: submission.phone, email: submission.email,
        photos, ownerName: submission.ownerName, signedEarlier: Boolean(invitation.partnerCapturedSignature),
        paymentMethod: submission.paymentMethod === "ONLINE" || submission.paymentMethod === "BANK_TRANSFER"
          ? submission.paymentMethod : null,
      } : null }, { headers: noStore });
  }
  if (action === "start-otp" || action === "verify-otp") {
    const limit = await consumeSecurityRateLimit({ clientAddress: getRequestClientAddress(request.headers),
      namespace: `pay-later-${action}`, subject: invitation.id,
      limit: action === "start-otp" ? 6 : 10, windowMs: 60 * 60_000 });
    if (!limit.allowed) return NextResponse.json({ error: "cooldown", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: noStore });
    if (action === "start-otp") {
      const result = await startInvitationOtp(token);
      return NextResponse.json({ status: result }, { status: result === "sent" ? 200 : 409, headers: noStore });
    }
    const verified = await verifyInvitationOtp(token, typeof body.code === "string" ? body.code : "");
    if (!verified) return NextResponse.json({ error: "invalid_or_expired_code" }, { status: 400, headers: noStore });
    const response = NextResponse.json({ status: "verified" }, { headers: noStore });
    response.cookies.set(getPayLaterSessionCookieName(verified.invitationId), verified.sessionToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
      path: "/", maxAge: 2 * 60 * 60,
    });
    return response;
  }
  const cookie = (await cookies()).get(getPayLaterSessionCookieName(invitation.id))?.value;
  const verified = await requireVerifiedInvitation(token, cookie);
  if (!verified) return NextResponse.json({ error: "verification_required" }, { status: 401, headers: noStore });
  if (action === "decline" || action === "stop-reminders") {
    const closed = await closeInvitation(invitation.id, action === "decline" ? "decline" : "stop");
    if (!closed) return NextResponse.json({ error: "pay_later_state_conflict" }, { status: 409, headers: noStore });
    return NextResponse.json({ status: action === "decline" ? "declined" : "stopped" }, { headers: noStore });
  }
  if (action === "get-payment") {
    const method = verified.businessSubmission.paymentMethod;
    if (method !== "ONLINE" && method !== "BANK_TRANSFER") return NextResponse.json({ error: "not_selected" }, { status: 409, headers: noStore });
    try { return NextResponse.json(await resumeVerifiedPayLaterPayment(verified), { headers: noStore }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "pay_later_setup_in_progress"
      ? "pay_later_setup_in_progress" : "payment_unavailable" }, { status: 409, headers: noStore }); }
  }
  if (action !== "choose-payment") return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  const choice = body.choice as PayLaterPaymentChoice | undefined;
  if (!choice || typeof choice !== "object") return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  try {
    const destination = await chooseVerifiedPayLaterPayment(verified, choice);
    return NextResponse.json(destination, { headers: noStore });
  } catch (error) {
    const code = error instanceof Error ? error.message : "payment_unavailable";
    const publicError = ["owner_approval_incomplete", "online_payment_unavailable", "pay_later_state_conflict",
      "pay_later_payment_locked", "pay_later_payment_conflict", "pay_later_payment_unavailable"].includes(code) ? code : "payment_unavailable";
    return NextResponse.json({ error: publicError }, { status: 409, headers: noStore });
  }
}
