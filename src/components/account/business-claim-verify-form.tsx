"use client";

import { useActionState } from "react";

import {
  resendBusinessClaimCodeAction,
  verifyBusinessClaimCodeAction,
  type FormState,
} from "@/app/(account)/actions";
import type { ClaimVerificationMethod } from "@/lib/business-claim-verification";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

type BusinessClaimVerifyFormProps = {
  businessName: string;
  channel: ClaimVerificationMethod;
  claimId: string;
  contact: string | null;
  locale: Locale;
};

export function BusinessClaimVerifyForm({
  businessName,
  channel,
  claimId,
  contact,
  locale,
}: BusinessClaimVerifyFormProps) {
  const [verifyState, verifyAction] = useActionState(verifyBusinessClaimCodeAction, initialState);
  const [resendState, resendAction] = useActionState(resendBusinessClaimCodeAction, initialState);
  const copy =
    locale === "it"
      ? {
          body:
            channel === "EMAIL"
              ? "Abbiamo inviato un codice di 6 cifre all'email personale registrata per il proprietario o manager di questa scheda. Inseriscilo qui per collegarla al tuo account."
              : "Abbiamo inviato un codice di 6 cifre al numero personale registrato per il proprietario o manager di questa scheda. Inseriscilo qui per collegarla al tuo account.",
          code: "Codice a 6 cifre",
          cta: "Conferma codice",
          pending: "Verifica in corso...",
          resend: "Invia di nuovo il codice",
          resendPending: "Invio nuovo codice...",
          sentTo: channel === "EMAIL" ? "Codice inviato a" : "SMS inviato a",
        }
      : {
          body:
            channel === "EMAIL"
              ? "We sent a 6-digit code to the personal email registered for the owner or manager of this listing. Enter it here to connect the listing to your account."
              : "We sent a 6-digit code by SMS to the personal phone number registered for the owner or manager of this listing. Enter it here to connect the listing to your account.",
          code: "6-digit code",
          cta: "Confirm code",
          pending: "Verifying...",
          resend: "Send code again",
          resendPending: "Sending new code...",
          sentTo: channel === "EMAIL" ? "Code sent to" : "SMS sent to",
        };

  return (
    <div className="grid gap-5">
      <div className="rounded-[1.75rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] p-5">
        <h2 className="font-serif text-2xl text-[var(--foreground)]">{businessName}</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{copy.body}</p>
        {contact ? (
          <p className="mt-3 text-sm text-[var(--foreground)]">
            {copy.sentTo}: <span className="font-medium">{contact}</span>
          </p>
        ) : null}
      </div>

      <form action={verifyAction} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="claimId" value={claimId} />
        <label className="field-label">
          <span>{copy.code}</span>
          <input name="code" inputMode="numeric" maxLength={6} className="input-field" />
        </label>
        {verifyState.error ? <p className="text-sm text-[var(--accent)]">{verifyState.error}</p> : null}
        {resendState.notice ? (
          <p className="text-sm text-[var(--primary)]">{resendState.notice}</p>
        ) : null}
        {resendState.error ? <p className="text-sm text-[var(--accent)]">{resendState.error}</p> : null}
        <FormSubmitButton className="btn-primary w-full sm:w-auto" pendingLabel={copy.pending}>
          {copy.cta}
        </FormSubmitButton>
      </form>

      <form action={resendAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="claimId" value={claimId} />
        <FormSubmitButton className="btn-secondary w-full sm:w-auto" pendingLabel={copy.resendPending}>
          {copy.resend}
        </FormSubmitButton>
      </form>
    </div>
  );
}
