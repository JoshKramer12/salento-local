import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  createPartnerOnboardingLink,
  resolvePartnerOnboardingReturnTo,
} from "@/lib/partner-connect";
import { getRequestOrigin } from "@/lib/request-origin";

function getLocaleFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);

  return searchParams.get("locale") === "en" ? "en" : "it";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const viewer = session?.user;
  const requestUrl = request.nextUrl;
  const returnTo = resolvePartnerOnboardingReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );
  const appUrl = getRequestOrigin(request);

  if (!viewer?.id || viewer.role !== "GETTER") {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  const link = await createPartnerOnboardingLink({
    appUrl,
    locale: getLocaleFromRequest(request),
    returnTo,
    userId: viewer.id,
  });

  return NextResponse.redirect(link.url);
}
