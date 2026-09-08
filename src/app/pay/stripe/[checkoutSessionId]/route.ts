import { NextResponse } from "next/server";

import { resolveStripePaymentQrDestination } from "@/lib/stripe-payment-qr";

type RouteContext = {
  params: Promise<{
    checkoutSessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { checkoutSessionId } = await context.params;
  const destination = await resolveStripePaymentQrDestination(checkoutSessionId);

  if (destination.status === "ready") {
    const response = NextResponse.redirect(destination.url, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const status = destination.status === "unavailable" ? 503 : 404;
  return NextResponse.json(
    { error: "stripe_checkout_not_available" },
    {
      headers: { "Cache-Control": "no-store" },
      status,
    },
  );
}
