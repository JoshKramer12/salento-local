import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { POST } from "@/app/api/internal/membership-reminders/route";
import { prisma } from "@/lib/prisma";

const directory = mkdtempSync(join(tmpdir(), "salento-payment-email-retry-route-"));
writeFileSync(join(directory, "isolated.db"), "");
process.env.DATABASE_URL = `file:${join(directory, "isolated.db")}`;
process.env.MEMBERSHIP_REMINDER_CRON_SECRET = "isolated-retry-secret";
process.env.PAY_LATER_ENABLED = "true";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env: process.env, stdio: "pipe" });
after(async () => { await prisma.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("the authenticated outcomes-only caller invokes both email retry scans without daily reminders", async () => {
  const url = "http://localhost/api/internal/membership-reminders?outcomes=only";
  const denied = await POST(new Request(url, { method: "POST", headers: { authorization: "Bearer wrong" } }));
  assert.equal(denied.status, 401);
  const response = await POST(new Request(url, { method: "POST", headers: {
    authorization: `Bearer ${process.env.MEMBERSHIP_REMINDER_CRON_SECRET}`,
  } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.partnerCommissions, { accepted: 0, due: 0 });
  assert.deepEqual(body.bankInstructions, { attempted: 0, due: 0 });
  assert.equal("payLater" in body, false);
});
