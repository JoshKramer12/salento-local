import assert from "node:assert/strict";
import test from "node:test";

import type { MembershipReminderType } from "@prisma/client";

import {
  buildMembershipPaymentOutcomeEmail,
  buildMembershipReminderEmail,
  getMembershipReminderType,
  isHealthyAutomaticRenewal,
  resolveMembershipReminderRecipient,
  runDailyMembershipReminderJob,
  type MembershipReminderStore,
  type ReminderMembership,
} from "@/lib/membership-reminders";

const now = new Date("2027-01-01T10:00:00.000Z");
const at = (days: number) => new Date(now.getTime() + days * 86_400_000);

function membership(overrides: Partial<ReminderMembership> = {}): ReminderMembership {
  const business = overrides.business ?? {
    name: "Business A",
    ownerAccesses: [{ activatedAt: now, email: " Owner.A@Example.com ", updatedAt: now, userId: "owner-a", user: { legalAcceptances: [{ locale: "en" }] } }],
    submissions: [{ ownerEmail: "fallback@example.com", ownerHasNoEmail: false }],
  };
  return {
    annualPriceCents: 10000,
    automaticRenewal: true,
    business,
    businessId: "business-a",
    currentPeriodEnd: at(30),
    entitlementRevokedAt: null,
    graceEndsAt: at(44),
    id: "membership-a",
    recurringPaymentReady: true,
    stripeCancelAtPeriodEnd: false,
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
    stripeSubscriptionStatus: "active",
    ...overrides,
  };
}

class MemoryReminderStore implements MembershipReminderStore {
  records = new Map<string, { accepted: boolean; failed: boolean; id: string }>();
  constructor(private memberships: ReminderMembership[]) {}
  async listMemberships() { return this.memberships; }
  async claimReminder(params: { cycleEndsAt: Date; membershipId: string; now: Date; type: MembershipReminderType }) {
    const key = `${params.membershipId}:${params.cycleEndsAt.toISOString()}:${params.type}`;
    const existing = this.records.get(key);
    if (existing?.accepted) return null;
    const record = existing ?? { accepted: false, failed: false, id: key };
    record.failed = false;
    this.records.set(key, record);
    return { id: record.id };
  }
  async markAccepted(params: { id: string }) {
    for (const record of this.records.values()) if (record.id === params.id) record.accepted = true;
  }
  async markFailed(params: { id: string }) {
    for (const record of this.records.values()) if (record.id === params.id) record.failed = true;
  }
}

test("healthy automatic renewal requires the persisted active subscription state", () => {
  const healthy = membership();
  assert.equal(isHealthyAutomaticRenewal(healthy), true);
  for (const change of [
    { stripeCancelAtPeriodEnd: true },
    { recurringPaymentReady: false },
    { stripeSubscriptionId: null },
    { stripeCustomerId: null },
    { stripeSubscriptionStatus: "past_due" },
    { entitlementRevokedAt: now },
  ]) assert.equal(isHealthyAutomaticRenewal({ ...healthy, ...change }), false);
});

test("eligibility uses effective automatic renewal and UTC calendar-day windows", () => {
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: true, currentPeriodEnd: at(30), graceEndsAt: at(44), now }), "AUTO_30_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: true, currentPeriodEnd: at(7), graceEndsAt: at(21), now }), "AUTO_7_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: true, currentPeriodEnd: at(29), graceEndsAt: at(43), now }), null);
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: true, currentPeriodEnd: at(31), graceEndsAt: at(45), now }), null);
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: false, currentPeriodEnd: at(30), graceEndsAt: at(44), now }), "MANUAL_30_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: false, currentPeriodEnd: at(14), graceEndsAt: at(28), now }), "MANUAL_14_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: false, currentPeriodEnd: at(7), graceEndsAt: at(21), now }), "MANUAL_7_DAYS");
  assert.equal(getMembershipReminderType({ automaticRenewal: true, healthyAutomaticRenewal: true, entitlementRevokedAt: now, currentPeriodEnd: at(30), graceEndsAt: at(44), now }), null);
});

