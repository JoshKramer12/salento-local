"use client";

import { useActionState } from "react";

import { completeProfileAction, type FormState } from "@/app/(account)/auth-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type CompleteProfileFormProps = {
  fixedAccountType?: "GETTER";
  locale: Locale;
  redirectTo?: string;
};

export function CompleteProfileForm({
  fixedAccountType,
  locale,
  redirectTo = "",
}: CompleteProfileFormProps) {
  const [state, action] = useActionState(completeProfileAction, initialState);
  const copy =
    locale === "it"
      ? {
          businessBody: "Per aggiungere o rivendicare la tua attivita.",
          businessTitle: "Ho un'attivita",
          cta: "Salva e continua",
          hint: "Scegli uno username unico prima di pubblicare attivita o vedere il dashboard.",
          partnerBody: "Per aiutare le attivita locali a entrare nella directory.",
          partnerTitle: "Voglio diventare Partner locale",
          pending: "Salvataggio...",
          personalBody: "Per esplorare il territorio e gestire il profilo.",
          personalTitle: "Sto esplorando",
          username: "Username",
        }
      : {
          businessBody: "To add or claim your own business listing.",
          businessTitle: "I own a business",
          cta: "Save and continue",
          hint: "Choose a unique username before publishing listings or opening the dashboard.",
          partnerBody: "To help local businesses join the directory.",
          partnerTitle: "I want to become a Local Partner",
          pending: "Saving...",
          personalBody: "To explore the area and manage your profile.",
          personalTitle: "I am here to explore",
          username: "Username",
        };

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {fixedAccountType ? <input type="hidden" name="accountType" value={fixedAccountType} /> : null}
      <p className="text-sm text-[var(--muted)]">{copy.hint}</p>
      <label className="field-label">
        <span>{copy.username}</span>
        <input name="username" className="input-field" />
        {state.fieldErrors?.username ? (
          <span className="text-sm text-[var(--accent)]">{state.fieldErrors.username}</span>
        ) : null}
      </label>
      {fixedAccountType ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[color:rgba(42,98,87,0.06)] p-4">
          <p className="font-medium text-[var(--foreground)]">{copy.partnerTitle}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{copy.partnerBody}</p>
        </div>
      ) : (
      <div className="grid gap-3">
        <label className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="accountType"
              value="BUSINESS_OWNER"
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <div>
              <p className="font-medium text-[var(--foreground)]">{copy.businessTitle}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{copy.businessBody}</p>
            </div>
          </div>
        </label>
        <label className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="accountType"
              value="GETTER"
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <div>
              <p className="font-medium text-[var(--foreground)]">{copy.partnerTitle}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{copy.partnerBody}</p>
            </div>
          </div>
        </label>
        <label className="rounded-2xl border border-[var(--border)] bg-[color:rgba(247,244,239,0.45)] p-4">
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="accountType"
              value="USER"
              defaultChecked
              className="mt-1 h-4 w-4 accent-[var(--primary)]"
            />
            <div>
              <p className="font-medium text-[var(--foreground)]">{copy.personalTitle}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{copy.personalBody}</p>
            </div>
          </div>
        </label>
      </div>
      )}
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      <FormSubmitButton className="btn-primary w-full" pendingLabel={copy.pending}>
        {copy.cta}
      </FormSubmitButton>
    </form>
  );
}
