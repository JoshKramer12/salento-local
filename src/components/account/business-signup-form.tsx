"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useState } from "react";

import { signupAction, type FormState } from "@/app/(account)/auth-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LegalConsentCopy } from "@/components/legal/legal-consent-copy";
import type { Locale } from "@/lib/i18n";
import { getBusinessTerms } from "@/lib/legal";

const initialState: FormState = {};
const emailValidationPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getInputClass(hasError: boolean) {
  return hasError
    ? "input-field !border-[rgba(191,91,42,0.48)] bg-[rgba(255,248,243,0.92)] ring-2 ring-[rgba(191,91,42,0.16)]"
    : "input-field";
}

type BusinessSignupFormProps = {
  locale: Locale;
  redirectTo?: string;
};

export function BusinessSignupForm({
  locale,
  redirectTo = "",
}: BusinessSignupFormProps) {
  const [state, action] = useActionState(signupAction, initialState);
  const [email, setEmail] = useState(state.signupValues?.email ?? "");
  const [username, setUsername] = useState(state.signupValues?.username ?? "");
  const [password, setPassword] = useState(state.signupValues?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState(
    state.signupValues?.confirmPassword ?? "",
  );
  const [businessTermsAccepted, setBusinessTermsAccepted] = useState(
    state.signupValues?.businessTermsAccepted ?? false,
  );
  const restoreSignupValues = useEffectEvent((signupValues: NonNullable<FormState["signupValues"]>) => {
    setEmail(signupValues.email ?? "");
    setUsername(signupValues.username ?? "");
    setPassword(signupValues.password ?? "");
    setConfirmPassword(signupValues.confirmPassword ?? "");
    setBusinessTermsAccepted(signupValues.businessTermsAccepted ?? false);
  });

  useEffect(() => {
    if (!state.signupValues) {
      return;
    }

    startTransition(() => {
      restoreSignupValues(state.signupValues!);
    });
  }, [state.signupValues]);

  const copy =
    locale === "it"
      ? {
          businessLegal:
            "Creando un account, riconosci che questo costituisce un accordo legalmente vincolante tra te o la tua attivita e Salento Local.",
          cta: "Crea account business",
          email: "Email",
          helper: "Hai gia un account?",
          login: "Accedi",
          password: "Password",
          pending: "Creazione account...",
          legalHelp:
            "Apri i documenti legali in una nuova scheda per non perdere i dati gia inseriti.",
          reviewTerms:
            "Prima di creare l'account, leggi i termini qui sotto e seleziona la casella di accettazione.",
          reviewTermsTitle: "Passo obbligatorio",
          stepOne: "Passo 1",
          stepOneBody:
            "Crea il tuo account business con email, username e password. Userai questo accesso per gestire schede, aggiornamenti e pagamenti.",
          stepTwo: "Passo 2",
          stepTwoBody:
            "Rivedi i termini per le attivita commerciali prima di continuare. Il flusso di pagamento della scheda resta separato e avviene piu avanti.",
          submitLocked: "Il pulsante si attiva solo dopo l'accettazione dei termini.",
          termsConfirmation:
            "Selezionando la casella qui sotto, confermi di aver letto, compreso e accettato i presenti Termini e Condizioni. Creando un account, riconosci che questo costituisce un accordo legalmente vincolante tra te o la tua attivita e Salento Local.",
          termsIntro:
            "Prima di creare un Account Business o rivendicare una scheda attivita, leggi attentamente quanto segue:",
          termsLead:
            "Creando un Account Business o rivendicando una scheda attivita su Salento Local, accetti quanto segue:",
          termsTitle: "Termini e Condizioni per le Attivita Commerciali di Salento Local",
          username: "Username",
          usernameHint:
            "Scegli uno username unico. Potrai accedere in seguito sia con username e password sia con email e password.",
          confirmPassword: "Conferma password",
        }
      : {
          businessLegal:
            "By creating an account, you acknowledge that this is a legally binding agreement between you or your business and Salento Local.",
          cta: "Create business account",
          email: "Email",
          helper: "Already have an account?",
          login: "Log in",
          password: "Password",
          pending: "Creating account...",
          legalHelp:
            "Open the legal documents in a new tab so you do not lose the information you already entered.",
          reviewTerms:
            "Before creating your account, read the terms below and tick the acceptance box.",
          reviewTermsTitle: "Required step",
          stepOne: "Step 1",
          stepOneBody:
            "Create your business account with email, username, and password. You will use this login to manage listings, updates, and payments.",
          stepTwo: "Step 2",
          stepTwoBody:
            "Review the business terms before continuing. The listing payment flow stays separate and happens later in the normal process.",
          submitLocked: "The button unlocks only after you accept the terms.",
          termsConfirmation:
            "By checking the box below, you confirm that you have read, understood, and agree to these Terms & Conditions. By creating an account, you acknowledge that this is a legally binding agreement between you or your business and Salento Local.",
          termsIntro:
            "Before creating a Business Account or claiming a business listing, please read the following:",
          termsLead:
            "By creating a Business Account or claiming a business listing on Salento Local, you agree to the following:",
          termsTitle: "Salento Local Business Terms & Conditions",
          username: "Username",
          usernameHint:
            "Choose a unique username. Later you can log in with either your username and password or your email and password.",
          confirmPassword: "Confirm password",
        };

  const businessTerms = getBusinessTerms(locale);
  const liveEmailError =
    email.trim() && !emailValidationPattern.test(email.trim().toLowerCase())
      ? locale === "it"
        ? "Inserisci un indirizzo email valido."
        : "Please enter a valid email address."
      : "";
  const emailErrorMessage = state.fieldErrors?.email || liveEmailError;
  const hasEmailError = Boolean(emailErrorMessage);

  return (
    <form action={action} className="card mx-auto grid w-full max-w-4xl gap-6 p-8 sm:p-10">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="accountType" value="BUSINESS_OWNER" />
      <input type="hidden" name="redirectTo" value={redirectTo} />

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
          <span>{copy.confirmPassword}</span>
          <input
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="input-field"
          />
          {state.fieldErrors?.confirmPassword ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.confirmPassword}</span>
          ) : null}
        </label>
      </div>

      <PasswordRequirements locale={locale} password={password} />

      <div className="rounded-[1.5rem] border border-[color:rgba(191,91,42,0.18)] bg-[linear-gradient(135deg,rgba(255,248,243,0.96),rgba(255,255,255,0.96))] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.reviewTermsTitle}
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">{copy.reviewTerms}</p>
      </div>

      <div className="rounded-[1.4rem] border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.05)] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.stepTwo}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">{copy.stepTwoBody}</p>
      </div>

      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {copy.termsTitle}
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.termsIntro}</p>
        <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{copy.termsLead}</p>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-[var(--foreground)]">
          {businessTerms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{copy.termsConfirmation}</p>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{copy.legalHelp}</p>
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{copy.submitLocked}</p>
        <div className="mt-5 rounded-[1.4rem] border border-[color:rgba(42,98,87,0.16)] bg-white px-5 py-4">
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
