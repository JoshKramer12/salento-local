import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { prisma } from "@/lib/prisma";

export default async function PartnerStartPage() {
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: viewer.id }, select: { completedAt: true, partnerOnboardingCompletedAt: true } });
  redirect(getPartnerNextRoute(profile));
}
