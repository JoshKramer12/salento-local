"use client";

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { useActionState, useMemo, useState } from "react";
import { IconCheck, IconSearch } from "@tabler/icons-react";

import {
  completeLocalPartnerOnboardingAction,
  type FormState,
} from "@/app/(account)/actions";
import { completePartnerSignupAction } from "@/app/(account)/auth-actions";
import { SegmentedDateInput } from "@/components/account/segmented-date-input";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";
import type { PhoneCountryOption } from "@/lib/phone-country-options";

const initialState: FormState = {};
const phoneInputMaxLength = 24;

type PhoneParts = {
  country: CountryCode;
  number: string;
};

type LocalPartnerOnboardingFormProps = {
  backHref?: string;
  locale: Locale;
  needsDetails: boolean;
  phoneCountryOptions: PhoneCountryOption[];
  profile?: {
    baseTownOrArea?: string | null;
    birthDate?: Date | null;
    heardAbout?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
  } | null;
  payoutSetup?: {
    bankAccountLast4?: string | null;
    bankName?: string | null;
    connectedAccountId?: string | null;
    setupState?: "action-required" | "ready" | "restricted" | "setup-incomplete" | "setup-not-started";
  } | null;
  returnTo: string;
  signupMode?: boolean;
  towns: Array<{
    id: string;
    name: string;
  }>;
};

function splitPhoneValue(value: string, fallbackCountry: CountryCode): PhoneParts {
  const trimmed = value.trim();

  return {
    country: fallbackCountry,
    number: trimmed.replace(/^\+\d+\s*/, ""),
  };
}

function buildPhoneValue(parts: PhoneParts, options: PhoneCountryOption[]) {
  const localNumber = parts.number.trim();

  if (!localNumber) {
    return "";
  }

  const dialCode = options.find((option) => option.code === parts.country)?.dialCode ?? "+39";
  return `${dialCode} ${localNumber}`.trim();
}

function normalizePhoneInput(value: string) {
  return value.replace(/[^\d\s().-]+/g, "").slice(0, phoneInputMaxLength);
}

function isPossiblePhoneNumber(value: string, fallbackCountry: CountryCode) {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const parsed =
    parsePhoneNumberFromString(trimmed) ??
    parsePhoneNumberFromString(trimmed, fallbackCountry);

  return Boolean(parsed?.isPossible());
}

function getInputClass(hasError: boolean) {
  return hasError
    ? "input-field !border-[rgba(191,91,42,0.48)] bg-[rgba(255,248,243,0.92)] ring-2 ring-[rgba(191,91,42,0.16)]"
    : "input-field";
}

function normalizeHeardAboutValue(value: string | null | undefined) {
  if (!value) {
    return {
      otherText: "",
      value: "friend-family",
    };
  }

  if (value.startsWith("other:")) {
    return {
      otherText: value.slice("other:".length),
      value: "other",
    };
  }

  return {
    otherText: "",
    value,
  };
}

