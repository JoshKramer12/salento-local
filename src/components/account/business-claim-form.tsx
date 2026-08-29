"use client";

import {
  IconArrowUpRight,
  IconBuildingStore,
  IconCheck,
  IconMail,
  IconMessage2,
  IconSearch,
} from "@tabler/icons-react";
import {
  useActionState,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import { requestBusinessClaimAction, type FormState } from "@/app/(account)/actions";
import { LegalConsentCopy } from "@/components/legal/legal-consent-copy";
import type { ClaimVerificationMethod } from "@/lib/business-claim-verification";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type ClaimableBusiness = {
  id: string;
  label: string;
  slug: string;
  subtitle?: string;
};

type BusinessClaimFormProps = {
  availableMethods: ClaimVerificationMethod[];
  initialBusiness?: ClaimableBusiness;
  locale: Locale;
  requiresLegalAcceptance: boolean;
};

export function BusinessClaimForm({
  availableMethods,
  initialBusiness,
  locale,
  requiresLegalAcceptance,
}: BusinessClaimFormProps) {
  const [state, action] = useActionState(requestBusinessClaimAction, initialState);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialBusiness?.label ?? "");
  const [selectedBusinessId, setSelectedBusinessId] = useState(initialBusiness?.id ?? "");
  const [verificationChannel, setVerificationChannel] = useState<ClaimVerificationMethod>(
    availableMethods[0] ?? "EMAIL",
  );
  const [businessTermsAccepted, setBusinessTermsAccepted] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [filteredBusinesses, setFilteredBusinesses] = useState<ClaimableBusiness[]>(
    initialBusiness ? [initialBusiness] : [],
  );
  const [selectedBusiness, setSelectedBusiness] = useState<ClaimableBusiness | null>(
    initialBusiness ?? null,
  );
  const deferredQuery = useDeferredValue(query.trim());
  const copy =
    locale === "it"
      ? {
          business: "Attivita da rivendicare",
          businessHelp: "Cerca per nome o comune e seleziona la scheda corretta.",
          cta: "Invia richiesta di rivendicazione",
          methodEmailBody:
            "Invieremo il codice all'email personale gia registrata per il proprietario o manager di questa scheda.",
          methodEmailTitle: "Verifica via email",
          methodSmsBody:
            "Invieremo il codice al numero personale gia registrato per il proprietario o manager di questa scheda.",
          methodSmsTitle: "Verifica via SMS",
          methodTitle: "Come vuoi verificare la tua richiesta?",
          name: "Il tuo nome",
          noResults: "Nessuna attivita trovata con questa ricerca.",
          pending: "Invio richiesta...",
          position: "Ruolo nell'attivita",
          search: "Cerca attivita esistente",
          selected: "Scheda selezionata",
          legalHelp:
            "Apri i documenti legali in una nuova scheda per non perdere i dati gia inseriti.",
          legalTitle: "Termini e documenti legali",
          storedContactHelp:
            "Usa il metodo che corrisponde al contatto privato gia salvato su questa attivita.",
        }
      : {
          business: "Business to claim",
          businessHelp: "Search by name or town and select the correct listing.",
          cta: "Send claim request",
          methodEmailBody:
            "We will send the code to the personal email already registered for the owner or manager of this listing.",
          methodEmailTitle: "Verify by email",
          methodSmsBody:
            "We will send the code to the personal phone number already registered for the owner or manager of this listing.",
          methodSmsTitle: "Verify by SMS",
          methodTitle: "How would you like to verify your claim?",
          name: "Your name",
          noResults: "No business matched this search.",
          pending: "Sending request...",
          position: "Your role at the business",
          search: "Search an existing business",
          selected: "Selected listing",
          legalHelp:
            "Open the legal documents in a new tab so you do not lose the information you already entered.",
          legalTitle: "Terms and legal documents",
          storedContactHelp:
            "Choose the method that matches the private owner contact already saved on this listing.",
        };

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!deferredQuery || (selectedBusiness && deferredQuery === selectedBusiness.label)) {
      return;
    }

    const controller = new AbortController();

    async function run() {
      try {
        const response = await fetch(
          `/api/claim-businesses?q=${encodeURIComponent(deferredQuery)}&locale=${locale}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok || controller.signal.aborted) {
          return;
        }

        const payload = (await response.json()) as {
          businesses?: ClaimableBusiness[];
        };

        if (!controller.signal.aborted) {
          setFilteredBusinesses(payload.businesses ?? []);
          setHighlightedIndex(-1);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setFilteredBusinesses([]);
          setHighlightedIndex(-1);
        }
      }
    }

    void run();

    return () => controller.abort();
  }, [deferredQuery, locale, selectedBusiness]);

  function selectBusiness(business: ClaimableBusiness) {
    setSelectedBusinessId(business.id);
    setSelectedBusiness(business);
    setQuery(business.label);
    setOpen(false);
    setHighlightedIndex(-1);
  }

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="businessId" value={selectedBusinessId} />
      <input type="hidden" name="verificationChannel" value={verificationChannel} />

      <div className="grid gap-4 rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] p-5">
        <div ref={containerRef} className="field-label relative">
          <span>{copy.business}</span>
          <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-[var(--shadow-card)]">
            <IconSearch size={18} className="shrink-0 text-[var(--muted)]" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedBusinessId("");
                setSelectedBusiness(null);
                setOpen(true);
                setHighlightedIndex(-1);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (!filteredBusinesses.length) {
                  return;
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  setHighlightedIndex((current) =>
                    current >= filteredBusinesses.length - 1 ? 0 : current + 1,
                  );
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  setHighlightedIndex((current) =>
                    current <= 0 ? filteredBusinesses.length - 1 : current - 1,
                  );
                  return;
                }

                if (event.key === "Enter" && highlightedIndex >= 0) {
                  event.preventDefault();
                  selectBusiness(filteredBusinesses[highlightedIndex]);
                  return;
                }

                if (event.key === "Escape") {
                  setOpen(false);
                  setHighlightedIndex(-1);
                }
              }}
              placeholder={copy.search}
              className="min-w-0 flex-1 bg-transparent text-base text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
              autoComplete="off"
            />
          </div>
          {open && query.trim() ? (
            filteredBusinesses.length ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-40 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
                <div className="max-h-[22rem] overflow-y-auto py-2">
                  {filteredBusinesses.map((business, index) => (
                    <button
                      key={business.id}
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectBusiness(business)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                        highlightedIndex === index
                          ? "bg-[var(--secondary)]"
                          : "hover:bg-[color:rgba(247,244,239,0.7)]"
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)]">
                        <IconBuildingStore size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                          {business.label}
                        </span>
                        {business.subtitle ? (
                          <span className="block truncate text-xs text-[var(--muted)]">
                            {business.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[var(--muted)]">
                        <IconArrowUpRight size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-40 rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                {copy.noResults}
              </div>
            )
          ) : null}
          {state.fieldErrors?.businessId ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.businessId}</span>
          ) : null}
        </div>
        <p className="text-sm text-[var(--muted)]">{copy.businessHelp}</p>
        {selectedBusiness ? (
          <div className="rounded-[1.4rem] border border-[color:rgba(42,98,87,0.18)] bg-[linear-gradient(135deg,rgba(250,255,252,0.96),rgba(236,245,241,0.96))] px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:rgba(42,98,87,0.12)] text-[var(--primary)]">
                <IconCheck size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                  {copy.selected}
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
                  {selectedBusiness.label}
                </p>
                {selectedBusiness.subtitle ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">{selectedBusiness.subtitle}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field-label">
          <span>{copy.name}</span>
          <input name="claimantName" className="input-field" />
          {state.fieldErrors?.claimantName ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.claimantName}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{copy.position}</span>
          <input name="claimantPosition" className="input-field" />
          {state.fieldErrors?.claimantPosition ? (
            <span className="text-sm text-[var(--accent)]">
              {state.fieldErrors.claimantPosition}
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid gap-4 rounded-[1.75rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
        <p className="text-sm leading-7 text-[var(--muted)]">{copy.methodTitle}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {availableMethods.includes("EMAIL") ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border)] p-4">
              <input
                type="radio"
                checked={verificationChannel === "EMAIL"}
                onChange={() => setVerificationChannel("EMAIL")}
                className="mt-1 h-4 w-4 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <IconMail size={16} className="text-[var(--primary)]" />
                  {copy.methodEmailTitle}
                </span>
                <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">
                  {copy.methodEmailBody}
                </span>
              </span>
            </label>
          ) : null}
          {availableMethods.includes("SMS") ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border)] p-4">
              <input
                type="radio"
                checked={verificationChannel === "SMS"}
                onChange={() => setVerificationChannel("SMS")}
                className="mt-1 h-4 w-4 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <IconMessage2 size={16} className="text-[var(--primary)]" />
                  {copy.methodSmsTitle}
                </span>
                <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">
                  {copy.methodSmsBody}
                </span>
              </span>
            </label>
          ) : null}
        </div>
        {state.fieldErrors?.verificationChannel ? (
          <p className="text-sm text-[var(--accent)]">{state.fieldErrors.verificationChannel}</p>
        ) : null}

        <p className="text-sm text-[var(--muted)]">{copy.storedContactHelp}</p>
      </div>

      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.legalTitle}
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy.legalHelp}</p>
        {requiresLegalAcceptance ? (
          <div className="mt-4 rounded-[1.4rem] border border-[color:rgba(42,98,87,0.16)] bg-white px-5 py-4">
            <label
              htmlFor="businessTermsAccepted"
              className="flex items-start gap-3 text-sm leading-6 text-[var(--foreground)]"
            >
              <input
                id="businessTermsAccepted"
                type="checkbox"
                name="businessTermsAccepted"
                checked={businessTermsAccepted}
                onChange={(event) => setBusinessTermsAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--primary)]"
              />
              <span>
                <LegalConsentCopy audience="business" locale={locale} />
              </span>
            </label>
            {state.fieldErrors?.businessTermsAccepted ? (
              <p className="mt-3 text-sm text-[var(--accent)]">
                {state.fieldErrors.businessTermsAccepted}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-[var(--foreground)]">
            <LegalConsentCopy audience="business" locale={locale} variant="info" />
          </p>
        )}
      </div>

      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}

      <FormSubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={copy.pending}>
        {copy.cta}
      </FormSubmitButton>
    </form>
  );
}
