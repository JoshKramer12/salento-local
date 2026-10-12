import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";
import { createPartnerWithdrawalRequest, PartnerWithdrawalError } from "@/lib/partner-withdrawals";
import { getPartnerWithdrawalDashboard } from "@/lib/partner-withdrawal-dashboard";

export async function GET() {
  const viewer = (await auth())?.user;
  if (!viewer?.id || viewer.role !== "GETTER") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getPartnerWithdrawalDashboard(viewer.id), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const viewer = (await auth())?.user;
  if (!viewer?.id || viewer.role !== "GETTER") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOriginOrNoOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).idempotencyKey !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const result = await createPartnerWithdrawalRequest({
      partnerUserId: viewer.id,
      idempotencyKey: (body as Record<string, string>).idempotencyKey,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PartnerWithdrawalError) {
      const status = error.code === "cashout_disabled" ? 404 :
        error.code === "partner_required" ? 403 :
        error.code === "invalid_idempotency_key" ? 400 :
        error.code === "withdrawal_already_open" || error.code === "commission_reservation_changed" || error.code === "withdrawal_write_conflict" ? 409 :
        error.code === "below_minimum_payout" || error.code === "payout_destination_unavailable" ? 422 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    throw error;
  }
}
