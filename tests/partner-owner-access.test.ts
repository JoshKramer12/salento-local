import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPartnerOwnerAccessContext, isValidPartnerSubmissionId } from "@/lib/partner-owner-access";
import { buildPartnerOwnerWhatsAppMessage, getOrCreateOwnerAccessDeliveryInvitation, getOwnerWhatsAppDeepLink } from "@/lib/business-owner-access";

const submissionId = "cmabcdefghijklmnopqrstuvw";
const business = { id: "cmbusinessabcdefghijklmnop", name: "Masseria del Sole", slug: "masseria-del-sole" };

function fakeDb(params: {
  access?: { activatedAt?: Date | null; email: string | null; phone: string | null; sourceSubmissionId: string | null; userId: string | null; user?: { email: string | null } | null } | null;
  ownerPhone?: string;
  partnerId?: string;
}) {
  const access = params.access === undefined ? { email: "owner@example.com", phone: null, sourceSubmissionId: submissionId, userId: null, user: null } : params.access;
  return {
    businessSubmission: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.deepEqual(where, { id: submissionId, userId: "partner-1", status: "PUBLISHED", paymentStatus: "PAID", createdBusinessId: { not: null } });
      return params.partnerId === "partner-1" ? { id: submissionId, ownerName: "Giulia Bianchi", ownerPhone: params.ownerPhone ?? "+39 333 123 4567", createdBusiness: business } : null;
    } },
    businessOwnerAccess: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.businessId, business.id);
      return where.userId ? access?.userId && access.activatedAt ? { id: "access-1", ...access } : null : access ? { id: "access-1", ...access } : null;
    } },
  };
}

test("owner contacts determine methods regardless of original onboarding path", async () => {
  const both = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1" }) as never, partnerId: "partner-1", submissionId });
  assert.equal(both?.email, "owner@example.com");
  assert.equal(both?.phone, "+393331234567");

  const emailOnly = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1", ownerPhone: "invalid" }) as never, partnerId: "partner-1", submissionId });
  assert.equal(emailOnly?.email, "owner@example.com");
  assert.equal(emailOnly?.phone, null);

  const whatsappOnly = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1", access: { email: null, phone: "+393331234567", sourceSubmissionId: submissionId, userId: null } }) as never, partnerId: "partner-1", submissionId });
  assert.equal(whatsappOnly?.email, null);
  assert.equal(whatsappOnly?.phone, "+393331234567");

  const laterEmail = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1", access: { email: "new@example.com", phone: "+393331234567", sourceSubmissionId: submissionId, userId: null } }) as never, partnerId: "partner-1", submissionId });
  assert.equal(laterEmail?.email, "new@example.com");
  assert.equal(laterEmail?.phone, "+393331234567");
});

test("attached owner uses their account email and does not inherit a former owner's phone", async () => {
  const result = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1", access: { activatedAt: new Date(), email: null, phone: null, sourceSubmissionId: "another-submission", userId: "owner-1", user: { email: "current@example.com" } } }) as never, partnerId: "partner-1", submissionId });
  assert.equal(result?.attached, true);
  assert.equal(result?.email, "current@example.com");
  assert.equal(result?.phone, null);
});

test("an unactivated phone record does not expose a linked account email", async () => {
  const result = await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1", access: { activatedAt: null, email: null, phone: "+393331234567", sourceSubmissionId: submissionId, userId: "legacy-link", user: { email: "unrelated@example.com" } } }) as never, partnerId: "partner-1", submissionId });
  assert.equal(result?.attached, false);
  assert.equal(result?.email, null);
  assert.equal(result?.phone, "+393331234567");
});

test("another partner and malformed identifiers cannot resolve owner contacts", async () => {
  assert.equal(await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "other-partner" }) as never, partnerId: "partner-1", submissionId }), null);
  assert.equal(isValidPartnerSubmissionId("../another-business"), false);
  assert.equal(await getPartnerOwnerAccessContext({ db: fakeDb({ partnerId: "partner-1" }) as never, partnerId: "partner-1", submissionId: "bad" }), null);
});

test("WhatsApp handoff uses the owner's validated phone and Italian secure-link message", () => {
  const message = buildPartnerOwnerWhatsAppMessage({ businessName: business.name, ownerName: "Giulia Bianchi", manageUrl: "https://example.com/owner-access/opaque", viewUrl: "https://example.com/businesses/masseria-del-sole" });
  const href = getOwnerWhatsAppDeepLink({ message, phone: "+39 333 123 4567" });
  assert.ok(href?.startsWith("https://wa.me/393331234567?text="));
  assert.match(decodeURIComponent(href!), /Crea il tuo account/);
  assert.match(decodeURIComponent(href!), /https:\/\/example.com\/owner-access\/opaque/);
  const attached = buildPartnerOwnerWhatsAppMessage({ attached: true, businessName: business.name, ownerName: "Giulia Bianchi", manageUrl: "https://example.com/login?redirectTo=%2Fdashboard", viewUrl: "https://example.com/businesses/masseria-del-sole" });
  assert.match(attached, /Accedi al tuo account/);
  assert.doesNotMatch(attached, /Crea il tuo account/);
});

test("used or expired owner invitations are replaced through the existing token issuer", async () => {
  for (const oldState of ["used", "expired"]) {
    let created = 0;
    const db = { businessOwnerAccessInvitation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.usedAt, null);
        assert.equal(where.revokedAt, null);
        assert.ok(where.expiresAt);
        return null;
      },
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: { data: Record<string, unknown> }) => { created += 1; return data; },
    } };
    const result = await getOrCreateOwnerAccessDeliveryInvitation({ accessId: `access-${oldState}`, db: db as never });
    assert.equal(created, 1);
    assert.ok(result.token.length >= 40);
    assert.notEqual(result.token, "old-token");
  }
});

test("dashboard, endpoint, and spinner retain security and processing constraints", () => {
  const dashboard = readFileSync("src/components/account/partner-dashboard.tsx", "utf8");
  const list = readFileSync("src/components/account/partner-submissions.tsx", "utf8");
  const route = readFileSync("src/app/api/partner/owner-access/route.ts", "utf8");
  const service = readFileSync("src/lib/partner-owner-access.ts", "utf8");
  const spinner = readFileSync("src/app/globals.css", "utf8");
  const payment = readFileSync("src/components/account/no-email-payment-form.tsx", "utf8");
  assert.match(dashboard, /PartnerOwnerAccess locale=\{locale\}/);
  assert.match(list, /PartnerOwnerAccess locale=\{locale\}/);
  assert.match(route, /session\?\.user\?\.role === "GETTER"/);
  assert.match(route, /limit: input\.method === "email" \? 1 : 10/);
  assert.match(route, /windowMs: input\.method === "email" \? 5 \* 60_000/);
  assert.match(service, /userId: params\.partnerId/);
  assert.match(service, /getOrCreateOwnerAccessDeliveryInvitation/);
  assert.match(service, /context\.attached\s*\? `\$\{appUrl\}\/login/);
  assert.match(spinner, /@keyframes payment-processing-rotate\s*\{\s*to\s*\{\s*transform: rotate\(360deg\)/);
  assert.match(spinner, /animation: payment-processing-rotate 800ms linear infinite/);
  assert.match(spinner, /prefers-reduced-motion: reduce/);
  assert.match(payment, /disabled=\{!stripe \|\| !elements \|\| busy\}/);
  assert.match(payment, /setBusy\(false\)/);
  assert.match(payment, /window\.location\.assign\(returnUrl\)/);
});
