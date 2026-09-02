"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  createOwnerAccountFromInvitationAction,
  requestOwnerAccessAction,
  type OwnerAccessFormState,
} from "@/app/(account)/owner-access-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: OwnerAccessFormState = {};

export function OwnerAccountActivationForm({
  email,
  locale,
  token,
}: {
  email: string;
  locale: Locale;
  token: string;
}) {
  const [state, action] = useActionState(createOwnerAccountFromInvitationAction, initialState);
  const [password, setPassword] = useState("");
  const copy = locale === "it"
    ? { confirm: "Conferma password", create: "Crea il mio account", email: "Email verificata", login: "Accedi", password: "Password", pending: "Creazione account...", terms: "Ho letto e accetto i", username: "Username", usernameHint: "Scegli uno username per il tuo accesso." }
    : { confirm: "Confirm password", create: "Create my account", email: "Verified email", login: "Log in", password: "Password", pending: "Creating account...", terms: "I have read and agree to the", username: "Username", usernameHint: "Choose a username for your account." };

  return (
    <form action={action} className="card grid gap-5 p-6 sm:p-8">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <label className="field-label">
        <span>{copy.email}</span>
        <input value={email} readOnly className="input-field bg-[var(--secondary)]" />
      </label>
      <label className="field-label">
        <span>{copy.username}</span>
        <input name="username" autoComplete="username" className="input-field" />
        <span className="text-sm text-[var(--muted)]">{copy.usernameHint}</span>
        {state.fieldErrors?.username ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.username}</span> : null}
      </label>
      <label className="field-label">
        <span>{copy.password}</span>
        <input name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input-field" />
        {state.fieldErrors?.password ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.password}</span> : null}
      </label>
      <PasswordRequirements locale={locale} password={password} />
      <label className="field-label">
        <span>{copy.confirm}</span>
        <input name="confirmPassword" type="password" autoComplete="new-password" className="input-field" />
        {state.fieldErrors?.confirmPassword ? <span className="text-sm text-[var(--accent)]">{state.fieldErrors.confirmPassword}</span> : null}
      </label>
      <label className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--secondary)] px-4 py-4 text-sm leading-6 text-[var(--foreground)]">
        <input name="businessTermsAccepted" type="checkbox" className="mt-1 h-4 w-4 accent-[var(--primary)]" />
        <span>{copy.terms} <Link href="/terms" target="_blank" className="font-medium text-[var(--primary)] underline">{locale === "it" ? "Termini e Condizioni per le Attività" : "Business Terms & Conditions"}</Link>.</span>
      </label>
      {state.fieldErrors?.businessTermsAccepted ? <p className="text-sm text-[var(--accent)]">{state.fieldErrors.businessTermsAccepted}</p> : null}
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>{copy.create}</FormSubmitButton>
      <p className="text-sm text-[var(--muted)]">
        {locale === "it" ? "Hai già un account?" : "Already have an account?"} <Link href={`/login?redirectTo=${encodeURIComponent(`/owner-access/${token}`)}`} className="font-medium text-[var(--primary)]">{copy.login}</Link>
      </p>
    </form>
  );
}

export function OwnerAccessRequestForm({ locale }: { locale: Locale }) {
  const [state, action] = useActionState(requestOwnerAccessAction, initialState);
  const copy = locale === "it"
    ? { email: "La tua email", pending: "Invio in corso...", submit: "Invia il link di accesso" }
    : { email: "Your email address", pending: "Sending...", submit: "Send access link" };
  return (
    <form action={action} className="card grid gap-4 p-6 sm:p-8">
      <input type="hidden" name="locale" value={locale} />
      <label className="field-label">
        <span>{copy.email}</span>
        <input name="email" type="email" autoComplete="email" className="input-field" required />
      </label>
      {state.notice ? <p className="rounded-xl bg-[rgba(42,98,87,0.08)] px-4 py-3 text-sm text-[var(--foreground)]">{state.notice}</p> : null}
      <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>{copy.submit}</FormSubmitButton>
    </form>
  );
}
