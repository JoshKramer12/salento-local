import { cookies } from "next/headers";

import { resolveOwnerAccessInvitation } from "@/lib/business-owner-access";

const ownerAccessLoginCookie = "salento-owner-access-login";

export const ownerAccessLoginCookieOptions = {
  httpOnly: true,
  maxAge: 15 * 60,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export async function getOwnerAccessLoginContext() {
  const token = (await cookies()).get(ownerAccessLoginCookie)?.value ?? "";
  const resolved = await resolveOwnerAccessInvitation(token);
  if (resolved.status !== "active" || !resolved.invitation) return null;

  return {
    businessName: resolved.invitation.businessOwnerAccess.business.name,
    email: resolved.invitation.businessOwnerAccess.email ?? undefined,
    token,
  };
}

export { ownerAccessLoginCookie };
