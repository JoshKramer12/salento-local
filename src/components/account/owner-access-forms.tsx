"use client";

import { useActionState } from "react";

import {
  requestOwnerAccessAction,
  type OwnerAccessFormState,
} from "@/app/(account)/owner-access-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: OwnerAccessFormState = {};

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
