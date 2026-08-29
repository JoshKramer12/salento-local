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
  const session = await auth();
  const viewer = session?.user;
  const { searchParams } = new URL(request.url);
  const checkoutSessionId = searchParams.get("session")?.trim() || null;
  const { submissionId } = await context.params;
  let sessionAuthorizedReceiptAccess = false;

  if (checkoutSessionId) {
    const syncResult = await syncStripePaymentFromReceiptAccess({
      checkoutSessionId,
      submissionId,
    });
    sessionAuthorizedReceiptAccess = syncResult.paymentReceived;
  }

  const receipt = await getReceiptData({
    allowInternal: sessionAuthorizedReceiptAccess,
    appUrl: getRequestOrigin(request),
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
    },
  });
}
