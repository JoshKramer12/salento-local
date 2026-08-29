import { redirect } from "next/navigation";
import {
  IconArrowRight,
  IconBuildingStore,
  IconUsersGroup,
} from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSingleParam } from "@/lib/site";

type SignupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await getViewer();
  const resolvedSearchParams = await searchParams;
  const redirectTo = getSingleParam(resolvedSearchParams.redirectTo);

  if (viewer) {
    redirect(viewer.profileCompleted ? "/dashboard" : "/complete-profile");
  }

  const copy =
    locale === "it"
      ? {
          body:
            "Salento Local resta prima di tutto una directory per scoprire il territorio, ma puoi anche unirti in base al tuo ruolo.",
          businessBody: "Crea un account per aggiungere o rivendicare la tua attivita.",
          businessCta: "Registrati come attivita",
          businessTitle: "Ho un'attivita",
          eyebrow: "Unisciti a noi",
          partnerBody:
            "Crea un account per aiutare le attivita locali a entrare in Salento Local e seguire invii e guadagni.",
          partnerCta: "Diventa Partner locale",
          partnerTitle: "Voglio diventare Partner locale",
          title: "Come vuoi unirti a Salento Local?",
        }
      : {
          body:
            "Salento Local stays first and foremost a directory for discovering the area, but you can also join in the way that fits you best.",
          businessBody: "Create an account to add or claim your business listing.",
          businessCta: "Sign up as a business",
          businessTitle: "I own a business",
          eyebrow: "Join us",
          partnerBody:
            "Create an account to help local businesses join Salento Local and track your submissions and earnings.",
          partnerCta: "Become a Local Partner",
          partnerTitle: "I want to become a Local Partner",
          title: "How do you want to join Salento Local?",
        };

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(237,232,223,0.86))] p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="section-kicker mb-3">{copy.eyebrow}</p>
          <h1 className="max-w-3xl font-serif text-4xl text-[var(--foreground)] sm:text-5xl">
            {copy.title}
          </h1>
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <article className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:rgba(42,98,87,0.1)] text-[var(--primary)]">
              <IconBuildingStore size={22} />
            </div>
            <h2 className="mt-5 font-serif text-3xl text-[var(--foreground)]">
              {copy.businessTitle}
            </h2>
            <p className="mt-3 text-[var(--muted)]">{copy.businessBody}</p>
            <HardNavigationLink
              href={
                redirectTo
                  ? `/signup/business?redirectTo=${encodeURIComponent(redirectTo)}`
                  : "/signup/business"
              }
              className="btn-primary mt-6 w-full sm:w-auto"
            >
              {copy.businessCta}
              <IconArrowRight size={16} />
            </HardNavigationLink>
          </article>

          <article className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:rgba(191,91,42,0.1)] text-[var(--accent)]">
              <IconUsersGroup size={22} />
            </div>
            <h2 className="mt-5 font-serif text-3xl text-[var(--foreground)]">
              {copy.partnerTitle}
            </h2>
            <p className="mt-3 text-[var(--muted)]">{copy.partnerBody}</p>
            <HardNavigationLink
              href={
                redirectTo
                  ? `/signup/partner?redirectTo=${encodeURIComponent(redirectTo)}`
                  : "/signup/partner"
              }
              className="btn-primary mt-6 w-full sm:w-auto"
            >
              {copy.partnerCta}
              <IconArrowRight size={16} />
            </HardNavigationLink>
          </article>
        </section>
      </div>
    </main>
  );
}
