import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerGuide } from "@/components/account/partner-guide";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { prisma } from "@/lib/prisma";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

export default async function PartnerGuidePage() {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), requireCompletedViewer()]);

  if (viewer.role !== "GETTER") redirect("/dashboard");

  const [profile, draftCount] = await Promise.all([
    prisma.localPartnerProfile.findUnique({
      where: { userId: viewer.id },
      select: { completedAt: true, partnerOnboardingCompletedAt: true },
    }),
    prisma.businessSubmission.count({ where: buildDraftLikeSubmissionWhere(viewer.id) }),
  ]);
  const nextRoute = getPartnerNextRoute(profile);

  if (nextRoute !== "/dashboard") redirect(nextRoute);

  return (
    <>
      <PartnerWorkspaceNav active="guide" locale={locale} />
      <main className="shell px-4 py-12 sm:px-6">
        <div className="dashboard-nav-shell mb-8">
          <DashboardNav active="guide" draftCount={draftCount} locale={locale} role={viewer.role} />
        </div>
        <PartnerGuide locale={locale} />
      </main>
    </>
  );
}
