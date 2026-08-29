"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js/pure";
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from "@stripe/react-connect-js";

import type { Locale } from "@/lib/i18n";

type PartnerEmbeddedOnboardingProps = {
  locale: Locale;
  publishableKey: string;
  returnUrl: string;
  skipHref: string;
};

export function PartnerEmbeddedOnboarding({
  locale,
  publishableKey,
  returnUrl,
  skipHref,
}: PartnerEmbeddedOnboardingProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const connectLocale = locale === "it" ? "it-IT" : "en-US";
  const connectInstance = useMemo(() => {
    if (!publishableKey || typeof window === "undefined") {
      return null;
    }

    return loadConnectAndInitialize({
      fetchClientSecret: async () => {
        const response = await fetch("/api/stripe/connect/account-session", {
          cache: "no-store",
          credentials: "same-origin",
          method: "POST",
        });
        const payload = (await response.json()) as {
          clientSecret?: string;
          error?: string;
        };

        if (!response.ok || !payload.clientSecret) {
          throw new Error(payload.error || "account_session_unavailable");
        }

        return payload.clientSecret;
      },
      locale: connectLocale,
      publishableKey,
    });
  }, [connectLocale, publishableKey]);

  const copy =
    locale === "it"
      ? {
          body:
            "Collega il tuo conto bancario per ricevere i pagamenti. Puoi completare la configurazione ora oppure tornare alla dashboard e farlo in seguito.",
          heading: "Collega il tuo conto bancario",
          missingKey:
            "La configurazione Stripe non e disponibile in questo momento. Riprova tra poco.",
          retry:
            "Non siamo riusciti a caricare la configurazione Stripe. Riprova tra poco.",
          retryButton: "Riprova",
          skip: "Configura più tardi",
        }
      : {
          body:
            "Connect your bank account to receive payments. You can finish setup now or return to the dashboard and do it later.",
          heading: "Connect your bank account",
          missingKey:
            "Stripe setup is not available right now. Please try again shortly.",
          retry:
            "We couldn't load Stripe setup. Please try again shortly.",
          retryButton: "Try again",
          skip: "Set up later",
        };

  const errorMessage = !publishableKey ? copy.missingKey : loadError ? copy.retry : null;

  return (
    <section className="card p-8 sm:p-10">
      <h2 className="font-serif text-4xl text-[var(--foreground)] sm:text-[2.8rem]">
        {copy.heading}
      </h2>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)] sm:text-base">
        {copy.body}
      </p>

      {errorMessage ? (
        <div className="mt-6 rounded-[1.4rem] border border-[color:rgba(191,91,42,0.18)] bg-[color:rgba(191,91,42,0.06)] px-5 py-4 text-sm leading-7 text-[var(--foreground)]">
          {errorMessage}
        </div>
      ) : null}

      {connectInstance ? (
        <div className="mt-8 overflow-hidden rounded-[1.75rem] border border-[var(--border)] bg-white">
          <ConnectComponentsProvider connectInstance={connectInstance}>
            <ConnectAccountOnboarding
              collectionOptions={{
                fields: "eventually_due",
                futureRequirements: "include",
              }}
              onExit={() => {
                window.location.assign(returnUrl);
              }}
              onLoadError={({ error }) => {
                setLoadError(error.message || "connect_load_failed");
              }}
            />
          </ConnectComponentsProvider>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {errorMessage ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary inline-flex w-full justify-center sm:w-auto"
          >
            {copy.retryButton}
          </button>
        ) : null}
        <Link href={skipHref} className="btn-secondary inline-flex w-full justify-center sm:w-auto">
          {copy.skip}
        </Link>
      </div>
    </section>
  );
}
