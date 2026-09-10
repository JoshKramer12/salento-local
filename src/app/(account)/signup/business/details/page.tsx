import { redirect } from "next/navigation";

import {
  getPendingBusinessSignupForPage,
} from "@/app/(account)/auth-actions";
import { LocalPartnerOnboardingForm } from "@/components/account/local-partner-onboarding-form";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";

export default async function BusinessJoinDetailsPage() {
  const [locale, viewer, pendingSignup, towns] = await Promise.all([
    getCurrentLocale(),
    getViewer(),
    getPendingBusinessSignupForPage(),
    prisma.town.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (viewer) {
    redirect("/dashboard");
  }

  if (!pendingSignup) {
    redirect("/signup/business/join");
  }

  const copy =
    locale === "it"
      ? {
          body: "Ci servono solo alcuni dettagli per il tuo account Business.",
          eyebrow: "Attivita locale",
          title: "Raccontaci qualcosa di te",
        }
      : {
          body: "We only need a few details for your Business account.",
          eyebrow: "Local business",
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
            backHref="/signup/business/join"
            locale={locale}
            needsDetails
            phoneCountryOptions={buildPhoneCountryOptions(locale)}
            returnTo="/dashboard"
            signupAudience="business"
            signupMode
            towns={towns}
          />
        </section>
      </div>
    </main>
  );
}
