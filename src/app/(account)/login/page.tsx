import { redirect } from "next/navigation";

import { signOutAction } from "@/app/(account)/sign-out-action";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LoginForm } from "@/components/account/login-form";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getSafeInternalRedirect } from "@/lib/redirects";
import { getSingleParam } from "@/lib/site";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await getViewer();
  const resolvedSearchParams = await searchParams;
  const redirectTo = getSingleParam(resolvedSearchParams.redirectTo);
  const safeRedirectTo = getSafeInternalRedirect(redirectTo);
  const claimBusinessFlow = redirectTo?.startsWith("/claim?business=") ?? false;

  if (viewer && (!claimBusinessFlow || viewer.role === "BUSINESS_OWNER")) {
    redirect(
      viewer.profileCompleted
        ? safeRedirectTo
          ? safeRedirectTo
          : "/dashboard"
        : safeRedirectTo
          ? `/complete-profile?redirectTo=${encodeURIComponent(safeRedirectTo)}`
          : "/complete-profile",
    );
  }

  const error = getSingleParam(resolvedSearchParams.error);
  const copy =
    locale === "it"
      ? {
          body: claimBusinessFlow
            ? "Per rivendicare una scheda devi accedere con un account attivita oppure crearne uno nuovo."
            : "Accedi al tuo spazio per seguire le tue schede, gestire la directory e continuare il tuo percorso come attivita, Partner locale o visitatore.",
          eyebrow: claimBusinessFlow ? "Rivendica scheda" : "Account Salento Local",
          signedInWrongAccount:
            "Sei gia dentro con un account che non puo rivendicare attivita. Esci e continua con un account attivita.",
          manageExisting: "Vuoi gestire un'attività già presente?",
          manageExistingLink: "Invia un link di accesso",
          signupHelper: "Non hai ancora un account attivita?",
          signupLabel: "Crea account attivita",
          title: claimBusinessFlow ? "Accedi con il tuo account attivita" : "Accedi",
          wrongAccountCta: "Esci e continua",
        }
      : {
          body: claimBusinessFlow
            ? "To claim a listing, you need to log in with a business account or create one first."
            : "Log in to manage your listings, continue your directory activity, and pick up where you left off as a business, Local Partner, or visitor.",
          eyebrow: claimBusinessFlow ? "Claim listing" : "Salento Local account",
          signedInWrongAccount:
            "You are already signed in with an account that cannot claim businesses. Log out and continue with a business account.",
          manageExisting: "Need to manage a business already on Salento Local?",
          manageExistingLink: "Send an access link",
          signupHelper: "Need a business account?",
          signupLabel: "Create business account",
          title: claimBusinessFlow ? "Log in with your business account" : "Log in",
          wrongAccountCta: "Log out and continue",
        };
  const businessSignupHref = redirectTo
    ? `/signup/business?redirectTo=${encodeURIComponent(redirectTo)}`
    : "/signup/business";

  return (
    <main className="shell px-4 py-14 sm:px-6">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-8">
          <p className="section-kicker mb-3">{copy.eyebrow}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
          <p className="mt-4 max-w-lg text-[var(--muted)]">{copy.body}</p>
          <div className="mt-8 rounded-2xl bg-[var(--secondary)] p-5 text-sm text-[var(--muted)]">
            <p>
              {locale === "it"
                ? "Con un account puoi salvare bozze, inviare nuove schede e controllare in un unico posto attivita, pagamenti e pubblicazioni."
                : "With an account you can save drafts, send new listings, and track businesses, payments, and publication status in one place."}
            </p>
          </div>
        </section>

        <section className="card p-8">
          {error ? <p className="mb-4 text-sm text-[var(--accent)]">{error}</p> : null}
          {viewer && claimBusinessFlow && viewer.role !== "BUSINESS_OWNER" ? (
            <div className="grid gap-5">
              <div className="rounded-2xl border border-[color:rgba(191,91,42,0.18)] bg-[color:rgba(191,91,42,0.08)] px-4 py-4 text-sm text-[var(--foreground)]">
                {copy.signedInWrongAccount}
              </div>
              <form action={signOutAction}>
                <button type="submit" className="btn-primary w-full sm:w-auto">
                  {copy.wrongAccountCta}
                </button>
              </form>
              <p className="text-sm text-[var(--muted)]">
                {copy.signupHelper}{" "}
                <HardNavigationLink
                  href={businessSignupHref}
                  className="font-medium text-[var(--primary)]"
                >
                  {copy.signupLabel}
                </HardNavigationLink>
              </p>
            </div>
          ) : (
            <>
              <LoginForm
                helperText={claimBusinessFlow ? copy.signupHelper : undefined}
                locale={locale}
                redirectTo={redirectTo ?? ""}
                signupHref={claimBusinessFlow ? businessSignupHref : undefined}
                signupLabel={claimBusinessFlow ? copy.signupLabel : undefined}
              />
              <p className="mt-5 text-sm text-[var(--muted)]">
                {copy.manageExisting}{" "}
                <HardNavigationLink href="/manage-business" className="font-medium text-[var(--primary)]">
                  {copy.manageExistingLink}
                </HardNavigationLink>
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
