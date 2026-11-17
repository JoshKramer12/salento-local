import { NextResponse, type NextRequest } from "next/server";

import { controlledTestAuthorized } from "@/lib/controlled-test";

export function proxy(request: NextRequest) {
  if ((request.nextUrl.pathname === "/dev/cashout-preview" ||
       request.nextUrl.pathname.startsWith("/dev/cashout-preview/")) &&
      (process.env.NODE_ENV === "production" || process.env.PARTNER_CASHOUT_PREVIEW_ENABLED !== "true")) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (process.env.CONTROLLED_TEST_MODE !== "true") return NextResponse.next();
  // Stripe cannot attach browser credentials. Its signed webhook remains public;
  // every browser page and all other API routes require the test password.
  if (request.nextUrl.pathname === "/api/stripe/webhook") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/internal/membership-reminders" &&
    request.headers.get("authorization") ===
      `Bearer ${process.env.MEMBERSHIP_REMINDER_CRON_SECRET}` &&
    Boolean(process.env.MEMBERSHIP_REMINDER_CRON_SECRET)) return NextResponse.next();
  if (controlledTestAuthorized(request.headers.get("authorization"),
    process.env.CONTROLLED_TEST_ACCESS_SECRET)) return NextResponse.next();
  return new NextResponse("Controlled test access only", {
    status: 401,
    headers: { "Cache-Control": "no-store", "WWW-Authenticate": 'Basic realm="Salento Local test"' },
  });
}

export const config = { matcher: "/:path*" };
