import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerListingEmailCopy,
  buildPartnerOwnerWhatsAppMessage,
  canManageBusiness,
  canOfferNoEmailOwnerWhatsAppHandoff,
  ensureOwnerAccessForPublishedSubmission,
  findUserByNormalizedEmail,
  getOwnerAccountPrefill,
  getOrCreateOwnerAccessDeliveryInvitation,
  getOwnerAccessInvitationExpiry,
  getOwnerAccessUrl,
  buildOwnerWhatsAppMessage,
  getOwnerWhatsAppDeepLink,
} from "@/lib/business-owner-access";
import { sendPurchaseConfirmationForSubmission } from "@/lib/receipts";

test("the paid owner email uses the owner identity and secure, absolute business links", () => {
  const copy = buildOwnerListingEmailCopy({
    businessName: "Masseria del Sole",
    locale: "it",
    manageUrl: "https://salentolocal.com/owner-access/secure-opaque-token",
    ownerName: "Giulia Bianchi",
    receiptUrl: "https://salentolocal.com/api/receipts/submission-1?session=cs_test_1",
    viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
  });

  assert.equal(copy.subject, "La tua attività è ora su Salento Local");
  assert.match(copy.html, /Ciao Giulia/);
  assert.match(copy.html, /Masseria del Sole/);
  assert.match(copy.html, /Visualizza la tua attività/);
  assert.match(copy.html, /Gestisci la tua attività/);
  assert.match(copy.html, /href="https:\/\/salentolocal\.com\/businesses\/masseria-del-sole"/);
  assert.match(copy.html, /href="https:\/\/salentolocal\.com\/owner-access\/secure-opaque-token"/);
  assert.match(copy.text, /https:\/\/salentolocal\.com\/owner-access\/secure-opaque-token/);
});

test("a paid listing sends the owner email once to the normalized owner-access recipient", async () => {
  const sent: unknown[] = [];
  const marked: string[] = [];
  const receipt = {
    recipientEmail: "giulia@example.com",
    submission: {
      ownerEmail: " Giulia@Example.com ",
      ownerHasNoEmail: false,
      purchaseConfirmationSentAt: null,
    },
  };

  const result = await sendPurchaseConfirmationForSubmission(
    { locale: "it", submissionId: "submission-1" },
    {
      getReceiptData: async () => receipt as never,
      markPurchaseConfirmationSent: async (submissionId) => marked.push(submissionId),
      sendOwnerAccessInvitationForSubmission: async () => ({
        businessName: "Masseria del Sole",
        manageUrl: "https://salentolocal.com/owner-access/opaque-token",
        ownerName: "Giulia Bianchi",
        recipient: "giulia@example.com",
        viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
      }),
      sendReceiptEmail: async (params) => {
        sent.push(params);
        return true;
      },
    },
  );

  assert.equal(result, true);
  assert.deepEqual(marked, ["submission-1"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    locale: "it",
    ownerActions: {
      manageUrl: "https://salentolocal.com/owner-access/opaque-token",
      ownerName: "Giulia Bianchi",
      viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
    },
    recipientEmail: "giulia@example.com",
    receipt,
  });
});

test("an owner without email does not create access or send an email", async () => {
  let createdAccess = false;
  let sentEmail = false;
  const result = await sendPurchaseConfirmationForSubmission(
    { locale: "it", submissionId: "submission-2" },
    {
      getReceiptData: async () => ({
        recipientEmail: "partner@example.com",
        submission: {
          ownerEmail: "",
          ownerHasNoEmail: true,
          purchaseConfirmationSentAt: null,
        },
      }) as never,
      sendOwnerAccessInvitationForSubmission: async () => {
        createdAccess = true;
        return null;
      },
      sendReceiptEmail: async () => {
        sentEmail = true;
        return true;
      },
    },
  );

  assert.equal(result, false);
  assert.equal(createdAccess, false);
  assert.equal(sentEmail, false);
});

