import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { buildSignedAgreementPdf, getSignedAgreementData } from "@/lib/receipts";

type RouteContext = { params: Promise<{ submissionId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { submissionId } = await context.params;
  const { searchParams } = new URL(request.url);
  const checkoutSessionId = searchParams.get("session")?.trim() || null;
  const viewer = checkoutSessionId ? null : (await auth())?.user;
  const agreement = await getSignedAgreementData({
    allowInternal: Boolean(checkoutSessionId),
    checkoutSessionId,
    submissionId,
    viewerId: viewer?.id ?? null,
    viewerRole: viewer?.role ?? null,
  });
  if (!agreement) return NextResponse.json({ error: "agreement_not_available" }, { status: 404 });

  const locale = searchParams.get("locale") === "en" ? "en" : "it";
  const pdfBytes = await buildSignedAgreementPdf({ agreement, locale });
  const attachment = searchParams.get("download") === "1";
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${agreement.agreementFileName}"`,
      "Content-Type": "application/pdf",
    },
  });
}
