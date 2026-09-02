"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useState } from "react";

import { partnerSignupAction, type FormState } from "@/app/(account)/auth-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { LegalConsentCopy } from "@/components/legal/legal-consent-copy";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type PartnerEntrySignupFormProps = {
  initialValues?: {
    email: string;
    firstName: string;
    lastName: string;
    partnerTermsAccepted: boolean;
    username: string;
  } | null;
  locale: Locale;
};

export function PartnerEntrySignupForm({ initialValues, locale }: PartnerEntrySignupFormProps) {
  const [state, action] = useActionState(partnerSignupAction, initialState);
  const [firstName, setFirstName] = useState(initialValues?.firstName ?? "");
  const [lastName, setLastName] = useState(initialValues?.lastName ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [username, setUsername] = useState(initialValues?.username ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(initialValues?.partnerTermsAccepted ?? false);
  const restoreSignupValues = useEffectEvent((signupValues: NonNullable<FormState["signupValues"]>) => {
    setFirstName(signupValues.firstName ?? "");
    setLastName(signupValues.lastName ?? "");
    setEmail(signupValues.email ?? "");
    setUsername(signupValues.username ?? "");
    setTermsAccepted(signupValues.partnerTermsAccepted ?? false);
    setPassword("");
    setConfirmPassword("");
  });

  useEffect(() => {
    if (!state.signupValues) return;
    startTransition(() => restoreSignupValues(state.signupValues!));
  }, [state.signupValues]);
  const copy =
    locale === "it"
      ? {
          already: "Hai gia un account?",
          confirmPassword: "Conferma password",
          create: "Avanti",
          email: "Email",
          firstName: "Nome",
          lastName: "Cognome",
          login: "Accedi",
          password: "Password",
          pending: "Continuo...",
          termsHint: "Apri i documenti in una nuova scheda per non perdere i dati inseriti.",
          username: "Username",
          usernameHint: "Scegli uno username unico da usare per accedere al tuo account.",
        }
      : {
          already: "Already have an account?",
          confirmPassword: "Confirm password",
          create: "Next",
          email: "Email",
          firstName: "First name",
          lastName: "Last name",
          login: "Log in",
          password: "Password",
          pending: "Continuing...",
          termsHint: "Open the documents in a new tab so you do not lose your details.",
          username: "Username",
          usernameHint: "Choose a unique username to use when logging in to your account.",
        };

  return (
    <div className="grid gap-5">
      <form action={action} className="card grid gap-5 p-6 sm:p-8">
        <input type="hidden" name="locale" value={locale} />
        <label className="field-label">
          <span>{copy.firstName}</span>
          <input name="firstName" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} className="input-field" />
          {state.fieldErrors?.firstName ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.firstName}</span> : null}
        </label>
        <label className="field-label">
          <span>{copy.lastName}</span>
          <input name="lastName" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} className="input-field" />
          {state.fieldErrors?.lastName ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.lastName}</span> : null}
        </label>
        <label className="field-label">
          <span>{copy.email}</span>
          <input name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input-field" />
          {state.fieldErrors?.email ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.email}</span> : null}
        </label>
        <label className="field-label">
          <span>{copy.username}</span>
          <input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="input-field" />
          <span className="text-sm text-[var(--muted)]">{copy.usernameHint}</span>
          {state.fieldErrors?.username ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.username}</span> : null}
        </label>
        <label className="field-label">
          <span>{copy.password}</span>
          <input name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input-field" />
          {state.fieldErrors?.password ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.password}</span> : null}
        </label>
        <label className="field-label">
          <span>{copy.confirmPassword}</span>
          <input name="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="input-field" />
          {state.fieldErrors?.confirmPassword ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.confirmPassword}</span> : null}
        </label>
        <PasswordRequirements locale={locale} password={password} />
        <label className="flex items-start gap-3 rounded-[1.35rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.64)] p-4 text-sm leading-6 text-[var(--foreground)]">
          <input name="partnerTermsAccepted" type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--primary)]" />
          <span><LegalConsentCopy audience="partner" locale={locale} /></span>
        </label>
        <p className="-mt-2 text-xs leading-5 text-[var(--muted)]">{copy.termsHint}</p>
        {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
        <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending} disabled={!termsAccepted}>
          {copy.create}
        </FormSubmitButton>
      </form>
      <p className="text-center text-sm text-[var(--muted)]">
        {copy.already} <HardNavigationLink href="/login?redirectTo=%2Fpartner%2Fstart" className="font-medium text-[var(--primary)] underline underline-offset-4">{copy.login}</HardNavigationLink>
      </p>
    </div>
  );
}
