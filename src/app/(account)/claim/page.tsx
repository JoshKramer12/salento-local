import { redirect } from "next/navigation";

import { BusinessClaimForm } from "@/components/account/business-claim-form";
import {
  BusinessOwnerAccountNav,
  BusinessOwnerWorkspaceNav,
} from "@/components/account/business-owner-account-nav";
import { getEnabledVerificationMethods } from "@/lib/business-claim-verification";
import { getViewer } from "@/lib/auth-guards";
import { hasAcceptedCurrentLegalDocuments } from "@/lib/legal-consent";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type ClaimPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClaimPage({ searchParams }: ClaimPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await getViewer();
  const availableMethods = getEnabledVerificationMethods().filter(
    (method) => method === "EMAIL" || method === "SMS",
  );
  const resolvedSearchParams = await searchParams;
  const requestedBusinessSlug = getSingleParam(resolvedSearchParams.business);
  const claimRedirectTo = requestedBusinessSlug
    ? `/claim?business=${encodeURIComponent(requestedBusinessSlug)}`
    : "/claim";

  if (!viewer) {
    redirect(`/login?redirectTo=${encodeURIComponent(claimRedirectTo)}`);
  }

  if (!viewer.profileCompleted) {
    redirect("/complete-profile");
  }

  if (viewer.role !== "BUSINESS_OWNER") {
    redirect(`/login?redirectTo=${encodeURIComponent(claimRedirectTo)}`);
  }

  const [selectedBusiness, hasAcceptedBusinessLegalDocuments] = await Promise.all([
    requestedBusinessSlug
      ? prisma.business.findUnique({
          where: {
            slug: requestedBusinessSlug,
          },
          select: {
            id: true,
            name: true,
            slug: true,
            town: {
              select: {
                name: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    hasAcceptedCurrentLegalDocuments({
      audience: "business",
      userId: viewer.id,
    }),
  ]);

  return (
    <>
      <BusinessOwnerWorkspaceNav active="claims" locale={locale} />
      <main className="shell px-4 py-12 sm:px-6">
        <div className="mb-8">
          <p className="section-kicker mb-2">
            {locale === "it" ? "Rivendicazione attivita" : "Business claim"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Collega una scheda esistente" : "Connect an existing listing"}
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--muted)]">
            {locale === "it"
              ? "Se la tua attivita e gia nella directory, puoi rivendicarla qui e collegarla al tuo account."
              : "If your business is already in the directory, you can claim it here and connect it to your account."}
          </p>
        </div>

        <BusinessOwnerAccountNav active="claims" locale={locale} />

        <section className="card p-8">
          <BusinessClaimForm
            availableMethods={availableMethods}
            initialBusiness={
              selectedBusiness
                ? {
                    id: selectedBusiness.id,
                    label: `${selectedBusiness.name} - ${selectedBusiness.town.name}`,
                    slug: selectedBusiness.slug,
                    subtitle:
                      locale === "it"
                        ? `Comune di ${selectedBusiness.town.name}`
                        : selectedBusiness.town.name,
                  }
                : undefined
            }
            locale={locale}
            requiresLegalAcceptance={!hasAcceptedBusinessLegalDocuments}
          />
        </section>
      </main>
    </>
  );
}
