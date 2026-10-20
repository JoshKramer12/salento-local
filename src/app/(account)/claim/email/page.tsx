import { redirect } from "next/navigation";

import { requireCompletedViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

export default async function ClaimEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCompletedViewer();
  const claimId = getSingleParam((await searchParams).claim);

  if (!claimId) redirect("/dashboard/businesses");

  const claim = await prisma.businessClaim.findUnique({
    where: { id: claimId },
    include: { business: { select: { ownerUserId: true, slug: true } } },
  });

  if (!claim || claim.userId !== viewer.id || claim.status !== "APPROVED" || claim.business.ownerUserId !== viewer.id) {
    redirect("/dashboard/businesses");
  }

  redirect(`/claim/success?business=${encodeURIComponent(claim.business.slug)}`);
}
