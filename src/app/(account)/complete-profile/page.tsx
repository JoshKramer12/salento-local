import { redirect } from "next/navigation";

import { CompleteProfileForm } from "@/components/account/complete-profile-form";
import { requireViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSingleParam } from "@/lib/site";

type CompleteProfilePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CompleteProfilePage({
  searchParams,
}: CompleteProfilePageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireViewer();
  const resolvedSearchParams = await searchParams;
  const redirectTo = getSingleParam(resolvedSearchParams.redirectTo);
  const accountType = getSingleParam(resolvedSearchParams.accountType);
  const isPartnerSignup = accountType === "GETTER";

  if (viewer.profileCompleted) {
    redirect(isPartnerSignup || viewer.role === "GETTER" ? "/partner/start" : "/dashboard");
  }

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl card p-8">
        <p className="section-kicker mb-3">
          {locale === "it" ? "Ultimo passaggio" : "One last step"}
        </p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">
          {isPartnerSignup
            ? locale === "it"
              ? "Completa il tuo account Partner"
              : "Complete your Partner account"
            : locale === "it"
              ? "Completa il profilo"
              : "Complete your profile"}
        </h1>
        <p className="mt-4 text-[var(--muted)]">
          {isPartnerSignup
            ? locale === "it"
              ? "Scegli uno username pubblico per il tuo account Partner locale."
              : "Choose a public username for your Local Partner account."
            : locale === "it"
            ? "Hai gia effettuato l'accesso. Ora scegli uno username pubblico e indica se ti unisci come attivita, Partner locale o semplice visitatore."
            : "You are signed in already. Now choose your public username and tell us whether you are joining as a business, Local Partner, or visitor."}
        </p>
        <div className="mt-8">
          <CompleteProfileForm
            fixedAccountType={isPartnerSignup ? "GETTER" : undefined}
            locale={locale}
            redirectTo={redirectTo ?? ""}
          />
        </div>
      </div>
    </main>
  );
}
