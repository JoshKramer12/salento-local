"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { LEGAL_DOCUMENTS } from "@/lib/legal";
import { recordCurrentLegalAcceptances } from "@/lib/legal-consent";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";

export async function acceptUpdatedPartnerTermsAction(formData: FormData) {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");

  const version = formData.get("version");
  const accepted = formData.get("accepted");
  const locale = await getCurrentLocale();
  if (version !== LEGAL_DOCUMENTS.partnerTerms.version || accepted !== "on") {
    redirect("/partner/terms?error=acceptance-required");
  }

  await prisma.$transaction((tx) => recordCurrentLegalAcceptances({
    acceptanceContext: "PARTNER_SIGNUP",
    audience: "partner",
    contextRef: `updated-partner-terms:${LEGAL_DOCUMENTS.partnerTerms.version}`,
    db: tx,
    locale,
    userId: viewer.id,
  }));
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
