import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerListingEmailCopy,
  buildPartnerOwnerWhatsAppMessage,
  attachOwnerAccessToUser,
  canManageBusiness,
  canOfferNoEmailOwnerWhatsAppHandoff,
  ensureOwnerAccessForPublishedSubmission,
  findUserByNormalizedEmail,
  getOwnerAccountPrefill,
  getOrCreateOwnerAccessDeliveryInvitation,
  getOwnerAccessInvitationExpiry,
  getOwnerAccessUrl,
  getNoEmailOwnerWhatsAppHandoff,
  buildOwnerWhatsAppMessage,
  shouldContinuePartnerWhatsAppHandoffPolling,
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

test("publication email shows the initial-payment refund terms and attributed Partner name in both languages", () => {
  for (const locale of ["en", "it"] as const) {
    const copy = buildOwnerListingEmailCopy({
      businessName: "Masseria del Sole",
      locale,
      manageUrl: "https://salentolocal.com/owner-access/token",
      ownerName: "Giulia Bianchi",
      partnerName: "Mario & Rossi",
      receiptUrl: "https://salentolocal.com/receipts/1",
      viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
    });
    assert.match(copy.html, locale === "en" ? /Your 14-day refund policy/ : /La tua politica di rimborso di 14 giorni/);
    assert.match(copy.html, locale === "en" ? /initial annual membership payment/ : /pagamento iniziale della membership annuale/);
    assert.match(copy.html, locale === "en" ? /Your Local Partner/ : /Il tuo Partner Locale/);
    assert.match(copy.html, /Mario &amp; Rossi/);
    assert.match(copy.text, /Mario & Rossi/);
    assert.match(copy.html, new RegExp(`locale=${locale}`));
    assert.match(copy.html, /redirectTo=%2Fterms%23refunds/);
    assert.ok(copy.html.indexOf("/businesses/masseria-del-sole") < copy.html.indexOf(locale === "it" ? "La tua politica" : "Your 14-day"));
    assert.doesNotMatch(copy.html, /wa\.me\/|mailto:/);
  }
});

test("owner-created publication email omits the Partner section", () => {
  const copy = buildOwnerListingEmailCopy({
    businessName: "Masseria del Sole",
    locale: "en",
    manageUrl: "https://salentolocal.com/owner-access/token",
    ownerName: "Giulia Bianchi",
    partnerEmail: "unrelated@example.com",
    partnerPhone: "+39 320 123 4567",
    receiptUrl: "https://salentolocal.com/receipts/1",
    viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
  });
  assert.doesNotMatch(copy.html, /Your Local Partner|help of a Salento Local Partner/);
  assert.doesNotMatch(copy.text, /Your Local Partner|help of a Salento Local Partner/);
  assert.doesNotMatch(copy.html, /unrelated@example\.com|wa\.me\/|mailto:/);
  assert.doesNotMatch(copy.text, /unrelated@example\.com|wa\.me\/|mailto:/);
  assert.match(copy.text, /Your 14-day refund policy/);
});

test("accepted Partner contacts render as safe WhatsApp and mail links in both email locales", () => {
  for (const locale of ["en", "it"] as const) {
    const copy = buildOwnerListingEmailCopy({
      businessName: "Masseria del Sole",
      locale,
      manageUrl: "https://salentolocal.com/owner-access/token",
      ownerName: "Giulia Bianchi",
      partnerName: "Mario Rossi",
      partnerPhone: "+39 320 123 4567",
      partnerEmail: "Mario@Example.com",
      receiptUrl: "https://salentolocal.com/receipts/1",
      viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
    });
    assert.match(copy.html, /href="https:\/\/wa\.me\/393201234567"/);
    assert.match(copy.html, /href="mailto:mario%40example\.com"/);
    assert.match(copy.html, /WhatsApp:.*\+393201234567/);
    assert.match(copy.text, /Email: mario@example\.com/);
    assert.match(copy.text, locale === "en" ? /contact them directly/ : /contattarlo direttamente/);
    assert.match(copy.html, locale === "en" ? /Your 14-day refund policy/ : /La tua politica di rimborso di 14 giorni/);
  }
});

