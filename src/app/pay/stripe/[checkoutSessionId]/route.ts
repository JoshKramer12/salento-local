import { NextResponse } from "next/server";

import { resolveStripePaymentQrDestination } from "@/lib/stripe-payment-qr";
import { isPublicFinancialHold } from "@/lib/stripe";

type RouteContext = {
  params: Promise<{
    checkoutSessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (isPublicFinancialHold()) return NextResponse.json({ error: "payments_temporarily_paused" },
    { status: 503, headers: { "Cache-Control": "no-store" } });
  const { checkoutSessionId } = await context.params;
  const destination = await resolveStripePaymentQrDestination(checkoutSessionId);

  if (destination.status === "ready") {
    const response = NextResponse.redirect(destination.url, 307);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  const status = destination.status === "unavailable" ? 503 : 404;
  return NextResponse.json(
    { error: "stripe_checkout_not_available" },
    {
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
      status,
    },
  );
}
