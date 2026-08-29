import { Prisma } from "@prisma/client";

import type { Locale } from "@/lib/i18n";
import { getRequiredLegalDocuments, type LegalAudience } from "@/lib/legal";
import { prisma } from "@/lib/prisma";

type LegalAcceptanceRow = {
  documentType: string;
  documentVersion: string;
};

type LegalDbClient = Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;

export async function hasAcceptedCurrentLegalDocuments(params: {
  audience: LegalAudience;
  db?: LegalDbClient;
  userId: string;
}) {
  const db = params.db ?? prisma;
  const requiredDocuments = getRequiredLegalDocuments(params.audience);
  const documentTypes = requiredDocuments.map((document) => document.documentType);
  const acceptedDocuments = await db.$queryRaw<LegalAcceptanceRow[]>(Prisma.sql`
    SELECT "documentType", "documentVersion"
    FROM "LegalAcceptance"
    WHERE "userId" = ${params.userId}
      AND "documentType" IN (${Prisma.join(documentTypes)})
  `);

  const acceptedKeys = new Set(
    acceptedDocuments.map((document) => `${document.documentType}:${document.documentVersion}`),
  );

  return requiredDocuments.every((document) =>
    acceptedKeys.has(`${document.documentType}:${document.version}`),
  );
}

export async function recordCurrentLegalAcceptances(params: {
  acceptanceContext:
    | "BUSINESS_SIGNUP"
    | "PARTNER_SIGNUP"
    | "BUSINESS_CLAIM"
    | "BUSINESS_SUBMISSION";
  audience: LegalAudience;
  contextRef?: string;
  db?: LegalDbClient;
  locale: Locale;
  userId: string;
}) {
  const db = params.db ?? prisma;
  const requiredDocuments = getRequiredLegalDocuments(params.audience);
  const acceptedAt = new Date();
  const contextRef = params.contextRef ?? "";

  await Promise.all(
    requiredDocuments.map((document) =>
      db.$executeRaw(Prisma.sql`
        INSERT INTO "LegalAcceptance" (
          "id",
          "userId",
          "documentType",
          "documentVersion",
          "locale",
          "acceptanceContext",
          "contextRef",
          "acceptedAt",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${crypto.randomUUID()},
          ${params.userId},
          ${document.documentType},
          ${document.version},
          ${params.locale},
          ${params.acceptanceContext},
          ${contextRef},
          ${acceptedAt},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT("userId", "documentType", "documentVersion", "acceptanceContext", "contextRef")
        DO UPDATE SET
          "acceptedAt" = excluded."acceptedAt",
          "locale" = excluded."locale",
          "updatedAt" = CURRENT_TIMESTAMP
      `),
    ),
  );
}
