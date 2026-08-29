"use client";

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconCheck, IconSearch } from "@tabler/icons-react";

import { signupAction, type FormState } from "@/app/(account)/auth-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { SegmentedDateInput } from "@/components/account/segmented-date-input";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LegalConsentCopy } from "@/components/legal/legal-consent-copy";
import type { Locale } from "@/lib/i18n";
import { getPartnerTerms } from "@/lib/legal";
import type { PhoneCountryOption } from "@/lib/phone-country-options";

const initialState: FormState = {};
const emailValidationPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneInputMaxLength = 24;

type PartnerSignupFormProps = {
  locale: Locale;
  phoneCountryOptions: PhoneCountryOption[];
  redirectTo?: string;
  towns: Array<{
    id: string;
    name: string;
  }>;
};

type PhoneParts = {
  country: CountryCode;
  number: string;
};

function splitPhoneValue(
  value: string,
  fallbackCountry: CountryCode,
  options: PhoneCountryOption[],
): PhoneParts {
  const trimmed = value.trim();
  const matchedOption = [...options]
    .sort((left, right) => right.dialCode.length - left.dialCode.length)
    .find((option) => trimmed.startsWith(`${option.dialCode} `) || trimmed === option.dialCode);

  return {
    country: matchedOption?.code ?? fallbackCountry,
    number: matchedOption ? trimmed.slice(matchedOption.dialCode.length).trim() : trimmed,
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

export function PartnerSignupForm({
  locale,
  phoneCountryOptions,
  redirectTo = "",
  towns,
}: PartnerSignupFormProps) {
  const [state, action] = useActionState(signupAction, initialState);
  const defaultCountry = (phoneCountryOptions.find((option) => option.code === "IT")?.code ??
    phoneCountryOptions[0]?.code ??
    "IT") as CountryCode;
  const [email, setEmail] = useState(state.signupValues?.email ?? "");
  const [username, setUsername] = useState(state.signupValues?.username ?? "");
  const [password, setPassword] = useState(state.signupValues?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState(
    state.signupValues?.confirmPassword ?? "",
  );
  const [phoneParts, setPhoneParts] = useState<PhoneParts>(() =>
    splitPhoneValue(state.signupValues?.partnerPhone ?? "", defaultCountry, phoneCountryOptions),
  );
  const [townQuery, setTownQuery] = useState(state.signupValues?.baseTownOrArea ?? "");
  const [selectedTownId, setSelectedTownId] = useState(state.signupValues?.hometownTownId ?? "");
  const [townMenuOpen, setTownMenuOpen] = useState(false);
  const [birthDate, setBirthDate] = useState(state.signupValues?.birthDate ?? "");
  const [heardAbout, setHeardAbout] = useState(
    state.signupValues?.heardAbout ?? "friend-family",
  );
  const [heardAboutOther, setHeardAboutOther] = useState(
    state.signupValues?.heardAboutOther ?? "",
  );
  const [partnerTermsAccepted, setPartnerTermsAccepted] = useState(
    state.signupValues?.partnerTermsAccepted ?? false,
  );
  const townPickerRef = useRef<HTMLDivElement>(null);
  const copy =
    locale === "it"
      ? {
          birthDate: "Data di nascita",
          cta: "Crea account partner",
          email: "Email",
          helper: "Hai gia un account?",
          hometown: "Citta di origine",
          howHeard: "Come hai conosciuto Salento Local?",
          login: "Accedi",
          other: "Altro",
          otherPlaceholder: "Raccontacelo",
          password: "Password",
          pending: "Creazione account...",
          phone: "WhatsApp / numero di telefono",
          phoneCode: "Prefisso internazionale",
          phoneNumber: "Numero di telefono",
          searchTown: "Cerca un comune",
          stepOne: "Passo 1",
          stepOneBody: "Crea il tuo account con email, username e password.",
          stepTwo: "Passo 2",
          stepTwoBody: "Aggiungi i tuoi dati essenziali prima di configurare i pagamenti.",
          termsIntro:
            "Prima di creare il tuo account Partner, leggi attentamente quanto segue:",
          termsTitle: "Passo 3",
          username: "Username",
          usernameHint:
            "Scegli uno username unico. Potrai accedere in seguito sia con username e password sia con email e password.",
          heardChoices: [
            ["friend-family", "Amici o famiglia"],
            ["social-media", "Social media"],
            ["online-search", "Ricerca online"],
            ["business-owner", "Un titolare di attivita"],
            ["local-event", "Un evento locale"],
            ["other", "Altro"],
          ] as const,
          termsLead: "Registrandoti come Partner di Salento Local, accetti quanto segue:",
          termsConfirmation:
            "Selezionando la casella qui sotto, confermi di aver letto, compreso e accettato i presenti Termini e Condizioni.",
        }
      : {
          birthDate: "Birth date",
          cta: "Create partner account",
          email: "Email",
          helper: "Already have an account?",
          hometown: "Hometown",
          howHeard: "How did you hear about Salento Local?",
          login: "Log in",
          other: "Other",
          otherPlaceholder: "Tell us more",
          password: "Password",
          pending: "Creating account...",
          phone: "WhatsApp / phone number",
          phoneCode: "Country code",
          phoneNumber: "Phone number",
          searchTown: "Search for a town",
          stepOne: "Step 1",
          stepOneBody: "Create your account with email, username, and password.",
          stepTwo: "Step 2",
          stepTwoBody: "Add your essential details before setting up payouts.",
          termsIntro:
            "Before creating your Partner account, please read the following:",
          termsTitle: "Step 3",
          username: "Username",
          usernameHint:
            "Choose a unique username. Later you can log in with either your username and password or your email and password.",
          heardChoices: [
            ["friend-family", "Friends or family"],
            ["social-media", "Social media"],
            ["online-search", "Online search"],
            ["business-owner", "A business owner"],
            ["local-event", "A local event"],
            ["other", "Other"],
          ] as const,
          termsLead: "By joining Salento Local as a Local Partner, you agree to the following:",
          termsConfirmation:
            "By checking the box below, you confirm that you have read, understood, and agree to these Terms & Conditions.",
        };
  const terms = getPartnerTerms(locale);
  const exactTownMatch = useMemo(() => {
    const normalizedTown = townQuery.trim().toLowerCase();

    if (!normalizedTown) {
      return null;
    }

    return (
      towns.find((town) => town.name.trim().toLowerCase() === normalizedTown) ?? null
    );
  }, [townQuery, towns]);
  const resolvedTownId = selectedTownId || exactTownMatch?.id || "";
  const resolvedTownName = exactTownMatch?.name ?? townQuery;

  const filteredTowns = useMemo(() => {
    const query = townQuery.trim().toLowerCase();

    if (!query) {
      return towns.slice(0, 12);
    }

    return towns.filter((town) => town.name.toLowerCase().includes(query)).slice(0, 12);
  }, [townQuery, towns]);

  const restoreSignupValues = useEffectEvent((signupValues: NonNullable<FormState["signupValues"]>) => {
    setEmail(signupValues.email ?? "");
    setUsername(signupValues.username ?? "");
    setPassword(signupValues.password ?? "");
    setConfirmPassword(signupValues.confirmPassword ?? "");
    setPhoneParts(
      splitPhoneValue(
        signupValues.partnerPhone ?? "",
        defaultCountry,
        phoneCountryOptions,
      ),
    );
    setTownQuery(signupValues.baseTownOrArea ?? "");
    setSelectedTownId(signupValues.hometownTownId ?? "");
    setBirthDate(signupValues.birthDate ?? "");
    setHeardAbout(signupValues.heardAbout ?? "friend-family");
    setHeardAboutOther(signupValues.heardAboutOther ?? "");
    setPartnerTermsAccepted(signupValues.partnerTermsAccepted ?? false);
  });

  useEffect(() => {
    if (!state.signupValues) {
      return;
    }

    const signupValues = state.signupValues;

    startTransition(() => {
      restoreSignupValues(signupValues);
    });
  }, [state.signupValues]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!townPickerRef.current?.contains(event.target as Node)) {
        setTownMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTownMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const phone = buildPhoneValue(phoneParts, phoneCountryOptions);
  const liveEmailError =
    email.trim() && !emailValidationPattern.test(email.trim().toLowerCase())
      ? locale === "it"
        ? "Inserisci un'email valida."
        : "Enter a valid email address."
      : "";
  const livePhoneError =
    phone.trim() && !isPossiblePhoneNumber(phone, defaultCountry)
      ? locale === "it"
        ? "Inserisci un numero di telefono valido."
        : "Enter a valid phone number."
      : "";
  const emailErrorMessage = state.fieldErrors?.email || liveEmailError;
  const phoneErrorMessage = state.fieldErrors?.phone || livePhoneError;
  const hasEmailError = Boolean(emailErrorMessage);
  const hasPhoneError = Boolean(phoneErrorMessage);

  return (
    <form action={action} className="card mx-auto grid w-full max-w-4xl gap-6 p-8 sm:p-10">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accountType" value="GETTER" />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="whatsapp" value={phone} />
      <input type="hidden" name="hometownTownId" value={resolvedTownId} />
      <input type="hidden" name="baseTownOrArea" value={resolvedTownName} />
      <input type="hidden" name="heardAbout" value={heardAbout} />

      <div className="rounded-[1.4rem] border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.05)] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.stepOne}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">{copy.stepOneBody}</p>
      </div>

      <label className="field-label">
        <span>{copy.email}</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={getInputClass(hasEmailError)}
          aria-invalid={hasEmailError}
        />
        {emailErrorMessage ? (
          <span className="text-sm text-[var(--accent)]">{emailErrorMessage}</span>
        ) : null}
      </label>

      <label className="field-label">
        <span>{copy.username}</span>
        <input
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="input-field"
        />
        <span className="text-sm text-[var(--muted)]">{copy.usernameHint}</span>
        {state.fieldErrors?.username ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.username}</span>
        ) : null}
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="field-label">
          <span>{copy.password}</span>
          <input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="input-field"
          />
          {state.fieldErrors?.password ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.password}</span>
          ) : null}
        </label>
        <label className="field-label">
          <span>{locale === "it" ? "Conferma password" : "Confirm password"}</span>
          <input
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="input-field"
          />
          {state.fieldErrors?.confirmPassword ? (
            <span className="text-sm text-[var(--accent)]">
              {state.fieldErrors.confirmPassword}
            </span>
          ) : null}
        </label>
      </div>

      <PasswordRequirements locale={locale} password={password} />

      <div className="rounded-[1.4rem] border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.05)] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.stepTwo}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">{copy.stepTwoBody}</p>
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
            aria-label={copy.phoneNumber}
            aria-invalid={hasPhoneError}
          />
        </div>
        {phoneErrorMessage ? (
          <span className="text-sm text-[var(--accent)]">{phoneErrorMessage}</span>
        ) : null}
      </label>

      <div ref={townPickerRef} className="field-label relative">
        <span>{copy.hometown}</span>
        <div className="relative">
          <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]">
            <IconSearch size={16} />
          </div>
          <input
            value={townQuery}
            onFocus={() => setTownMenuOpen(true)}
            onBlur={() => {
              if (exactTownMatch) {
                setSelectedTownId(exactTownMatch.id);
                setTownQuery(exactTownMatch.name);
              }
            }}
            onChange={(event) => {
              setTownQuery(event.target.value);
              setSelectedTownId("");
              setTownMenuOpen(true);
            }}
            aria-label={copy.searchTown}
            placeholder={copy.searchTown}
            className="input-field !pl-14"
            autoComplete="address-level2"
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

      <div className="grid gap-5 sm:grid-cols-2">
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
      </div>

      <div className="grid gap-3 rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-5">
        <p className="text-sm font-medium text-[var(--foreground)]">{copy.howHeard}</p>
        {copy.heardChoices.map(([value, label]) => (
          <label key={value} className="flex items-start gap-3 text-sm text-[var(--foreground)]">
            <input
              type="radio"
              name="heardAboutVisible"
              checked={heardAbout === value}
              onChange={() => setHeardAbout(value)}
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <span>{label}</span>
          </label>
        ))}
        {heardAbout === "other" ? (
          <input
            name="heardAboutOther"
            value={heardAboutOther}
            onChange={(event) => setHeardAboutOther(event.target.value)}
            className="input-field"
            placeholder={copy.otherPlaceholder}
          />
        ) : null}
        {state.fieldErrors?.heardAbout ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.heardAbout}</span>
        ) : null}
      </div>

      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.termsTitle}
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.termsIntro}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.termsLead}</p>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--foreground)]">
          {terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{copy.termsConfirmation}</p>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          {locale === "it"
            ? "Apri i documenti legali in una nuova scheda per non perdere i dati gia inseriti."
            : "Open the legal documents in a new tab so you do not lose the information you already entered."}
        </p>
        <div className="mt-5 rounded-[1.4rem] border border-[color:rgba(42,98,87,0.16)] bg-white px-5 py-4">
          <label
            htmlFor="partnerTermsAccepted"
            className="flex items-start gap-3 text-sm leading-6 text-[var(--foreground)]"
          >
            <input
              id="partnerTermsAccepted"
              type="checkbox"
              name="partnerTermsAccepted"
              checked={partnerTermsAccepted}
              onChange={(event) => setPartnerTermsAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              <LegalConsentCopy audience="partner" locale={locale} />
            </span>
          </label>
          {state.fieldErrors?.partnerTermsAccepted ? (
            <p className="mt-3 text-sm text-[var(--accent)]">
              {state.fieldErrors.partnerTermsAccepted}
            </p>
          ) : null}
        </div>
      </div>

      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}

      <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>
        {copy.cta}
      </FormSubmitButton>

      <p className="text-sm text-[var(--muted)]">
        {copy.helper}{" "}
        <HardNavigationLink
          href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}
          className="font-medium text-[var(--primary)]"
        >
          {copy.login}
        </HardNavigationLink>
      </p>
    </form>
  );
}
