"use client";

import { useActionState, useRef, useState } from "react";

import {
  resendBusinessClaimCodeAction,
  verifyBusinessClaimCodeAction,
  type FormState,
} from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};
const codeLength = 6;

type BusinessClaimVerifyFormProps = {
  businessName: string;
  claimId: string;
  contact: string | null;
  locale: Locale;
};

export function BusinessClaimVerifyForm({
  businessName,
  claimId,
  contact,
  locale,
}: BusinessClaimVerifyFormProps) {
  const [verifyState, verifyAction] = useActionState(verifyBusinessClaimCodeAction, initialState);
  const [resendState, resendAction] = useActionState(resendBusinessClaimCodeAction, initialState);
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length: codeLength }, () => ""));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const copy =
    locale === "it"
      ? {
          body: "Abbiamo inviato un codice di 6 cifre all'email registrata per questa attività. Inseriscilo qui per collegarla al tuo account.",
          code: "Codice a 6 cifre",
          cta: "Conferma codice",
          pending: "Verifica in corso...",
          resend: "Invia di nuovo il codice",
          resendPending: "Invio nuovo codice...",
          sentTo: "Codice inviato a",
        }
      : {
          body: "We sent a 6-digit code to the email registered for this business. Enter it here to connect the listing to your account.",
          code: "6-digit code",
          cta: "Confirm code",
          pending: "Verifying...",
          resend: "Send code again",
          resendPending: "Sending new code...",
          sentTo: "Code sent to",
        };

  function applyDigits(index: number, value: string) {
    const incoming = value.replace(/\D/g, "").slice(0, codeLength - index);

    setDigits((current) => {
      const next = [...current];

      if (!incoming) {
        next[index] = "";
        return next;
      }

      incoming.split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });

      return next;
    });

    const nextIndex = Math.min(index + Math.max(incoming.length, 1), codeLength - 1);
    requestAnimationFrame(() => inputRefs.current[nextIndex]?.focus());
  }

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
          <input name="code" type="hidden" value={digits.join("")} />
          <span className="verification-code-grid" role="group" aria-label={copy.code}>
            {digits.map((digit, index) => (
              <input
                aria-label={`${copy.code} ${index + 1}`}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                className="input-field verification-code-input"
                inputMode="numeric"
                key={index}
                maxLength={codeLength}
                onChange={(event) => applyDigits(index, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !digits[index] && index > 0) {
                    requestAnimationFrame(() => inputRefs.current[index - 1]?.focus());
                  }
                  if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
                  if (event.key === "ArrowRight" && index < codeLength - 1) inputRefs.current[index + 1]?.focus();
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  applyDigits(index, event.clipboardData.getData("text"));
                }}
                pattern="[0-9]*"
                ref={(element) => { inputRefs.current[index] = element; }}
                type="text"
                value={digit}
              />
            ))}
          </span>
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
