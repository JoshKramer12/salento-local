import { isAbsolute } from "node:path";
import { prisma } from "@/lib/prisma";
import { scanCashoutProviderInventory } from "@/lib/partner-cashout-independent-reconciliation";
import { loadControlState, missingRunIncidents, reconcileAlerts, saveControlState, withControlLock } from "@/lib/partner-cashout-operations";
import { assertStage5aSandboxIsolation } from "@/lib/stage5a-sandbox-isolation";
import type { CashoutIncident } from "@/lib/partner-withdrawal-monitoring";

const mode = process.argv.find((item) => item.startsWith("--mode="))?.slice(7);
const statePath = process.env.PARTNER_CASHOUT_CONTROL_STATE_FILE ?? "";

function checkedUrl(raw: string | undefined, allowLocal = false) {
  if (!raw) throw new Error("cashout_control_url_missing");
  const url = new URL(raw);
  const sandbox = process.env.STAGE5A_ISOLATED_SANDBOX === "salento-stage5a-connect";
  if (url.protocol !== "https:" && !(sandbox && allowLocal && url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("cashout_control_url_unsafe");
  }
  if (url.protocol === "http:") assertStage5aSandboxIsolation(process.env);
  return url;
}

function workerUrl() {
  const url = checkedUrl(process.env.PARTNER_CASHOUT_WORKER_URL, true);
  if (url.pathname !== "/api/internal/partner-withdrawals/run" || url.search || url.hash) {
    throw new Error("cashout_worker_url_invalid");
  }
  return url;
}

async function workerCall(kind: "worker" | "reconciliation") {
  const secret = process.env.PARTNER_WITHDRAWAL_WORKER_SECRET;
  if (!secret) throw new Error("cashout_worker_secret_missing");
  const url = workerUrl();
  if (kind === "reconciliation") url.searchParams.set("reconcile", "1");
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`cashout_${kind}_http_${response.status}`);
  const result = await response.json() as { status?: string };
  if (result.status !== "ran" && result.status !== "paused") throw new Error("cashout_worker_response_invalid");
  if (result.status === "paused" && process.env.PARTNER_CASHOUT_EXPECT_WORKER === "true" && kind === "worker") {
    throw new Error("cashout_worker_paused_unexpectedly");
  }
  return result;
}

async function deliverAlert(item: CashoutIncident, asOf: string) {
  const url = checkedUrl(process.env.PARTNER_CASHOUT_ALERT_URL, true);
  const token = process.env.PARTNER_CASHOUT_ALERT_TOKEN;
  if (!token || token.length < 16) throw new Error("cashout_alert_token_missing");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`,
      "idempotency-key": item.key },
    body: JSON.stringify({ ...item, asOf }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`cashout_alert_http_${response.status}`);
}

async function controlRun() {
  const now = new Date();
  const state = await loadControlState(statePath);
  const incidents: CashoutIncident[] = [];
  const maximumGapMinutes = Number(process.env.PARTNER_CASHOUT_MAX_RUN_GAP_MINUTES ?? "10");
  if (!Number.isSafeInteger(maximumGapMinutes) || maximumGapMinutes < 2 || maximumGapMinutes > 1440) {
    throw new Error("cashout_run_gap_invalid");
  }
  incidents.push(...missingRunIncidents(state, now, {
    worker: process.env.PARTNER_CASHOUT_EXPECT_WORKER === "true",
    reconciliation: process.env.PARTNER_CASHOUT_EXPECT_RECONCILIATION === "true",
    maximumGapMinutes,
  }));
  let healthScanFailed = false;
  try {
    const secret = process.env.PARTNER_WITHDRAWAL_WORKER_SECRET;
    if (!secret) throw new Error("cashout_worker_secret_missing");
    const url = workerUrl();
    url.searchParams.set("health", "1");
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`cashout_health_http_${response.status}`);
    const health = await response.json() as { incidents?: CashoutIncident[] };
    if (!Array.isArray(health.incidents)) throw new Error("cashout_health_payload_invalid");
    incidents.push(...health.incidents);
  } catch {
    healthScanFailed = true;
    incidents.push({ key: "cashout:control:health_scan_failed", code: "health_scan_failed", severity: "critical" });
  }
  let providerScanFailed = false;
  let providerSummary: unknown = null;
  try {
    const since = process.env.PARTNER_CASHOUT_PROVIDER_SCAN_SINCE;
    if (!since) throw new Error("cashout_inventory_since_missing");
    const result = await scanCashoutProviderInventory(new Date(since));
    providerSummary = { asOf: result.asOf, since: result.since, mode: result.mode, counts: result.counts,
      totals: result.totals, connectedBalances: result.connectedBalances };
    incidents.push(...result.incidents);
  } catch {
    providerScanFailed = true;
    incidents.push({ key: "cashout:control:provider_scan_failed", code: "provider_scan_failed", severity: "critical" });
  }
  const unique = [...new Map(incidents.map((item) => [item.key, item])).values()];
  const pending = reconcileAlerts(state, unique, now, [
    ...(healthScanFailed ? ["cashout:"] : []),
    ...(providerScanFailed ? ["cashout:provider:"] : []),
  ]);
  await saveControlState(statePath, state);
  let delivered = 0;
  let deliveryFailures = 0;
  for (const item of pending) {
    try {
      await deliverAlert(item, now.toISOString());
      const record = state.alerts[item.key];
      record.deliveredAt = new Date().toISOString();
      record.deliveryCount++;
      await saveControlState(statePath, state);
      delivered++;
    } catch {
      deliveryFailures++;
    }
  }
  const summary = { asOf: now.toISOString(), healthScanFailed, providerScanFailed,
    incidents: unique, pending: pending.length, delivered, deliveryFailures, providerSummary };
  console.log(JSON.stringify(summary));
  if (healthScanFailed || providerScanFailed || deliveryFailures) process.exitCode = 1;
}

async function main() {
  if (process.env.PARTNER_CASHOUT_CONTROL_ENABLED !== "true" || !isAbsolute(statePath) ||
      !statePath.endsWith(".json")) {
    throw new Error("cashout_control_disabled_or_state_path_invalid");
  }
  await withControlLock(statePath, async () => {
    if (mode === "worker" || mode === "reconciliation") {
      const result = await workerCall(mode);
      const state = await loadControlState(statePath);
      if (mode === "worker") state.lastWorkerRunAt = new Date().toISOString();
      else state.lastReconciliationRunAt = new Date().toISOString();
      await saveControlState(statePath, state);
      console.log(JSON.stringify({ mode, at: new Date().toISOString(), result }));
    } else if (mode === "control") {
      await controlRun();
    } else if (mode === "ack") {
      const key = process.argv.find((item) => item.startsWith("--key="))?.slice(6);
      if (!key) throw new Error("cashout_alert_key_missing");
      const state = await loadControlState(statePath);
      if (!state.alerts[key] || state.alerts[key].resolvedAt || !state.alerts[key].deliveredAt) {
        throw new Error("cashout_alert_not_active_or_delivered");
      }
      state.alerts[key].acknowledgedAt = new Date().toISOString();
      await saveControlState(statePath, state);
      console.log(JSON.stringify({ acknowledged: key }));
    } else {
      throw new Error("cashout_control_mode_invalid");
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^cashout_[a-z0-9_]+$/.test(error.message) ? error.message : "cashout_control_failed";
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
