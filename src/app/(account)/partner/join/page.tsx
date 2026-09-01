import { redirect } from "next/navigation";

import { PartnerEntrySignupForm } from "@/components/account/partner-entry-signup-form";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";

export default async function PartnerJoinPage() {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), getViewer()]);

  if (viewer) {
    if (viewer.profileCompleted) {
      redirect(viewer.role === "GETTER" ? "/partner/start" : "/dashboard");
    }

    redirect("/complete-profile?accountType=GETTER&redirectTo=%2Fpartner%2Fstart");
  }

  const copy = locale === "it" ? { body: "Unisciti a Salento Local come Partner locale. Ti chiederemo i dettagli essenziali subito dopo.", eyebrow: "PARTNER LOCALE", title: "Crea il tuo account" } : { body: "Join Salento Local as a Local Partner. We will ask for the essential details right after this.", eyebrow: "LOCAL PARTNER", title: "Create your account" };
  return <main className="shell px-4 py-10 sm:px-6 sm:py-14"><div className="mx-auto max-w-xl"><p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.title}</h1><p className="mt-4 text-[var(--muted)]">{copy.body}</p><div className="mt-8"><PartnerEntrySignupForm locale={locale}/></div></div></main>;
}
