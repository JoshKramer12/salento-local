import { openBusinessSubmissionPaymentAction } from "@/app/(account)/actions";
import { getPaymentQrOpeningError } from "@/lib/payment-qr-navigation";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!hasSameOriginOrNoOrigin(request)) {
    return Response.json(
      { error: getPaymentQrOpeningError("en"), ok: false },
      { status: 403 },
    );
  }

  const formData = await request.formData();
  const result = await openBusinessSubmissionPaymentAction(formData);

  return Response.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
