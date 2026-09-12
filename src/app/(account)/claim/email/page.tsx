import { redirect } from "next/navigation";

import { BusinessClaimEmailChoiceForm } from "@/components/account/business-claim-email-choice-form";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { shouldShowClaimEmailChoice } from "@/lib/business-claim";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

export default async function ClaimEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const claimId = getSingleParam((await searchParams).claim);

  if (!claimId) redirect("/dashboard/businesses");

  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    include: { business: { select: { ownerUserId: true, slug: true } } },
  });

  if (!claim || claim.userId !== viewer.id || claim.status !== "APPROVED" || claim.business.ownerUserId !== viewer.id || !claim.businessContactEmail) {
    redirect("/dashboard/businesses");
  }

  if (!shouldShowClaimEmailChoice(viewer.email, claim.businessContactEmail)) {
    redirect(`/claim/success?business=${encodeURIComponent(claim.business.slug)}`);
  }

  return <main className="shell px-4 py-14 sm:px-6"><section className="card mx-auto max-w-2xl p-6 sm:p-8"><BusinessClaimEmailChoiceForm accountEmail={viewer.email} businessEmail={claim.businessContactEmail} claimId={claim.id} locale={locale} /></section></main>;
}
