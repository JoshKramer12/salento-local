import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { LEGAL_DOCUMENTS } from "@/lib/legal";
import { hasAcceptedCurrentLegalDocuments, recordCurrentLegalAcceptances } from "@/lib/legal-consent";

test("new and existing Partners explicitly accept the current terms without rewriting old acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "salento-partner-contact-terms-"));
  const db = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "acceptances.db")}` } } });
  try {
    await db.$executeRawUnsafe(`CREATE TABLE "LegalAcceptance" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "documentType" TEXT NOT NULL,
      "documentVersion" TEXT NOT NULL, "locale" TEXT NOT NULL,
      "acceptanceContext" TEXT NOT NULL, "contextRef" TEXT NOT NULL DEFAULT '',
      "acceptedAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL,
      UNIQUE("userId", "documentType", "documentVersion", "acceptanceContext", "contextRef")
    )`);
    await db.legalAcceptance.create({ data: {
      id: "historical-acceptance", userId: "existing-partner", documentType: "PARTNER_TERMS",
      documentVersion: "partner-terms-2026-09-27", locale: "it", acceptanceContext: "PARTNER_SIGNUP",
    } });
    assert.equal(await hasAcceptedCurrentLegalDocuments({ audience: "partner", db, userId: "existing-partner" }), false);
    assert.equal(await hasAcceptedCurrentLegalDocuments({ audience: "partner", db, userId: "new-partner" }), false);

    for (const userId of ["existing-partner", "new-partner"]) {
      await db.$transaction((tx) => recordCurrentLegalAcceptances({
        acceptanceContext: "PARTNER_SIGNUP", audience: "partner", db: tx,
        contextRef: `updated-partner-terms:${LEGAL_DOCUMENTS.partnerTerms.version}`,
        locale: "en", userId,
      }));
      assert.equal(await hasAcceptedCurrentLegalDocuments({ audience: "partner", db, userId }), true);
    }
    assert.ok(await db.legalAcceptance.findUnique({ where: { id: "historical-acceptance" } }));
    const current = await db.legalAcceptance.findFirst({ where: {
      userId: "existing-partner", documentType: "PARTNER_TERMS",
      documentVersion: LEGAL_DOCUMENTS.partnerTerms.version,
    } });
    assert.equal(current?.acceptanceContext, "PARTNER_SIGNUP");
    assert.equal(current?.contextRef, `updated-partner-terms:${LEGAL_DOCUMENTS.partnerTerms.version}`);
    assert.equal(current?.locale, "en");
  } finally {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});