test("publication email omits missing Partner contacts but retains their name", () => {
  const copy = buildOwnerListingEmailCopy({
    businessName: "Masseria del Sole", locale: "en", manageUrl: "https://salentolocal.com/owner-access/token",
    ownerName: "Giulia Bianchi", partnerName: "Mario Rossi", partnerPhone: "invalid", partnerEmail: "invalid",
    receiptUrl: "https://salentolocal.com/receipts/1", viewUrl: "https://salentolocal.com/businesses/masseria-del-sole",
  });
  assert.match(copy.html, /Mario Rossi/);
  assert.doesNotMatch(copy.html, /wa\.me\/|mailto:/);
  assert.doesNotMatch(copy.text, /contact them directly/);
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

test("a publication recovery never replaces an already active claimed owner access", async () => {
  const activeAccess = {
    activatedAt: new Date("2026-09-12T12:00:00.000Z"),
    businessId: "business-claimed",
    email: "account@example.com",
    id: "access-current",
    phone: null,
    sourceSubmissionId: null,
    userId: "claimant-user",
    verifiedAt: new Date("2026-09-12T12:00:00.000Z"),
  };
  let createCalled = false;
  let updateCalled = false;
  let findFirstCalls = 0;
  const db = {
    businessOwnerAccess: {
      create: async () => {
        createCalled = true;
        return null;
      },
      findFirst: async () => {
        findFirstCalls += 1;
        return findFirstCalls === 1 ? null : activeAccess;
      },
      update: async () => {
        updateCalled = true;
        return null;
      },
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-claimed",
        id: "submission-historical",
        ownerEmail: "historical@example.com",
        ownerHasNoEmail: false,
      }),
    },
  };

  const result = await ensureOwnerAccessForPublishedSubmission({
    db: db as never,
    submissionId: "submission-historical",
  });

  assert.deepEqual(result, activeAccess);
  assert.equal(createCalled, false);
  assert.equal(updateCalled, false);
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

test("a Partner no-email lifecycle creates a pending phone access, durable handoff, and owner attachment", async () => {
  const normalizedPhone = "+393471234567";
  const submission = {
    createdBusiness: { name: "Masseria del Sole", slug: "masseria-del-sole" },
    createdBusinessId: "business-phone-lifecycle",
    id: "submission-phone-lifecycle",
    ownerEmail: "",
    ownerHasNoEmail: true,
    ownerName: "Giulia Bianchi",
    ownerPhone: "+39 347 123 4567",
    paymentStatus: "PAID",
    status: "PUBLISHED",
  };
  const existingUser = { id: "existing-user-with-same-phone", phone: normalizedPhone };
  let access: Record<string, unknown> | null = null;
  let invitation: Record<string, unknown> | null = null;
  let userLookupsBeforeOwnerClick = 0;
  const db = {
    business: { updateMany: async () => ({ count: 1 }) },
    businessOwnerAccess: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        access = { id: "phone-access", ...data };
        return access;
      },
      findFirst: async () => access,
      findUnique: async () => access,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        access = { ...access, ...data };
        return access;
      },
    },
    businessOwnerAccessInvitation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        invitation = { ...data, createdAt: new Date(), revokedAt: null, usedAt: null };
        return invitation;
      },
      findFirst: async () => invitation,
      updateMany: async () => ({ count: 0 }),
    },
    businessSubmission: { findUnique: async () => submission },
    user: {
      findUnique: async () => {
        userLookupsBeforeOwnerClick += 1;
        return existingUser;
      },
    },
  };

  const handoff = await getNoEmailOwnerWhatsAppHandoff({
    appUrl: "https://salentolocal.example",
    db: db as never,
    submissionId: submission.id,
  });

  assert.ok(handoff);
  assert.match(handoff!.href, /^https:\/\/wa\.me\/393471234567\?text=/);
  assert.match(decodeURIComponent(handoff!.href), /owner-access\//);
  assert.equal(access?.phone, normalizedPhone);
  assert.equal(access?.userId, null);
  assert.ok(invitation);
  assert.equal(userLookupsBeforeOwnerClick, 0);

  // The first owner click can now create or sign in to an account, then attach
  // that account only after the invitation has established the owner intent.
  const attached = await attachOwnerAccessToUser({
    accessId: "phone-access",
    db: db as never,
    userId: existingUser.id,
  });
  assert.equal(attached?.userId, existingUser.id);
});

test("a historical phone auto-binding without an invitation is repaired before handoff", async () => {
  const writes: unknown[] = [];
  const prematurelyBound = {
    email: null,
    id: "premature-phone-access",
    invitations: [],
    phone: "+393471234567",
    sourceSubmissionId: "submission-repair",
    userId: "matched-by-phone-user",
  };
  let findFirstCalls = 0;
  const db = {
    business: { updateMany: async (value: unknown) => writes.push(value) },
    businessOwnerAccess: {
      findFirst: async () => {
        findFirstCalls += 1;
        return prematurelyBound;
      },
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...prematurelyBound, ...data }),
    },
    businessSubmission: {
      findUnique: async () => ({
        createdBusinessId: "business-repair",
        id: "submission-repair",
        ownerEmail: "",
        ownerHasNoEmail: true,
        ownerPhone: "+39 347 123 4567",
      }),
    },
    user: { findUnique: async () => { throw new Error("phone lookup must not establish ownership"); } },
  };

  const access = await ensureOwnerAccessForPublishedSubmission({ db: db as never, submissionId: "submission-repair" });

  assert.equal(findFirstCalls, 2);
  assert.equal(access?.userId, null);
  assert.equal(access?.activatedAt, null);
  assert.deepEqual(writes, [{ where: { id: "business-repair", ownerUserId: "matched-by-phone-user" }, data: { ownerUserId: null } }]);
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
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerEmail: "owner@example.com", ownerHasNoEmail: true }), false);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerPhone: "not-a-phone" }), false);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerEmail: "", ownerHasNoEmail: false }), true);
  assert.equal(canOfferNoEmailOwnerWhatsAppHandoff({ ...eligible, ownerEmail: "   ", ownerHasNoEmail: false }), true);
});

test("eligible Partner payment pages keep refreshing until the durable WhatsApp handoff is available", () => {
  const eligible = {
    handoffAvailable: false,
    ownerEmail: "",
    ownerHasNoEmail: true,
    ownerPhone: "+39 347 123 4567",
    paymentStatus: "PAID",
    status: "PUBLISHED",
    viewerRole: "GETTER",
  } as const;

  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling(eligible), true);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, handoffAvailable: true }), false);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, ownerEmail: "owner@example.com", ownerHasNoEmail: false }), false);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, ownerEmail: "owner@example.com" }), false);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, ownerPhone: "invalid" }), false);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, paymentStatus: "PENDING_PAYMENT" }), false);
  assert.equal(shouldContinuePartnerWhatsAppHandoffPolling({ ...eligible, viewerRole: "BUSINESS_OWNER" }), false);
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
