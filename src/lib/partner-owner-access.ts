import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  buildPartnerOwnerWhatsAppMessage,
  getOrCreateOwnerAccessDeliveryInvitation,
  getOwnerAccessUrl,
  getOwnerWhatsAppDeepLink,
  sendOwnerAccessEmail,
} from "@/lib/business-owner-access";
import { getAppUrl } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, normalizePhoneNumber } from "@/lib/validation";

type Db = PrismaClient | Prisma.TransactionClient;
const idPattern = /^[a-z0-9]{20,40}$/i;

export function isValidPartnerSubmissionId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

export async function getPartnerOwnerAccessContext(params: {
  db?: Db;
  partnerId: string;
  submissionId: string;
}) {
  if (!isValidPartnerSubmissionId(params.submissionId)) return null;
  const db = params.db ?? prisma;
  const submission = await db.businessSubmission.findFirst({
    where: {
      id: params.submissionId,
      userId: params.partnerId,
      status: "PUBLISHED",
      paymentStatus: "PAID",
      createdBusinessId: { not: null },
    },
    select: {
      id: true, ownerName: true, ownerPhone: true,
      createdBusiness: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!submission?.createdBusiness) return null;

  const business = submission.createdBusiness;
  const active = await db.businessOwnerAccess.findFirst({
    where: { businessId: business.id, userId: { not: null }, activatedAt: { not: null } },
    orderBy: { activatedAt: "desc" },
    select: { id: true, activatedAt: true, email: true, phone: true, sourceSubmissionId: true, userId: true, user: { select: { email: true, name: true } } },
  });
  const access = active ?? await db.businessOwnerAccess.findFirst({
    where: { businessId: business.id, sourceSubmissionId: submission.id },
    select: { id: true, activatedAt: true, email: true, phone: true, sourceSubmissionId: true, userId: true, user: { select: { email: true, name: true } } },
  });
  if (!access) return null;

  const attached = Boolean(access.userId && access.activatedAt);
  const candidateEmail = normalizeEmail(access.email || (attached ? access.user?.email : null) || "");
  const email = z.email().safeParse(candidateEmail).success ? candidateEmail : null;
  const phone = normalizePhoneNumber(
    access.phone || (access.sourceSubmissionId === submission.id ? submission.ownerPhone : null),
  );
  const ownerName = attached && access.sourceSubmissionId !== submission.id
    ? access.user?.name || ""
    : submission.ownerName;
  return { accessId: access.id, attached, business, email, ownerName, phone };
}

export async function deliverPartnerOwnerAccess(params: {
  db?: Db;
  locale: "en" | "it";
  method: "email" | "whatsapp";
  partnerId: string;
  submissionId: string;
}) {
  const db = params.db ?? prisma;
  const context = await getPartnerOwnerAccessContext({ db, partnerId: params.partnerId, submissionId: params.submissionId });
  if (!context) return { status: "unavailable" as const };
  if (params.method === "email" && !context.email) return { status: "unavailable" as const };
  if (params.method === "whatsapp" && !context.phone) return { status: "unavailable" as const };

  const appUrl = getAppUrl().replace(/\/+$/, "");
  const viewUrl = `${appUrl}/businesses/${encodeURIComponent(context.business.slug)}`;
  const manageUrl = context.attached
    ? `${appUrl}/login?redirectTo=%2Fdashboard`
    : getOwnerAccessUrl((await getOrCreateOwnerAccessDeliveryInvitation({ accessId: context.accessId, db })).token, appUrl);

  if (params.method === "email") {
    const sent = await sendOwnerAccessEmail({
      businessName: context.business.name,
      locale: params.locale,
      manageUrl,
      recipient: context.email!,
      viewUrl,
    });
    return { status: sent ? "sent" as const : "delivery_unavailable" as const };
  }
  const message = buildPartnerOwnerWhatsAppMessage({
    attached: context.attached,
    businessName: context.business.name,
    manageUrl,
    ownerName: context.ownerName,
    viewUrl,
  });
  const href = getOwnerWhatsAppDeepLink({ message, phone: context.phone! });
  return href ? { status: "ready" as const, href } : { status: "unavailable" as const };
}
