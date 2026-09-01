import { redirect } from "next/navigation";

import { PartnerSignupForm } from "@/components/account/partner-signup-form";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";

export default async function PartnerJoinPage() {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), getViewer()]);

  if (viewer) {
    if (viewer.profileCompleted) {
      redirect(viewer.role === "GETTER" ? "/partner/start" : "/dashboard");
    }

    redirect("/complete-profile?accountType=GETTER&redirectTo=%2Fpartner%2Fstart");
  }

  const copy = locale === "it" ? { body: "Unisciti a Salento Local come Partner locale completando subito i dettagli essenziali del tuo account.", eyebrow: "PARTNER LOCALE", title: "Crea il tuo account" } : { body: "Join Salento Local as a Local Partner by completing your essential account details now.", eyebrow: "LOCAL PARTNER", title: "Create your account" };
  const towns = await prisma.town.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return <main className="shell px-4 py-10 sm:px-6 sm:py-14"><div className="mx-auto max-w-4xl"><p className="section-kicker mb-3">{copy.eyebrow}</p><h1 className="font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.title}</h1><p className="mt-4 text-[var(--muted)]">{copy.body}</p><div className="mt-8"><PartnerSignupForm locale={locale} phoneCountryOptions={buildPhoneCountryOptions(locale)} towns={towns}/></div></div></main>;
}
