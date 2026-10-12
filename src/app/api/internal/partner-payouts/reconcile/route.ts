import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncPendingPaypalPayouts } from "@/lib/partner-ledger";
import { partnerCashoutReconciliationEnabled } from "@/lib/partner-payout-mode";

/** Independent monitoring endpoint. It does not initiate weekly payouts. */
export async function POST(request: Request) {
  const secret = process.env.PAYOUT_JOB_SECRET?.trim();
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "").trim();
  if (!secret) return NextResponse.json({ error: "payout_job_secret_not_configured" }, { status: 500 });
  if (!token || Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!partnerCashoutReconciliationEnabled()) return NextResponse.json({ error: "reconciliation_disabled" }, { status: 404 });
  await syncPendingPaypalPayouts();
  return NextResponse.json({ ok: true });
}
