import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
import { workerSecretAuthorized } from "@/lib/partner-withdrawal-worker-auth";
import { scanPartnerCashoutHealth } from "@/lib/partner-withdrawal-monitoring";
import {
  runPartnerWithdrawalReconciliationWorker, runPartnerWithdrawalWorker,
} from "@/lib/partner-withdrawal-processing";

export async function POST(request: Request) {
  const secret = normalizeEnvValue(process.env.PARTNER_WITHDRAWAL_WORKER_SECRET);
  if (!secret) return NextResponse.json({ error: "withdrawal_worker_not_configured" }, { status: 503 });
  if (!workerSecretAuthorized(request, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(request.url).searchParams.get("health") === "1") {
    return NextResponse.json(await scanPartnerCashoutHealth());
  }
  const reconcile = new URL(request.url).searchParams.get("reconcile") === "1";
  const result = reconcile
    ? await runPartnerWithdrawalReconciliationWorker()
    : await runPartnerWithdrawalWorker();
  return NextResponse.json(result);
}
