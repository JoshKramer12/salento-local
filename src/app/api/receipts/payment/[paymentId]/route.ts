import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { buildReceiptPdf, getReceiptData } from "@/lib/receipts";

type RouteContext = { params: Promise<{ paymentId: string }> };

/**
 * The financial document endpoint is deliberately payment-addressed. A
 * session may authorize the secure post-Checkout handoff only when it is the
 * session recorded on that same Payment; all ordinary access uses the owner
 * authorization enforced by getReceiptData.
 */
export async function GET(request: Request, context: RouteContext) {
  const { paymentId } = await context.params;
  const { searchParams } = new URL(request.url);
  const checkoutSessionId = searchParams.get("session")?.trim() || null;
  const viewer = checkoutSessionId ? null : (await auth())?.user;
  const receipt = await getReceiptData({
    allowInternal: Boolean(checkoutSessionId),
    appUrl: getRequestOrigin(request),
    checkoutSessionId,
    paymentId,
    viewerId: viewer?.id ?? null,
    viewerRole: viewer?.role ?? null,
  });
  if (!receipt) return NextResponse.json({ error: "receipt_not_available" }, { status: 404 });

  const locale = searchParams.get("locale") === "en" ? "en" : "it";
  const pdfBytes = await buildReceiptPdf({ locale, receipt });
  const attachment = searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${receipt.receiptFileName}"`,
      "Content-Type": "application/pdf",
    },
  });
}
