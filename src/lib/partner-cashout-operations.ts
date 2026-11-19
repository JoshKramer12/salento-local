import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CashoutIncident } from "@/lib/partner-withdrawal-monitoring";

export type ControlState = {
  version: 1;
  lastWorkerRunAt: string | null;
  lastReconciliationRunAt: string | null;
  alerts: Record<string, { firstSeenAt: string; lastSeenAt: string; deliveredAt: string | null;
    acknowledgedAt: string | null; resolvedAt: string | null; deliveryCount: number }>;
};

export function emptyControlState(): ControlState {
  return { version: 1, lastWorkerRunAt: null, lastReconciliationRunAt: null, alerts: {} };
}

export function missingRunIncidents(state: ControlState, now: Date, expected: {
  worker: boolean; reconciliation: boolean; maximumGapMinutes: number;
}): CashoutIncident[] {
  const incidents: CashoutIncident[] = [];
  for (const [kind, enabled, timestamp] of [
    ["worker", expected.worker, state.lastWorkerRunAt],
    ["reconciliation", expected.reconciliation, state.lastReconciliationRunAt],
  ] as const) {
    if (!enabled) continue;
    const last = timestamp ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(last) || last > now.getTime() + 60_000 ||
        now.getTime() - last > expected.maximumGapMinutes * 60_000) {
      incidents.push({ key: `cashout:schedule:${kind}:missing`, code: `${kind}_run_missing`, severity: "critical" });
    }
  }
  return incidents;
}

export function reconcileAlerts(state: ControlState, incidents: CashoutIncident[], now: Date,
  preservePrefixes: string[] = []) {
  const timestamp = now.toISOString();
  const current = new Set(incidents.map((item) => item.key));
  const toDeliver: CashoutIncident[] = [];
  for (const item of incidents) {
    if (!/^cashout:[A-Za-z0-9:_-]{1,220}$/.test(item.key)) throw new Error("cashout_alert_key_invalid");
    const previous = state.alerts[item.key];
    if (!previous || previous.resolvedAt) {
      state.alerts[item.key] = { firstSeenAt: timestamp, lastSeenAt: timestamp,
        deliveredAt: null, acknowledgedAt: null, resolvedAt: null, deliveryCount: 0 };
      toDeliver.push(item);
    } else {
      previous.lastSeenAt = timestamp;
      if (!previous.deliveredAt && !previous.acknowledgedAt) toDeliver.push(item);
    }
  }
  for (const [key, record] of Object.entries(state.alerts)) {
    if (!current.has(key) && !record.resolvedAt &&
        !preservePrefixes.some((prefix) => key.startsWith(prefix))) record.resolvedAt = timestamp;
  }
  return toDeliver;
}

export async function loadControlState(path: string): Promise<ControlState> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyControlState();
    throw error;
  }
  const value = JSON.parse(raw) as Partial<ControlState>;
  if (value.version !== 1 || !value.alerts || typeof value.alerts !== "object") {
    throw new Error("cashout_control_state_invalid");
  }
  return value as ControlState;
}

export async function saveControlState(path: string, state: ControlState) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
}

/** One owner is required. A stranded lock causes a visible failure; operators
 * must inspect and remove it rather than silently running concurrent controls. */
export async function withControlLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(`${path}.lock`, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await action();
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
