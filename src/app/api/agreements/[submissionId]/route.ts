import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildSignedAgreementPdf, getSignedAgreementData } from "@/lib/receipts";
import { findInitialElementTokenPayment } from "@/lib/no-email-payment";

type RouteContext = { params: Promise<{ submissionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { submissionId } = await context.params;
  const { searchParams } = new URL(request.url);
  const checkoutSessionId = searchParams.get("session")?.trim() || null;
  const paymentToken = searchParams.get("payment_token")?.trim() || null;
  const tokenPayment = paymentToken ? await findInitialElementTokenPayment(paymentToken, { paid: true, submissionId }) : null;
  const viewer = checkoutSessionId || tokenPayment ? null : (await auth())?.user;
  const agreement = await getSignedAgreementData({
    allowInternal: Boolean(checkoutSessionId || tokenPayment),
    checkoutSessionId,
    submissionId,
    viewerId: viewer?.id ?? null,
    viewerRole: viewer?.role ?? null,
  });
  if (!agreement) return NextResponse.json({ error: "agreement_not_available" }, { status: 404 });

  // Agreements are Italian legal records regardless of the surrounding site locale.
  const pdfBytes = await buildSignedAgreementPdf({ agreement });
  const attachment = searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${agreement.agreementFileName}"`,
      "Content-Type": "application/pdf",
    },
  });
}