test("recipient resolution is business scoped, normalized, and prefers current owner access", () => {
  const resolved = resolveMembershipReminderRecipient(membership().business);
  assert.deepEqual(resolved, { email: "owner.a@example.com", locale: "en" });
  const fallback = resolveMembershipReminderRecipient({ name: "Business A", ownerAccesses: [{ activatedAt: null, email: "invalid", updatedAt: now, userId: null, user: null }], submissions: [{ ownerEmail: "  owner@example.com ", ownerHasNoEmail: false }] });
  assert.deepEqual(fallback, { email: "owner@example.com", locale: "it" });
  assert.equal(resolveMembershipReminderRecipient({ name: "Business A", ownerAccesses: [], submissions: [{ ownerEmail: "not-an-email", ownerHasNoEmail: false }] }), null);
  assert.equal(resolveMembershipReminderRecipient({ name: "Business A", ownerAccesses: [], submissions: [{ ownerEmail: "owner@example.com", ownerHasNoEmail: true }] }), null);
});

test("one simulated job sends only eligible business-specific emails and is cycle idempotent", async () => {
  const businessB = membership({ businessId: "business-b", id: "membership-b", currentPeriodEnd: at(200), graceEndsAt: at(214), business: { name: "Business B", ownerAccesses: [{ activatedAt: now, email: "owner@example.com", updatedAt: now, userId: "owner", user: { legalAcceptances: [{ locale: "en" }] } }], submissions: [] } });
  const businessC = membership({ businessId: "business-c", id: "membership-c", currentPeriodEnd: at(-20), graceEndsAt: at(-6), automaticRenewal: false, recurringPaymentReady: false, stripeCancelAtPeriodEnd: true, stripeSubscriptionStatus: "canceling", business: { name: "Business C", ownerAccesses: [{ activatedAt: now, email: "owner@example.com", updatedAt: now, userId: "owner", user: { legalAcceptances: [{ locale: "en" }] } }], submissions: [] } });
  const store = new MemoryReminderStore([membership(), businessB, businessC]);
  const messages: Array<{ subject: string; text: string; to: string }> = [];
  const sendEmail = async (message: { subject: string; text: string; to: string }) => { messages.push(message); return { messageId: `message-${messages.length}`, provider: "resend" as const, success: true }; };
  assert.deepEqual(await runDailyMembershipReminderJob({ now, sendEmail: sendEmail as never, store }), { sent: 2 });
  assert.equal(messages[0].text.includes("Business A"), true);
  assert.equal(messages[1].text.includes("Business C"), true);
  assert.equal(messages.some((message) => message.text.includes("Business B")), false);
  assert.deepEqual(await runDailyMembershipReminderJob({ now, sendEmail: sendEmail as never, store }), { sent: 0 });

  const future = membership({ currentPeriodEnd: at(395), graceEndsAt: at(409) });
  store.records.clear();
  const futureStore = new MemoryReminderStore([future]);
  assert.deepEqual(await runDailyMembershipReminderJob({ now: at(365), sendEmail: sendEmail as never, store: futureStore }), { sent: 1 });
});

test("a failed delivery remains retryable without marking a successful send", async () => {
  const store = new MemoryReminderStore([membership()]);
  const fail = async () => { throw new Error("provider unavailable"); };
  assert.deepEqual(await runDailyMembershipReminderJob({ now, sendEmail: fail as never, store }), { sent: 0 });
  const record = [...store.records.values()][0];
  assert.equal(record.accepted, false);
  assert.equal(record.failed, true);
  const succeed = async () => ({ messageId: "accepted", provider: "resend" as const, success: true });
  assert.deepEqual(await runDailyMembershipReminderJob({ now, sendEmail: succeed as never, store }), { sent: 1 });
});

