import { NextRequest, NextResponse } from "next/server";

import { defaultLocale, isLocale, localeCookieName } from "@/lib/i18n";
import { getRequestOrigin } from "@/lib/request-origin";
import { getSafeInternalRedirect } from "@/lib/redirects";

function buildLocaleResponse(locale: string) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(localeCookieName, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  return response;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { locale?: string };
  const locale = body.locale ?? defaultLocale;

  if (!isLocale(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }

  return buildLocaleResponse(locale);
}

export async function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get("locale") ?? defaultLocale;
  const redirectTo = getSafeInternalRedirect(request.nextUrl.searchParams.get("redirectTo")) ?? "/";
  const origin = getRequestOrigin(request);

  if (!isLocale(locale)) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const response = NextResponse.redirect(new URL(redirectTo, origin));
  response.cookies.set(localeCookieName, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  return response;
}