test("a repeated payment/webhook finalization does not send the owner email again", async () => {
  let sentEmail = false;
  const result = await sendPurchaseConfirmationForSubmission(
    { locale: "it", submissionId: "submission-3" },
    {
      getReceiptData: async () => ({
        recipientEmail: "giulia@example.com",
        submission: {
          ownerEmail: "giulia@example.com",
          ownerHasNoEmail: false,
          purchaseConfirmationSentAt: new Date(),
        },
      }) as never,
      sendReceiptEmail: async () => {
        sentEmail = true;
        return true;
      },
    },
  );

  assert.equal(result, false);
  assert.equal(sentEmail, false);
});

test("a paid Partner submission creates pending owner access using the normalized owner email", async () => {
  const writes: unknown[] = [];
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      create: async (value: { data: unknown }) => ({ id: "access-1", ...value.data }),
      findFirst: async () => null,
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-1",
        id: "submission-1",
        ownerEmail: " Mario@Example.COM ",
        ownerHasNoEmail: false,
      }),
    },
    user: { findUnique: async () => null },
  };

  const access = await ensureOwnerAccessForPublishedSubmission({
    db: db as never,
    submissionId: "submission-1",
  });

  assert.equal(access?.email, "mario@example.com");
  assert.equal(access?.userId, null);
  assert.equal(writes.length, 0);
});

test("owner account setup pre-fills only data already collected for the invited owner", () => {
  assert.deepEqual(
    getOwnerAccountPrefill({
      email: " Mario@Example.COM ",
      ownerName: " Mario Rossi ",
    }),
    { email: "mario@example.com", firstName: "Mario", lastName: "Rossi", name: "Mario Rossi", phone: "" },
  );
  assert.deepEqual(
    getOwnerAccountPrefill({ email: "mario@example.com", ownerName: null }),
    { email: "mario@example.com", firstName: "", lastName: "", name: "", phone: "" },
  );
});

test("a legacy differently-cased account is found without creating a second owner account", async () => {
  const rawValues: unknown[] = [];
  const db = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      rawValues.push(...values);
      return [{ id: "owner-1" }];
    },
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        where.id ? { email: "Mario@Example.com", id: where.id } : null,
    },
  };

  const user = await findUserByNormalizedEmail({ db: db as never, email: "mario@example.com" });
  assert.deepEqual(user, { email: "Mario@Example.com", id: "owner-1" });
  assert.deepEqual(rawValues, ["mario@example.com"]);
});

test("an existing account is attached without creating a duplicate user", async () => {
  const writes: unknown[] = [];
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      create: async (value: { data: unknown }) => ({ id: "access-2", ...value.data }),
      findFirst: async () => null,
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-2",
        id: "submission-2",
        ownerEmail: "mario@example.com",
        ownerHasNoEmail: false,
      }),
    },
    user: { findUnique: async () => ({ id: "user-1" }) },
  };

  const access = await ensureOwnerAccessForPublishedSubmission({
    db: db as never,
    submissionId: "submission-2",
  });

  assert.equal(access?.userId, "user-1");
  assert.equal(writes.length, 1);
});

test("no access is created for no-email owners without a usable private WhatsApp", async () => {
  const db = {
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-3",
        id: "submission-3",
        ownerEmail: "",
        ownerHasNoEmail: true,
      }),
    },
  };
  assert.equal(
    await ensureOwnerAccessForPublishedSubmission({ db: db as never, submissionId: "submission-3" }),
    null,
  );
});

test("a no-email owner access is bound to the normalized private WhatsApp", async () => {
  const writes: unknown[] = [];
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      create: async (value: { data: Record<string, unknown> }) => ({ id: "access-phone", ...value.data }),
      findFirst: async () => null,
    },
    businessSubmission: { findUnique: async () => ({ createdBusinessId: "business-phone", id: "submission-phone", ownerEmail: "", ownerHasNoEmail: true, ownerPhone: "+39 347 123 4567" }) },
    user: { findUnique: async () => null },
  };
  const access = await ensureOwnerAccessForPublishedSubmission({ db: db as never, submissionId: "submission-phone" });
  assert.equal(access?.email, null);
  assert.equal(access?.phone, "+393471234567");
  assert.equal(writes.length, 0);
});

