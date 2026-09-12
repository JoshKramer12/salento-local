import { redirect } from "next/navigation";

import { BusinessClaimVerifyForm } from "@/components/account/business-claim-verify-form";
import { maskVerificationRecipient } from "@/lib/business-claim-verification";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type ClaimVerifyPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClaimVerifyPage({ searchParams }: ClaimVerifyPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const claimId = getSingleParam(resolvedSearchParams.claim);

  if (!claimId) {
    redirect("/claim");
  }

  const claim = await prisma.businessClaim.findUnique({
    where: {
      id: claimId,
    },
    select: {
      business: {
        select: {
          name: true,
        },
      },
      id: true,
      status: true,
      userId: true,
      verificationChannel: true,
      verificationSentTo: true,
    },
  });

  if (
    !claim ||
    claim.userId !== viewer.id ||
    claim.verificationChannel !== "EMAIL" ||
    claim.status !== "AWAITING_VERIFICATION"
  ) {
    redirect("/claim");
  }

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <section className="card p-8">
          <p className="section-kicker mb-3">
            {locale === "it" ? "Verifica attivita" : "Business verification"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Conferma la rivendicazione" : "Confirm your claim"}
          </h1>
          <div className="mt-8">
            <BusinessClaimVerifyForm
              businessName={claim.business.name}
              claimId={claim.id}
              contact={maskVerificationRecipient(claim.verificationChannel, claim.verificationSentTo)}
              locale={locale}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
