import { NextResponse } from "next/server";

import { getViewer } from "@/lib/auth-guards";
import { attachOwnerAccessToUser, markOwnerAccessInvitationUsed, resolveOwnerAccessInvitation } from "@/lib/business-owner-access";
import { ownerAccessLoginCookie } from "@/lib/owner-access-login";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/validation";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.redirect(new URL(`/owner-access/${encodeURIComponent(token)}/login`, request.url));
  }

  const resolved = await resolveOwnerAccessInvitation(token);
  const invitation = resolved.invitation;
  const businessSlug = invitation?.businessOwnerAccess.business.slug;
  if (!invitation || !businessSlug) {
    return NextResponse.redirect(new URL(`/owner-access/${encodeURIComponent(token)}`, request.url));
  }
  const access = invitation.businessOwnerAccess;
  const identityMatches = access.email
    ? Boolean(viewer.email && normalizeEmail(viewer.email) === access.email)
    : Boolean(access.phone && viewer.phone === access.phone);
  if (!identityMatches) {
    return NextResponse.redirect(new URL(`/owner-access/${encodeURIComponent(token)}?error=wrong-account`, request.url));
  }

  if (resolved.status === "active") {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await resolveOwnerAccessInvitation(token, tx);
        if (current.status !== "active" || !current.invitation) {
          throw new Error("owner_access_invitation_unavailable");
        }
        const attached = await attachOwnerAccessToUser({
          accessId: current.invitation.businessOwnerAccessId,
          db: tx,
          userId: viewer.id,
        });
        if (!attached) throw new Error("owner_access_attachment_failed");
        await markOwnerAccessInvitationUsed({ db: tx, invitationId: current.invitation.id });
      });
    } catch {
      // Another tab may have completed this exact invitation first. Re-read it
      // below so the rightful owner is still sent to the editor, never a 500.
      const current = await resolveOwnerAccessInvitation(token);
      if (current.status !== "used" || current.invitation?.businessOwnerAccess.userId !== viewer.id) {
        return NextResponse.redirect(new URL(`/owner-access/${encodeURIComponent(token)}`, request.url));
      }
    }
  } else if (resolved.status !== "used" || invitation.businessOwnerAccess.userId !== viewer.id) {
    return NextResponse.redirect(new URL(`/owner-access/${encodeURIComponent(token)}`, request.url));
  }

  const response = NextResponse.redirect(new URL(`/businesses/${encodeURIComponent(businessSlug)}/edit`, request.url));
  response.cookies.delete(ownerAccessLoginCookie);
  return response;
}
