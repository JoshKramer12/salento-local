"use client";

import { useActionState } from "react";

import {
  resendBusinessSubmissionCodeAction,
  verifyBusinessSubmissionCodeAction,
  type FormState,
} from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type SubmissionVerifyFormProps = {
  businessName: string;
  contact: string | null;
  locale: Locale;
  mode: "code" | "manual";
  submissionId: string;
};

export function SubmissionVerifyForm({
  businessName,
  contact,
  locale,
  mode,
  submissionId,
}: SubmissionVerifyFormProps) {
  const [state, action] = useActionState(verifyBusinessSubmissionCodeAction, initialState);
  const copy =
    locale === "it"
      ? {
          body:
            "Conferma la proprieta della tua attivita con il codice ricevuto. Dopo la verifica andrai avanti verso il pagamento normale.",
          code: "Codice a 6 cifre",
          cta: "Verifica attivita",
          manual:
            "Hai scelto la revisione manuale. Il team controllera la richiesta prima di sbloccare i prossimi passaggi.",
          pending: "Verifica in corso...",
          resend: "Invia di nuovo il codice",
          sentTo: "Codice inviato a",
        }
      : {
          body:
            "Confirm ownership of your business with the code you received. After verification you will continue through the normal payment flow.",
          code: "6-digit code",
          cta: "Verify business",
          manual:
            "You chose manual review. The team will review the request before unlocking the next step.",
          pending: "Verifying...",
          resend: "Send code again",
          sentTo: "Code sent to",
        };

  return (
    <div className="grid gap-5">
      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] p-5">
        <h2 className="font-serif text-2xl text-[var(--foreground)]">{businessName}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          {mode === "manual" ? copy.manual : copy.body}
        </p>
        {mode === "code" && contact ? (
          <p className="mt-3 text-sm text-[var(--foreground)]">
            {copy.sentTo}: <span className="font-medium">{contact}</span>
          </p>
        ) : null}
      </div>

      {mode === "code" ? (
        <>
          <form action={action} className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="submissionId" value={submissionId} />
            <label className="field-label">
              <span>{copy.code}</span>
              <input
                name="code"
                inputMode="numeric"
                maxLength={6}
                className="input-field"
              />
            </label>
            {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
            <FormSubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={copy.pending}>
              {copy.cta}
            </FormSubmitButton>
          </form>

          <form action={resendBusinessSubmissionCodeAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="submissionId" value={submissionId} />
            <button type="submit" className="btn-secondary w-full sm:w-auto">
              {copy.resend}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
