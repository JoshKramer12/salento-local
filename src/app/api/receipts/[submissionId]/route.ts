import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { buildReceiptPdf, getReceiptData } from "@/lib/receipts";
import { syncStripePaymentFromReceiptAccess } from "@/lib/stripe-payment-sync";

type RouteContext = {
  params: Promise<{
    submissionId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { searchParams } = new URL(request.url);
  const checkoutSessionId = searchParams.get("session")?.trim() || null;
  const { submissionId } = await context.params;
  const viewer = checkoutSessionId ? null : (await auth())?.user;
  let sessionAuthorizedReceiptAccess = false;

  if (checkoutSessionId) {
    try {
      const syncResult = await syncStripePaymentFromReceiptAccess({
        checkoutSessionId,
        submissionId,
      });
      sessionAuthorizedReceiptAccess = syncResult.paymentReceived;
    } catch {
      return NextResponse.json({ error: "payment_verification_unavailable" }, { status: 503 });
    }
  }

  const receipt = await getReceiptData({
    allowInternal: sessionAuthorizedReceiptAccess,
    appUrl: getRequestOrigin(request),
    checkoutSessionId,
    submissionId,
    viewerId: viewer?.id ?? null,
    viewerRole: viewer?.role ?? null,
  });

  if (!receipt) {
    return NextResponse.json({ error: "receipt_not_available" }, { status: 404 });
  }

  const pdfBytes = await buildReceiptPdf({
    locale: "it",
    receipt,
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Disposition": `inline; filename="${receipt.receiptFileName}"`,
      "Content-Type": "application/pdf",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}
