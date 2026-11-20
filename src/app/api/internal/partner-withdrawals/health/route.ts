import { NextResponse } from "next/server";
import { normalizeEnvValue } from "@/lib/env";
import { workerSecretAuthorized } from "@/lib/partner-withdrawal-worker-auth";
import { scanPartnerCashoutHealth } from "@/lib/partner-withdrawal-monitoring";
import { scanCashoutProviderInventory } from "@/lib/partner-cashout-independent-reconciliation";

/** Read-only health identity for an independent monitor. It cannot reach the
 * worker's POST route unless the two secrets are misconfigured as identical. */
export async function GET(request: Request) {
  const monitorSecret = normalizeEnvValue(process.env.PARTNER_CASHOUT_MONITOR_SECRET);
  const workerSecret = normalizeEnvValue(process.env.PARTNER_WITHDRAWAL_WORKER_SECRET);
  if (!monitorSecret || (workerSecret && monitorSecret === workerSecret)) {
    return NextResponse.json({ error: "cashout_monitor_not_configured" }, { status: 503 });
  }
  if (!workerSecretAuthorized(request, monitorSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const since = new URL(request.url).searchParams.get("inventorySince");
  if (since !== null) {
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "cashout_inventory_window_invalid" }, { status: 400 });
    }
    // Inventory runs beside the SQLite volume using only provider GETs. The
    // remote monitor needs neither the production DB nor Stripe/worker keys.
    return NextResponse.json(await scanCashoutProviderInventory(date), {
      headers: { "cache-control": "no-store" },
    });
  }
  return NextResponse.json(await scanPartnerCashoutHealth(), {
    headers: { "cache-control": "no-store" },
  });
}
