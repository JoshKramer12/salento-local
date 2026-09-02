import { redirect } from "next/navigation";

import { LocalPartnerOnboardingForm } from "@/components/account/local-partner-onboarding-form";
import { getPendingPartnerSignupForPage } from "@/app/(account)/auth-actions";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";

export default async function PartnerJoinDetailsPage() {
  const [locale, viewer, pendingSignup, towns] = await Promise.all([
    getCurrentLocale(),
    getViewer(),
    getPendingPartnerSignupForPage(),
    prisma.town.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (viewer) {
    redirect(viewer.profileCompleted && viewer.role === "GETTER" ? "/partner/start" : "/dashboard");
  }

  if (!pendingSignup) {
    redirect("/partner/join");
  }

  const copy =
    locale === "it"
      ? {
          body: "Ci servono solo alcuni dettagli per il tuo account Partner.",
          eyebrow: "Partner locale",
          title: "Raccontaci qualcosa di te",
        }
      : {
          body: "We only need a few details for your Local Partner account.",
          eyebrow: "Local Partner",
          title: "Tell us a little about yourself",
        };

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto grid max-w-2xl gap-6">
        <section className="card p-8">
          <p className="section-kicker mb-3">{copy.eyebrow}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
          <p className="mt-4 text-[var(--muted)]">{copy.body}</p>
        </section>
        <section className="card p-8">
          <LocalPartnerOnboardingForm
            backHref="/partner/join"
            locale={locale}
            needsDetails
            phoneCountryOptions={buildPhoneCountryOptions(locale)}
            returnTo="/partner/start"
            signupMode
            towns={towns}
          />
        </section>
      </div>
    </main>
  );
}
