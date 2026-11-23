import { redirect, notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";

import { PartnerSignupForm } from "@/components/account/partner-signup-form";
import { SignupForm } from "@/components/account/signup-form";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type SignupAudiencePageProps = {
  params: Promise<{ audience: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const audienceRoles = {
  business: "BUSINESS_OWNER",
  partner: "GETTER",
  personal: "USER",
} as const;

export default async function SignupAudiencePage({
  params,
  searchParams,
}: SignupAudiencePageProps) {
  const locale = await getCurrentLocale();
  const viewer = await getViewer();
  const resolvedSearchParams = await searchParams;
  const redirectTo = getSingleParam(resolvedSearchParams.redirectTo);

  if (viewer) {
    redirect(viewer.profileCompleted ? "/dashboard" : "/complete-profile");
  }

  const { audience } = await params;
  const accountType = audienceRoles[audience as keyof typeof audienceRoles];

  if (!accountType) {
    notFound();
  }

  if (audience === "partner") {
    redirect("/partner/join");
  }

  if (audience === "business") {
    redirect(
      redirectTo
        ? `/signup/business/join?redirectTo=${encodeURIComponent(redirectTo)}`
        : "/signup/business/join",
    );
  }

  const copyMap =
    locale === "it"
      ? {
          business: {
            back: "Torna alle opzioni",
            body:
              "Crea il tuo account e prepara la scheda della tua attivita. Il pagamento resta nel normale flusso finale.",
            eyebrow: "Attivita locale",
            highlights: [
              "Prepara la tua scheda con foto, dettagli e contatti in un unico posto.",
              "Gestisci aggiornamenti, pubblicazione e stato del pagamento dal tuo account.",
              "Richiedi la gestione di una scheda esistente se la tua attivita e gia nella directory.",
            ],
            title: "Registrati come attivita",
          },
          partner: {
            back: "Torna alle opzioni",
            body:
              "Crea il tuo account Partner locale per aiutare le attivita del territorio a entrare nella directory e seguire invii e commissioni.",
            eyebrow: "Partner locale",
            highlights: [
              "Segui nuove attivita raccolte sul territorio e accompagnale nella directory.",
              "Completa il tuo profilo partner e indica la tua area di riferimento.",
              "Controlla invii, verifiche e commissioni da un unico spazio dedicato.",
            ],
            title: "Registrati come Partner locale",
          },
          personal: {
            back: "Torna alle opzioni",
            body:
              "Crea un account personale per esplorare il territorio, scegliere il tuo username e usare le funzioni account essenziali.",
            eyebrow: "Account personale",
            highlights: [
              "Scegli uno username unico da usare nel tuo account.",
              "Salva il tuo spazio personale per continuare a esplorare il territorio con piu facilita.",
              "Accedi piu velocemente alle funzioni account essenziali quando ti servono.",
            ],
            title: "Crea un account personale",
          },
        }
      : {
          business: {
            back: "Back to options",
            body:
              "Create your account and prepare your business listing. Payment still happens at the end of the normal flow.",
            eyebrow: "Local business",
            highlights: [
              "Prepare your listing with photos, business details, and contact information in one place.",
              "Manage updates, publication status, and payment progress from your account.",
              "Claim an existing listing if your business is already in the directory.",
            ],
            title: "Sign up as a business",
          },
          partner: {
            back: "Back to options",
            body:
              "Create your Local Partner account to help businesses join the directory and keep track of submissions and commissions.",
            eyebrow: "Local Partner",
            highlights: [
              "Track new businesses you bring in and guide them into the directory.",
              "Complete your partner profile and choose your local coverage area.",
              "Keep submissions, verification, and commission follow-up in one dedicated space.",
            ],
            title: "Sign up as a Local Partner",
          },
          personal: {
            back: "Back to options",
            body:
              "Create a personal account to explore the area, choose your username, and use the core account features.",
            eyebrow: "Personal account",
            highlights: [
              "Choose a unique username for your account.",
              "Keep a simple personal account for exploring the area more easily.",
              "Use the essential account features whenever you need them.",
            ],
            title: "Create a personal account",
          },
        };

  const copy = copyMap[audience as keyof typeof copyMap];

  const [towns, phoneCountryOptions] =
    accountType === "GETTER"
      ? await Promise.all([
          prisma.town.findMany({
            select: {
              id: true,
              name: true,
            },
            orderBy: {
              name: "asc",
            },
          }),
          Promise.resolve(buildPhoneCountryOptions(locale)),
        ])
      : [[], []];

  if (accountType === "GETTER") {
    return (
      <main className="shell px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <HardNavigationLink
            href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}
            className="btn-secondary w-fit"
          >
            <IconArrowLeft size={16} />
            {copy.back}
          </HardNavigationLink>
          <div className="mt-6 text-center">
            <p className="section-kicker mb-3">{copy.eyebrow}</p>
            <h1 className="font-serif text-4xl text-[var(--foreground)] sm:text-5xl">
              {copy.title}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[var(--muted)]">{copy.body}</p>
          </div>
          <div className="mt-8">
            {accountType === "GETTER" ? (
              <PartnerSignupForm
                locale={locale}
                phoneCountryOptions={phoneCountryOptions}
                redirectTo={redirectTo ?? ""}
                towns={towns}
              />
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="card flex h-full flex-col justify-between p-8">
          <HardNavigationLink
            href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}
            className="btn-secondary w-fit"
          >
            <IconArrowLeft size={16} />
            {copy.back}
          </HardNavigationLink>
          <div className="mt-6">
            <p className="section-kicker mb-3">{copy.eyebrow}</p>
            <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
            <p className="mt-4 max-w-xl text-[var(--muted)]">{copy.body}</p>
          </div>

          <div className="mt-8 grid gap-4">
            <div className="grid gap-3">
              {copy.highlights.map((item, index) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:rgba(42,98,87,0.1)] text-sm font-semibold text-[var(--primary)]">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-[var(--foreground)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <SignupForm accountType={accountType} locale={locale} redirectTo={redirectTo ?? ""} />
      </div>
    </main>
  );
}