test("English and Italian templates carry correct renewal, lifecycle, and outcome messaging", () => {
  const date = new Date("2027-01-31T10:00:00.000Z");
  const url = "https://salento.local/dashboard";
  const enAuto = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "en", manageUrl: url, type: "AUTO_30_DAYS" });
  const itAuto = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "it", manageUrl: url, type: "AUTO_30_DAYS" });
  assert.match(enAuto.subject, /renews in 30 days/); assert.match(enAuto.text, /€100\/year/); assert.match(enAuto.text, /No action is required/); assert.doesNotMatch(enAuto.text, /Renew membership/);
  assert.match(itAuto.subject, /rinnoverà tra 30 giorni/); assert.match(itAuto.text, /€100\/anno/); assert.match(itAuto.text, /Non è richiesta alcuna azione/);
  for (const type of ["AUTO_7_DAYS", "MANUAL_30_DAYS", "GRACE_START", "EXPIRES_TOMORROW", "EXPIRED"] as const) {
    const message = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "en", manageUrl: url, type });
    assert.match(message.text, /Masseria Test/);
    assert.match(message.html, /href="https:\/\/salento.local\/dashboard"/);
    assert.doesNotMatch(message.text, /€50/);
  }
  const manual = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "en", manageUrl: url, type: "MANUAL_30_DAYS" });
  assert.match(manual.text, /Automatic renewal is off/); assert.match(manual.text, /Renew membership/);
  const enGraceStart = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "en", manageUrl: url, type: "GRACE_START" });
  assert.equal(enGraceStart.subject, "Your membership has ended — 14 days to keep your Business Page visible");
  for (const phrase of ["GRACE PERIOD", "Masseria Test", "31 January 2027", "remains visible until", "€100/year", "prevent the page from becoming inactive", "business information will remain saved", "reactivate your Business Page later", "Renew membership: https://salento.local/dashboard"]) assert.equal(enGraceStart.text.includes(phrase), true, phrase);
  for (const phrase of ["will automatically renew", "No action is required", "Business Page is inactive", "information has been deleted"]) assert.equal(enGraceStart.text.includes(phrase), false, phrase);
  const itGraceStart = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "it", manageUrl: url, type: "GRACE_START" });
  assert.equal(itGraceStart.subject, "Il tuo abbonamento è terminato: hai ancora 14 giorni");
  for (const phrase of ["PERIODO DI GRAZIA", "Masseria Test", "31 gennaio 2027", "rimane visibile fino al", "€100/anno", "evitare che la pagina diventi inattiva", "I dati della tua attività rimarranno salvati", "riattivare la Pagina Attività in seguito", "Rinnova abbonamento: https://salento.local/dashboard"]) assert.equal(itGraceStart.text.includes(phrase), true, phrase);
  for (const phrase of ["si rinnoverà automaticamente", "Non è richiesta alcuna azione", "Pagina Attività è inattiva", "informazioni sono state eliminate"]) assert.equal(itGraceStart.text.includes(phrase), false, phrase);
  for (const locale of ["en", "it"] as const) {
    const graceWeek = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale, manageUrl: url, type: "GRACE_7_DAYS_LEFT" });
    const expiresTomorrow = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale, manageUrl: url, type: "EXPIRES_TOMORROW" });
    const expired = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale, manageUrl: url, type: "EXPIRED" });
    assert.equal(graceWeek.text.includes(locale === "en" ? "remains visible until" : "rimane visibile fino al"), true);
    assert.equal(graceWeek.text.includes(locale === "en" ? "information has been deleted" : "informazioni sono state eliminate"), false);
    assert.equal(expiresTomorrow.text.includes(locale === "en" ? "no longer be visible after" : "non sarà più visibile dopo"), true);
    assert.equal(expiresTomorrow.text.includes(locale === "en" ? "information has been deleted" : "informazioni sono state eliminate"), false);
    assert.equal(expired.text.includes(locale === "en" ? "information remains saved" : "informazioni della tua attività sono ancora salvate"), true);
    assert.equal(expired.text.includes(locale === "en" ? "Reactivate membership" : "Riattiva abbonamento"), true);
  }
  const expired = buildMembershipReminderEmail({ businessName: "Masseria Test", date, locale: "en", manageUrl: url, type: "EXPIRED" });
  assert.match(expired.text, /information remains saved/); assert.match(expired.text, /Reactivate membership/);
  const success = buildMembershipPaymentOutcomeEmail({ businessName: "Masseria Test", date, failed: false, locale: "en", manageUrl: url });
  const failure = buildMembershipPaymentOutcomeEmail({ businessName: "Masseria Test", date, failed: true, locale: "it", manageUrl: url });
  assert.match(success.text, /€100 was charged/); assert.match(success.text, /another year/);
  assert.match(failure.text, /Non siamo riusciti ad addebitare €100/); assert.doesNotMatch(failure.text, /Non è richiesta alcuna azione/);
});
