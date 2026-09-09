import { NextResponse } from "next/server";

import { resolveOwnerAccessInvitation } from "@/lib/business-owner-access";
import { ownerAccessLoginCookie, ownerAccessLoginCookieOptions } from "@/lib/owner-access-login";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveOwnerAccessInvitation(token);
  const destination = resolved.status === "active"
    ? new URL("/login?ownerAccess=1", request.url)
    : new URL(`/owner-access/${encodeURIComponent(token)}`, request.url);

  const response = NextResponse.redirect(destination);
  if (resolved.status === "active") {
    response.cookies.set(ownerAccessLoginCookie, token, ownerAccessLoginCookieOptions);
  }
  return response;
}
