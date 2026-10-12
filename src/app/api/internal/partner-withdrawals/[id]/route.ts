import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import {
  attachVerifiedPaypalBatch, cancelUnsentManualWithdrawal, confirmManualWithdrawalSettlement, continueStripeWithdrawalPayout,
  getWithdrawalAdminReview, processPartnerWithdrawal, reconcilePartnerWithdrawal,
  recordManualTransferInitiated, recordManualWithdrawalException, recordVerifiedManualBankReturn,
  revealManualWithdrawalDestination,
} from "@/lib/partner-withdrawal-processing";
import { PartnerWithdrawalError } from "@/lib/partner-withdrawals";

type Context = { params: Promise<{ id: string }> };

async function adminId() {
  const viewer = (await auth())?.user;
  return viewer?.role === "ADMIN" ? viewer.id : null;
}

function errorResponse(error: unknown) {
  if (!(error instanceof PartnerWithdrawalError)) throw error;
  const status = error.code === "admin_required" ? 403 :
    error.code === "withdrawal_missing" ? 404 :
    error.code === "withdrawal_processing_disabled" || error.code === "withdrawal_reconciliation_disabled" ? 404 : 409;
  return NextResponse.json({ error: error.code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, context: Context) {
  const actorUserId = await adminId();
  if (!actorUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getWithdrawalAdminReview(actorUserId, (await context.params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  const actorUserId = await adminId();
  if (!actorUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const requestId = (await context.params).id;
  try {
    let result;
    switch (input.action) {
      case "process": result = await processPartnerWithdrawal({ actorUserId, requestId }); break;
      case "continue-stripe-payout": result = await continueStripeWithdrawalPayout({ actorUserId, requestId }); break;
      case "attach-paypal-batch":
        if (typeof input.batchId !== "string") break;
        result = await attachVerifiedPaypalBatch({ actorUserId, requestId, batchId: input.batchId }); break;
      case "reconcile": result = await reconcilePartnerWithdrawal({ actorUserId, requestId }); break;
      case "reveal-bank-destination": result = await revealManualWithdrawalDestination(actorUserId, requestId); break;
      case "manual-initiated":
        if (typeof input.reference !== "string" || typeof input.bankName !== "string") break;
        result = await recordManualTransferInitiated({ actorUserId, requestId, reference: input.reference, bankName: input.bankName }); break;
      case "manual-settled":
        if (typeof input.evidence !== "string" || input.confirmedReceived !== true) break;
        result = await confirmManualWithdrawalSettlement({ actorUserId, requestId, evidence: input.evidence, confirmedReceived: true }); break;
      case "manual-exception":
        if (typeof input.evidence !== "string" || !["FAILED", "RETURNED", "UNCERTAIN"].includes(String(input.outcome))) break;
        result = await recordManualWithdrawalException({ actorUserId, requestId, outcome: input.outcome as "FAILED" | "RETURNED" | "UNCERTAIN", evidence: input.evidence }); break;
      case "verified-bank-return":
        if (typeof input.bankReturnReference !== "string" || typeof input.amountCents !== "number" ||
            typeof input.evidence !== "string" || input.verifiedReturned !== true) break;
        result = await recordVerifiedManualBankReturn({ actorUserId, requestId, bankReturnReference: input.bankReturnReference,
          amountCents: input.amountCents, evidence: input.evidence, verifiedReturned: true }); break;
      case "cancel-unsent":
        if (typeof input.confirmation !== "string") break;
        result = await cancelUnsentManualWithdrawal({ actorUserId, requestId, confirmation: input.confirmation }); break;
    }
    if (!result) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