test("WhatsApp owner handoff uses E.164 owner recipient and encodes real secure links", () => {
  const message = buildOwnerWhatsAppMessage({
    businessName: "Masseria del Sole",
    locale: "it",
    manageUrl: "https://salentolocal.com/owner-access/secure-token",
    ownerName: "Giulia Bianchi",
    viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
  });
  const href = getOwnerWhatsAppDeepLink({ message, phone: "+39 347 123 4567" });
  assert.ok(href);
  assert.match(href!, /^https:\/\/wa\.me\/393471234567\?text=/);
  assert.match(decodeURIComponent(href!), /Ciao Giulia/);
  assert.match(decodeURIComponent(href!), /businesses\/masseria-del-sole/);
  assert.match(decodeURIComponent(href!), /owner-access\/secure-token/);
});

test("the Partner-to-owner WhatsApp handoff is always Italian and only eligible after paid publication", () => {
  const message = buildPartnerOwnerWhatsAppMessage({
    businessName: "Masseria del Sole",
    manageUrl: "https://salentolocal.com/owner-access/secure-token",
    ownerName: "Giulia Bianchi",
    viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
  });

  assert.match(message, /Ciao Giulia/);
  assert.match(message, /La tua attività Masseria del Sole è ora pubblicata/);
  assert.match(message, /businesses\/masseria-del-sole/);
  assert.match(message, /owner-access\/secure-token/);
  assert.doesNotMatch(message, /Your business/);
  const href = getOwnerWhatsAppDeepLink({ message, phone: "+39 347 123 4567" });
  assert.match(href!, /^https:\/\/wa\.me\/393471234567\?text=/);
  assert.doesNotMatch(href!, /393331234567/); // A Partner's number must never become the recipient.
  assert.match(decodeURIComponent(href!), /Masseria del Sole/);

  const eligible = {
    ownerEmail: "",
    ownerHasNoEmail: true,
    ownerPhone: "+39 347 123 4567",
    paymentStatus: "PAID",
    status: "PUBLISHED",
  } as const;
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff(eligible), true);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, paymentStatus: "PENDING" }), false);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, status: "PAYMENT_PENDING" }), false);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerEmail: "owner@example.com", ownerHasNoEmail: false }), false);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerPhone: "not-a-phone" }), false);
});

test("business management authorization requires the owner relationship", async () => {
  const allowed = await canManageBusiness({
    businessId: "business-4",
    db: { business: { findFirst: async () => ({ id: "business-4" }) } } as never,
    userId: "owner-1",
  });
  const denied = await canManageBusiness({
    businessId: "business-4",
    db: { business: { findFirst: async () => null } } as never,
    userId: "other-user",
  });
  assert.equal(allowed, true);
  assert.equal(denied, false);
});

test("owner links are opaque, internal, and short lived", () => {
  const now = new Date("2026-09-02T00:00:00.000Z");
  assert.equal(getOwnerAccessInvitationExpiry(now).getTime() - now.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(
    getOwnerAccessUrl("secure-token", "https://example.test/"),
    "https://example.test/owner-access/secure-token",
  );
});

test("owner-email retries reuse the same secure invitation and message payload", async () => {
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-owner-access-secret";
  let storedInvitation: Record<string, unknown> | null = null;
  let createCount = 0;
  const db = {
    businessOwnerAccessInvitation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCount += 1;
        storedInvitation = {
          ...data,
          createdAt: new Date("2026-09-08T12:00:00.000Z"),
          revokedAt: null,
          usedAt: null,
        };
        return storedInvitation;
      },
      findFirst: async () => storedInvitation,
      updateMany: async () => ({ count: 0 }),
    },
  };

  try {
    const first = await getOrCreateOwnerAccessDeliveryInvitation({
      accessId: "access_123",
      db: db as never,
      now: new Date("2026-09-08T12:00:00.000Z"),
    });
    const retry = await getOrCreateOwnerAccessDeliveryInvitation({
      accessId: "access_123",
      db: db as never,
      now: new Date("2026-09-08T12:01:00.000Z"),
    });

    assert.equal(createCount, 1);
    assert.equal(retry.id, first.id);
    assert.equal(retry.token, first.token);
    assert.equal(retry.tokenHash, first.tokenHash);
    assert.ok(!retry.token.includes(`${retry.id}`));
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});
