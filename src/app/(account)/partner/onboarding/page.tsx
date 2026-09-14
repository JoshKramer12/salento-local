import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { PartnerFirstRunOnboarding } from "@/components/account/partner-first-run-onboarding";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { prisma } from "@/lib/prisma";

export default async function PartnerOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ guide?: string | string[] }>;
}) {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), requireCompletedViewer()]);
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const params = await searchParams;
  const isGuide = params.guide === "1";
  const profile = await prisma.localPartnerProfile.findUnique({ where: { userId: viewer.id }, select: { completedAt: true, partnerOnboardingCompletedAt: true } });
  const nextRoute = getPartnerNextRoute(profile);
  if (nextRoute !== "/partner/onboarding" && !(isGuide && nextRoute === "/dashboard")) redirect(nextRoute);
  return <main><PartnerFirstRunOnboarding isGuide={isGuide} locale={locale}/></main>;
}
