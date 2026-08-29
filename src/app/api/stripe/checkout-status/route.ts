import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { syncStripePaymentForSubmission } from "@/lib/stripe-payment-sync";

export async function GET(request: Request) {
  const session = await auth();
  const viewer = session?.user;

  if (!viewer?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const submissionId = searchParams.get("submission")?.trim() || "";

  if (!submissionId) {
    return NextResponse.json({ error: "missing_submission" }, { status: 400 });
  }

  const result = await syncStripePaymentForSubmission({
    submissionId,
    userId: viewer.id,
  });

  return NextResponse.json(result);
}
