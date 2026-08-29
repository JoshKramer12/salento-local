import { redirect } from "next/navigation";

import { LocalPartnerOnboardingForm } from "@/components/account/local-partner-onboarding-form";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";
import { getSafeInternalRedirect } from "@/lib/redirects";
import { getSingleParam } from "@/lib/site";

type PartnerOnboardingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PartnerOnboardingPage({ searchParams }: PartnerOnboardingPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  if (viewer.role !== "GETTER") redirect("/dashboard");
  const resolvedSearchParams = await searchParams;
  const profile = await prisma.localPartnerProfile.findUnique({
    where: { userId: viewer.id },
    select: { baseTownOrArea: true, birthDate: true, completedAt: true, heardAbout: true, phone: true, whatsapp: true },
  });
  const needsDetails = !profile?.completedAt || !profile.phone?.trim() || !profile.baseTownOrArea?.trim() || !profile.birthDate;
  const editDetails = getSingleParam(resolvedSearchParams.editDetails) === "1";
  const returnTo = getSafeInternalRedirect(getSingleParam(resolvedSearchParams.returnTo)) ?? "/dashboard";

  // A payout destination is required to receive money, not to submit a business.
  if (!needsDetails && !editDetails) {
    redirect(`/partner/payout?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const towns = await prisma.town.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <main className="shell px-4 py-14 sm:px-6"><div className="mx-auto grid max-w-2xl gap-6">
    <section className="card p-8">
      <p className="section-kicker mb-3">{locale === "it" ? "Partner locale" : "Local Partner"}</p>
      <h1 className="font-serif text-4xl text-[var(--foreground)]">{locale === "it" ? "Raccontaci qualcosa di te" : "Tell us a little about yourself"}</h1>
      <p className="mt-4 text-[var(--muted)]">{locale === "it" ? "Ci servono solo alcuni dettagli per il tuo account Partner." : "We only need a few details for your Local Partner account."}</p>
    </section>
    <section className="card p-8"><LocalPartnerOnboardingForm locale={locale} needsDetails phoneCountryOptions={buildPhoneCountryOptions(locale)} profile={profile} returnTo={returnTo} towns={towns} /></section>
  </div></main>;
}
