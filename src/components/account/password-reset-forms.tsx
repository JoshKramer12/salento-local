"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { requestPasswordResetAction, resetPasswordAction, type PasswordResetFormState } from "@/app/(account)/password-reset-actions";
import { PasswordRequirements } from "@/components/account/password-requirements";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: PasswordResetFormState = {};

export function PasswordResetRequestForm({ email = "", locale, lockedEmail = false }: { email?: string; locale: Locale; lockedEmail?: boolean }) {
  const [state, action] = useActionState(requestPasswordResetAction, initialState);
  const copy = locale === "it" ? { email: "Email", pending: "Invio in corso...", submit: "Invia link di reimpostazione" } : { email: "Email", pending: "Sending...", submit: "Send reset link" };
  return <form action={action} className="card grid gap-5 p-6 sm:p-8"><input type="hidden" name="locale" value={locale} /><label className="field-label"><span>{copy.email}</span><input className="input-field" name="email" type="email" autoComplete="email" defaultValue={email} readOnly={lockedEmail} required /></label>{state.notice ? <p className="rounded-xl bg-[rgba(42,98,87,0.08)] px-4 py-3 text-sm text-[var(--foreground)]">{state.notice}</p> : null}<FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>{copy.submit}</FormSubmitButton></form>;
}

export function PasswordResetForm({ locale, token }: { locale: Locale; token: string }) {
  const [state, action] = useActionState(resetPasswordAction, initialState);
  const [password, setPassword] = useState("");
  const copy = locale === "it" ? { confirm: "Conferma password", password: "Nuova password", pending: "Aggiornamento...", submit: "Aggiorna password" } : { confirm: "Confirm password", password: "New password", pending: "Updating...", submit: "Update password" };
  return <form action={action} className="card grid gap-5 p-6 sm:p-8"><input type="hidden" name="locale" value={locale} /><input type="hidden" name="token" value={token} /><label className="field-label"><span>{copy.password}</span><input className="input-field" name="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><PasswordRequirements locale={locale} password={password} /><label className="field-label"><span>{copy.confirm}</span><input className="input-field" name="confirmPassword" type="password" autoComplete="new-password" /></label>{state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}<FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>{copy.submit}</FormSubmitButton></form>;
}

export function ForgotPasswordLink({ locale, ownerAccessFlow = false }: { locale: Locale; ownerAccessFlow?: boolean }) {
  return <Link href={ownerAccessFlow ? "/forgot-password?ownerAccess=1" : "/forgot-password"} className="text-sm font-medium text-[var(--primary)]">{locale === "it" ? "Password dimenticata?" : "Forgot password?"}</Link>;
}
