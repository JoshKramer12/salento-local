import { redirect } from "next/navigation";

import {
  getPendingBusinessSignupForPage,
} from "@/app/(account)/auth-actions";
import { PartnerEntrySignupForm } from "@/components/account/partner-entry-signup-form";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSingleParam } from "@/lib/site";

type BusinessJoinPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BusinessJoinPage({ searchParams }: BusinessJoinPageProps) {
  const resolvedSearchParams = await searchParams;
  const redirectTo = getSingleParam(resolvedSearchParams.redirectTo) ?? "";
  const [locale, viewer, initialValues] = await Promise.all([
    getCurrentLocale(),
    getViewer(),
    getPendingBusinessSignupForPage(),
  ]);

  if (viewer) {
    redirect(viewer.profileCompleted ? "/dashboard" : "/complete-profile");
  }

  const copy =
    locale === "it"
      ? {
          body: "Unisciti a Salento Local come attivita locale. Nel prossimo passaggio ti chiederemo alcuni dettagli essenziali.",
          eyebrow: "ATTIVITA LOCALE",
          title: "Crea il tuo account",
        }
      : {
          body: "Join Salento Local as a local business. We will ask for a few essential details on the next page.",
          eyebrow: "LOCAL BUSINESS",
          title: "Create your account",
        };

  return (
    <main className="shell px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-xl">
        <p className="section-kicker mb-3">{copy.eyebrow}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.title}</h1>
        <p className="mt-4 text-[var(--muted)]">{copy.body}</p>
        <div className="mt-8">
          <PartnerEntrySignupForm
            audience="business"
            initialValues={initialValues}
            locale={locale}
            redirectTo={redirectTo}
          />
        </div>
      </div>
    </main>
  );
}
