"use client";

import { useActionState } from "react";

import {
  completeBusinessClaimEmailChoiceAction,
  type FormState,
} from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

export function BusinessClaimEmailChoiceForm({
  accountEmail,
  businessEmail,
  claimId,
  locale,
}: {
  accountEmail: string;
  businessEmail: string;
  claimId: string;
  locale: Locale;
}) {
  const [state, action] = useActionState(completeBusinessClaimEmailChoiceAction, initialState);
  const copy = locale === "it"
    ? {
        account: "Usa l'email del mio account",
        body: "Scegli l'indirizzo che Salento Local userà sia per il tuo account attività sia per questa attività.",
        business: "Usa l'email dell'attività appena verificata",
        pending: "Salvataggio...",
        title: "Quale email vuoi usare?",
      }
    : {
        account: "Use my current account email",
        body: "Choose the address Salento Local should use for both your Business Owner account and this business.",
        business: "Use the business email I just verified",
        pending: "Saving...",
        title: "Which email would you like to use?",
      };

  return (
    <form action={action} className="grid gap-5">
      <input name="claimId" type="hidden" value={claimId} />
      <input name="locale" type="hidden" value={locale} />
      <div><p className="section-kicker mb-3">{locale === "it" ? "Email attività" : "Business email"}</p><h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1><p className="mt-4 leading-7 text-[var(--muted)]">{copy.body}</p></div>
      <label className="flex cursor-pointer items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--primary)]">
        <input className="mt-1 h-4 w-4 accent-[var(--primary)]" defaultChecked name="emailChoice" type="radio" value="ACCOUNT" />
        <span className="min-w-0"><span className="block font-medium text-[var(--foreground)]">{accountEmail}</span><span className="mt-1 block text-sm text-[var(--muted)]">{copy.account}</span></span>
      </label>
      <label className="flex cursor-pointer items-start gap-4 rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--primary)]">
        <input className="mt-1 h-4 w-4 accent-[var(--primary)]" name="emailChoice" type="radio" value="BUSINESS" />
        <span className="min-w-0"><span className="block break-all font-medium text-[var(--foreground)]">{businessEmail}</span><span className="mt-1 block text-sm text-[var(--muted)]">{copy.business}</span></span>
      </label>
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      <FormSubmitButton className="btn-primary min-h-12 w-full sm:w-auto" pendingLabel={copy.pending}>{locale === "it" ? "Continua" : "Continue"}</FormSubmitButton>
    </form>
  );
}
