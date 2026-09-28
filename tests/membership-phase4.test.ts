import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMembershipReminderType } from "@/lib/membership-reminders";
import { PARTNER_RENEWAL_COMMISSION_CENTS } from "@/lib/partner-ledger";

const ledger = readFileSync("src/lib/partner-ledger.ts", "utf8");
const reminders = readFileSync("src/lib/membership-reminders.ts", "utf8");
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const legal = readFileSync("src/lib/legal.ts", "utf8");

test("renewals and reactivations use one €15 ledger commission keyed by paid payment", () => {
  assert.equal(PARTNER_RENEWAL_COMMISSION_CENTS, 1500);
  assert.match(ledger, /commission:renewal:\$\{paymentId\}/);
  assert.match(ledger, /payment\.purpose !== "ANNUAL_RENEWAL" && payment\.purpose !== "REACTIVATION"/);
  assert.match(ledger, /originatingPartnerUserId/);
  assert.match(webhook, /ensurePartnerRenewalCommissionForPayment/);
  assert.match(webhook, /reversePartnerCommissionForPayment/);
});

test("daily reminder schedule distinguishes automatic, manual, grace, and expiry windows", () => {
  const now = new Date("2027-01-01T10:00:00.000Z");
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
  assert.equal(getMembershipReminderType({ automaticRenewal: true, currentPeriodEnd: at(30), graceEndsAt: at(44), now }), "AUTO_30_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: false, currentPeriodEnd: at(14), graceEndsAt: at(28), now }), "MANUAL_14_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: false, currentPeriodEnd: now, graceEndsAt: at(14), now }), "GRACE_START");
  assert.equal(getMembershipReminderType({ automaticRenewal: false, currentPeriodEnd: at(-14), graceEndsAt: now, now }), "EXPIRED");
  assert.match(reminders, /membershipReminder\.create/);
  assert.match(reminders, /markFailed/);
  assert.match(reminders, /failureMessage/);
});

test("Partner terms and public copy disclose €50 initial plus €15 successful renewals without promising income", () => {
  assert.match(legal, /partner-terms-2026-09-27/);
  assert.match(legal, /EUR15/);
  assert.match(legal, /reddito futuro/);
});