export function LocalPartnerOnboardingForm({
  backHref,
  locale,
  needsDetails,
  phoneCountryOptions,
  profile,
  payoutSetup,
  returnTo,
  signupMode = false,
  towns,
}: LocalPartnerOnboardingFormProps) {
  const submitAction = signupMode
    ? completePartnerSignupAction
    : completeLocalPartnerOnboardingAction;
  const [state, action] = useActionState(submitAction, initialState);
  const defaultCountry = (phoneCountryOptions.find((option) => option.code === "IT")?.code ??
    phoneCountryOptions[0]?.code ??
    "IT") as CountryCode;
  const [phoneParts, setPhoneParts] = useState<PhoneParts>(() =>
    splitPhoneValue(profile?.phone ?? "", defaultCountry),
  );
  const [townQuery, setTownQuery] = useState(profile?.baseTownOrArea ?? "");
  const [selectedTownId, setSelectedTownId] = useState("");
  const [townMenuOpen, setTownMenuOpen] = useState(false);
  const heardAboutState = normalizeHeardAboutValue(profile?.heardAbout);
  const [heardAbout, setHeardAbout] = useState(heardAboutState.value);
  const [birthDate, setBirthDate] = useState(
    profile?.birthDate ? profile.birthDate.toISOString().slice(0, 10) : "",
  );
  const copy =
    locale === "it"
      ? {
          birthDate: "Data di nascita",
          back: "Indietro",
          createAccount: "Crea account",
          detailsCta: "Continua",
          finishBody:
            "Stripe ha ancora bisogno di alcune informazioni prima di abilitare i pagamenti.",
          finishTitle: "Completa la configurazione dei pagamenti",
          hometown: "Citta di origine",
          howHeard: "Come hai conosciuto Salento Local?",
          notStartedBody: "Collega il tuo conto bancario prima di poter ricevere i guadagni.",
          notStartedTitle: "Configura i pagamenti",
          other: "Altro",
          otherPlaceholder: "Raccontacelo",
          pending: "Salvataggio...",
          creatingAccount: "Creazione account...",
          phone: "WhatsApp / numero di telefono",
          phoneCode: "Prefisso internazionale",
          phoneNumber: "Numero di telefono",
          payoutBody:
            "Stripe raccogliera direttamente i tuoi dati personali e bancari in modo sicuro. Salento Local non conserva il tuo IBAN completo.",
          payoutButton: "Configura i pagamenti",
          readyBody:
            "Il tuo conto bancario e collegato e i tuoi guadagni idonei verranno pagati automaticamente.",
          readyTitle: "I pagamenti sono pronti",
          review: "Controlla dati pagamento",
          searchTown: "Cerca un comune",
          stepDetails: "Dati partner",
          stepPayouts: "Pagamenti",
          update: "Aggiorna dati pagamento",
          heardChoices: [
            ["friend-family", "Amici o famiglia"],
            ["social-media", "Social media"],
            ["online-search", "Ricerca online"],
            ["business-owner", "Un titolare di attivita"],
            ["local-event", "Un evento locale"],
            ["other", "Altro"],
          ] as const,
        }
      : {
          birthDate: "Birth date",
          back: "Back",
          createAccount: "Create account",
          detailsCta: "Continue",
          finishBody: "Stripe still needs some information before payouts can be enabled.",
          finishTitle: "Finish setting up your payouts",
          hometown: "Hometown",
          howHeard: "How did you hear about Salento Local?",
          notStartedBody: "Connect your bank account before you can receive earnings.",
          notStartedTitle: "Set up your payouts",
          other: "Other",
          otherPlaceholder: "Tell us more",
          pending: "Saving...",
          creatingAccount: "Creating account...",
          phone: "WhatsApp / phone number",
          phoneCode: "Country code",
          phoneNumber: "Phone number",
          payoutBody:
            "Stripe will securely collect your identity and bank details directly. Salento Local does not store your full IBAN.",
          payoutButton: "Set up payouts",
          readyBody:
            "Your bank account is connected and your eligible earnings will be paid automatically.",
          readyTitle: "Payouts are ready",
          review: "Review payout details",
          searchTown: "Search for a town",
          stepDetails: "Partner details",
          stepPayouts: "Payouts",
          update: "Update payout details",
          heardChoices: [
            ["friend-family", "Friends or family"],
            ["social-media", "Social media"],
            ["online-search", "Online search"],
            ["business-owner", "A business owner"],
            ["local-event", "A local event"],
            ["other", "Other"],
          ] as const,
        };

  const filteredTowns = useMemo(() => {
    const query = townQuery.trim().toLowerCase();

    if (!query) {
      return towns.slice(0, 12);
    }

    return towns.filter((town) => town.name.toLowerCase().includes(query)).slice(0, 12);
  }, [townQuery, towns]);

  const setupState = payoutSetup?.setupState ?? "setup-not-started";
  const currentPhoneValue = buildPhoneValue(phoneParts, phoneCountryOptions);
  const livePhoneError =
    currentPhoneValue.trim() && !isPossiblePhoneNumber(currentPhoneValue, defaultCountry)
      ? locale === "it"
        ? "Inserisci un numero di telefono valido."
        : "Enter a valid phone number."
      : "";
  const phoneErrorMessage = state.fieldErrors?.phone || livePhoneError;
  const hasPhoneError = Boolean(phoneErrorMessage);
  const setupCopy =
    setupState === "ready"
      ? { body: copy.readyBody, cta: null, title: copy.readyTitle }
      : setupState === "setup-incomplete"
        ? { body: copy.finishBody, cta: copy.payoutButton, title: copy.finishTitle }
        : setupState === "action-required" || setupState === "restricted"
          ? {
              body: copy.finishBody,
              cta: setupState === "restricted" ? copy.review : copy.update,
              title: copy.finishTitle,
            }
          : { body: copy.notStartedBody, cta: copy.payoutButton, title: copy.notStartedTitle };

  if (!needsDetails) {
    return (
      <div className="grid gap-5">
        <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {copy.stepPayouts}
          </p>
          <h2 className="mt-3 font-serif text-3xl text-[var(--foreground)]">{setupCopy.title}</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{copy.payoutBody}</p>
          <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">{setupCopy.body}</p>
          {payoutSetup?.bankAccountLast4 ? (
            <p className="mt-4 text-sm text-[var(--foreground)]">
              {payoutSetup.bankName ? `${payoutSetup.bankName} ` : ""}••••{" "}
              {payoutSetup.bankAccountLast4}
            </p>
          ) : null}
        </div>
        {setupCopy.cta ? (
          <form action="/api/stripe/connect/onboarding/start" method="get">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="btn-primary block w-full text-center">
              {setupCopy.cta}
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="phone" value={currentPhoneValue} />
      <input
        type="hidden"
        name="whatsapp"
        value={currentPhoneValue}
      />
      <input type="hidden" name="hometownTownId" value={selectedTownId} />
      <input type="hidden" name="baseTownOrArea" value={townQuery} />

      <div className="rounded-[1.4rem] border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.05)] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.stepDetails}
        </p>
      </div>

      <label className="field-label">
        <span>{copy.phone}</span>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <select
            value={phoneParts.country}
            onChange={(event) =>
              setPhoneParts((current) => ({
                ...current,
                country: event.target.value as CountryCode,
              }))
            }
            className="input-field"
            aria-label={copy.phoneCode}
          >
            {phoneCountryOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={phoneParts.number}
            onChange={(event) =>
              setPhoneParts((current) => ({
                ...current,
                number: normalizePhoneInput(event.target.value),
              }))
            }
            inputMode="tel"
            maxLength={phoneInputMaxLength}
            className={getInputClass(hasPhoneError)}
            placeholder={copy.phoneNumber}
            aria-invalid={hasPhoneError}
          />
        </div>
        {phoneErrorMessage ? (
          <span className="text-sm text-[var(--accent)]">{phoneErrorMessage}</span>
        ) : null}
      </label>

      <div className="field-label relative">
        <span>{copy.hometown}</span>
        <div className="relative">
          <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]">
            <IconSearch size={16} />
          </div>
          <input
            value={townQuery}
            onFocus={() => setTownMenuOpen(true)}
            onChange={(event) => {
              setTownQuery(event.target.value);
              setSelectedTownId("");
              setTownMenuOpen(true);
            }}
            className="input-field !pl-14"
            placeholder={copy.searchTown}
          />
          {townMenuOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+0.55rem)] z-40 overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
              {filteredTowns.map((town) => (
                <button
                  key={town.id}
                  type="button"
                  onClick={() => {
                    setSelectedTownId(town.id);
                    setTownQuery(town.name);
                    setTownMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[color:rgba(247,244,239,0.74)]"
                >
                  <span>{town.name}</span>
                  {selectedTownId === town.id ? <IconCheck size={16} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {state.fieldErrors?.baseTownOrArea ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.baseTownOrArea}</span>
        ) : null}
      </div>

      <label className="field-label">
        <span>{copy.birthDate}</span>
        <SegmentedDateInput
          locale={locale}
          name="birthDate"
          value={birthDate}
          onChange={setBirthDate}
        />
        {state.fieldErrors?.birthDate ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.birthDate}</span>
        ) : null}
      </label>

      <div className="grid gap-3 rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-5">
        <p className="text-sm font-medium text-[var(--foreground)]">{copy.howHeard}</p>
        {copy.heardChoices.map(([value, label]) => (
          <label key={value} className="flex items-start gap-3 text-sm text-[var(--foreground)]">
            <input
              type="radio"
              name="heardAbout"
              value={value}
              defaultChecked={heardAbout === value}
              onChange={() => setHeardAbout(value)}
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <span>{label}</span>
          </label>
        ))}
        {heardAbout === "other" ? (
          <input
            name="heardAboutOther"
            defaultValue={heardAboutState.otherText}
            className="input-field"
            placeholder={copy.otherPlaceholder}
          />
        ) : null}
        {state.fieldErrors?.heardAbout ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.heardAbout}</span>
        ) : null}
      </div>

      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}

      <div className="flex items-center justify-between gap-3">
        {signupMode && backHref ? (
          <HardNavigationLink href={backHref} className="btn-secondary">
            {copy.back}
          </HardNavigationLink>
        ) : null}
        <FormSubmitButton
          className={signupMode ? "btn-primary flex-1 sm:flex-none" : "btn-primary w-full sm:w-auto"}
          pendingLabel={signupMode ? copy.creatingAccount : copy.pending}
          name="intent"
          value="save"
        >
          {signupMode ? copy.createAccount : copy.detailsCta}
        </FormSubmitButton>
      </div>
    </form>
  );
}
