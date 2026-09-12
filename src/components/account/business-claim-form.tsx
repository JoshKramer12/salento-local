"use client";

import {
  IconArrowLeft,
  IconBuildingStore,
  IconMail,
  IconSearch,
} from "@tabler/icons-react";
import { useActionState, useDeferredValue, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { requestBusinessClaimAction, type FormState } from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { LegalConsentCopy } from "@/components/legal/legal-consent-copy";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type ClaimableBusiness = {
  id: string;
  label: string;
  slug: string;
  subtitle?: string;
};

export type ClaimBusinessSummary = {
  address: string;
  category: string;
  email: string;
  id: string;
  imageUrl: string | null;
  locality: string | null;
  name: string;
  slug: string;
  town: string;
};

type BusinessClaimFormProps = {
  initialBusiness?: ClaimBusinessSummary;
  locale: Locale;
  requiresLegalAcceptance?: boolean;
};

export function BusinessClaimForm({ initialBusiness, locale, requiresLegalAcceptance = false }: BusinessClaimFormProps) {
  const router = useRouter();
  const [state, action] = useActionState(requestBusinessClaimAction, initialState);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [filteredBusinesses, setFilteredBusinesses] = useState<ClaimableBusiness[]>([]);
  const deferredQuery = useDeferredValue(query.trim());
  const copy =
    locale === "it"
      ? {
          back: "Torna alla pagina dell'attività",
          body: "Per proteggere le attività da rivendicazioni non autorizzate, invieremo un codice di verifica di 6 cifre all'indirizzo email già associato a questa scheda.",
          email: "Codice inviato a",
          isThisYours: "È la tua attività?",
          noResults: "Nessuna attività trovata con questa ricerca.",
          pending: "Invio del codice...",
          search: "Cerca un'attività esistente",
          send: "Invia codice di verifica",
          title: "Rivendica questa attività",
        }
      : {
          back: "Back to business page",
          body: "To protect businesses from unauthorized claims, we'll send a 6-digit verification code to the email address already associated with this listing.",
          email: "Code sent to",
          isThisYours: "Is this your business?",
          noResults: "No business matched this search.",
          pending: "Sending code...",
          search: "Search an existing business",
          send: "Send verification code",
          title: "Claim this business",
        };

  useEffect(() => {
    if (initialBusiness || !deferredQuery) {
      return;
    }

    const controller = new AbortController();

    async function searchBusinesses() {
      try {
        const response = await fetch(
          `/api/claim-businesses?q=${encodeURIComponent(deferredQuery)}&locale=${locale}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as { businesses?: ClaimableBusiness[] };

        if (response.ok && !controller.signal.aborted) {
          setFilteredBusinesses(payload.businesses ?? []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFilteredBusinesses([]);
        }
      }
    }

    void searchBusinesses();
    return () => controller.abort();
  }, [deferredQuery, initialBusiness, locale]);

  if (!initialBusiness) {
    return (
      <div className="grid gap-5">
        <div>
          <p className="section-kicker mb-3">{copy.title}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.search}</h1>
        </div>
        <div className="field-label relative">
          <span>{copy.search}</span>
          <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-[var(--shadow-card)]">
            <IconSearch size={18} className="shrink-0 text-[var(--muted)]" />
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-base text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={copy.search}
              value={query}
            />
          </div>
          {open && deferredQuery ? (
            filteredBusinesses.length ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-40 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
                {filteredBusinesses.map((business) => (
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--secondary)]"
                    key={business.id}
                    onClick={() => router.push(`/claim?business=${encodeURIComponent(business.slug)}`)}
                    type="button"
                  >
                    <IconBuildingStore size={18} className="shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0"><span className="block truncate font-medium">{business.label}</span><span className="block truncate text-sm text-[var(--muted)]">{business.subtitle}</span></span>
                  </button>
                ))}
              </div>
            ) : <span className="mt-3 block text-sm text-[var(--muted)]">{copy.noResults}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-6">
      <input name="businessId" type="hidden" value={initialBusiness.id} />
      <input name="locale" type="hidden" value={locale} />
      <div>
        <p className="section-kicker mb-3">{copy.title}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">{initialBusiness.name}</h1>
      </div>
      <article className="overflow-hidden rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.72)] sm:flex">
        {initialBusiness.imageUrl ? <img alt="" className="h-40 w-full object-cover sm:h-auto sm:w-44" src={initialBusiness.imageUrl} /> : <div className="flex h-28 items-center justify-center bg-[var(--secondary)] text-[var(--primary)] sm:h-auto sm:w-44"><IconBuildingStore size={30} /></div>}
        <div className="min-w-0 p-5">
          <p className="section-kicker">{initialBusiness.category}</p>
          <h2 className="mt-2 break-words font-serif text-2xl text-[var(--foreground)]">{initialBusiness.name}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{initialBusiness.address}</p>
          <p className="text-sm text-[var(--muted)]">{initialBusiness.locality ? `${initialBusiness.locality}, ` : ""}{initialBusiness.town}</p>
        </div>
      </article>
      <section className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
        <h2 className="font-serif text-2xl text-[var(--foreground)]">{copy.isThisYours}</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">{copy.body}</p>
        <p className="mt-4 flex min-w-0 items-center gap-2 text-sm text-[var(--foreground)]"><IconMail size={17} className="shrink-0 text-[var(--primary)]" /><span>{copy.email}: </span><strong className="truncate">{initialBusiness.email}</strong></p>
      </section>
      {requiresLegalAcceptance ? <label className="flex items-start gap-3 rounded-[1.5rem] bg-[var(--secondary)] p-4 text-sm leading-6 text-[var(--foreground)]"><input className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]" name="businessTermsAccepted" type="checkbox" /><span><LegalConsentCopy audience="business" locale={locale} /></span></label> : null}
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <FormSubmitButton className="btn-primary min-h-12 w-full sm:w-auto" pendingLabel={copy.pending}>{copy.send}</FormSubmitButton>
        <a className="btn-secondary min-h-12 w-full sm:w-auto" href={`/businesses/${initialBusiness.slug}`}><IconArrowLeft size={16} />{copy.back}</a>
      </div>
    </form>
  );
}
