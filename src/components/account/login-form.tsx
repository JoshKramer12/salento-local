"use client";

import { useActionState } from "react";

import { loginAction, type FormState } from "@/app/(account)/auth-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import type { Locale } from "@/lib/i18n";
import { ForgotPasswordLink } from "@/components/account/password-reset-forms";

const initialState: FormState = {};

type LoginFormProps = {
  helperText?: string;
  invitedEmail?: string;
  locale: Locale;
  ownerAccessFlow?: boolean;
  redirectTo?: string;
  signupHref?: string;
  signupLabel?: string;
};

export function LoginForm({
  helperText,
  invitedEmail,
  locale,
  ownerAccessFlow = false,
  redirectTo = "",
  signupHref,
  signupLabel,
}: LoginFormProps) {
  const [state, action] = useActionState(loginAction, initialState);
  const copy =
    locale === "it"
      ? {
          cta: "Accedi",
          helper: "Non hai ancora un account?",
          identifierHint: invitedEmail ? "Usa l'email che ha ricevuto l'invito." : "Puoi usare la tua email oppure il tuo username.",
          identifier: invitedEmail ? "Email associata all'attività" : "Email o username",
          password: "Password",
          pending: "Accesso in corso...",
          signup: "Registrati",
        }
      : {
          cta: "Log in",
          helper: "Need an account?",
          identifierHint: invitedEmail ? "Use the email address that received the invitation." : "You can use either your email address or your username.",
          identifier: invitedEmail ? "Email linked to this business" : "Email or username",
          password: "Password",
          pending: "Signing you in...",
          signup: "Sign up",
        };

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label className="field-label">
          <span>{copy.identifier}</span>
          <input name="identifier" defaultValue={invitedEmail} readOnly={Boolean(invitedEmail)} autoComplete={invitedEmail ? "email" : "username"} className="input-field" />
          <span className="text-sm text-[var(--muted)]">{copy.identifierHint}</span>
          {state.fieldErrors?.identifier ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.identifier}</span>
          ) : null}
        </label>
        <div className="-mt-1"><ForgotPasswordLink locale={locale} ownerAccessFlow={ownerAccessFlow} /></div>
        <label className="field-label">
          <span>{copy.password}</span>
          <input name="password" type="password" className="input-field" />
          {state.fieldErrors?.password ? (
            <span className="text-sm text-[var(--accent)]">{state.fieldErrors.password}</span>
          ) : null}
        </label>
        {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
        <FormSubmitButton
          className="btn-primary w-full"
          pendingLabel={copy.pending}
        >
          {copy.cta}
        </FormSubmitButton>
      </form>

      <p className="text-sm text-[var(--muted)]">
        {helperText ?? copy.helper}{" "}
        <HardNavigationLink
          href={
            signupHref ??
            (redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup")
          }
          className="font-medium text-[var(--primary)]"
        >
          {signupLabel ?? copy.signup}
        </HardNavigationLink>
      </p>
    </div>
  );
}
