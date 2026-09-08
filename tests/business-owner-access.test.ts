import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerListingEmailCopy,
  canManageBusiness,
  ensureOwnerAccessForPublishedSubmission,
  getOwnerAccessInvitationExpiry,
  getOwnerAccessUrl,
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

test("no access is created for owners without an email", async () => {
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
