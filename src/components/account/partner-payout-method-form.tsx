"use client";

import { useActionState } from "react";

import { savePartnerPayoutMethodAction, type FormState } from "@/app/(account)/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import type { Locale } from "@/lib/i18n";

const initialState: FormState = {};

export function PartnerPayoutMethodForm({
  locale,
  method,
  returnTo,
  defaultPaypalEmail,
}: {
  defaultPaypalEmail: string;
  locale: Locale;
  method: "PAYPAL" | "POSTEPAY" | "HYPE";
  returnTo: string;
}) {
  const [state, action] = useActionState(savePartnerPayoutMethodAction, initialState);
  const italian = locale === "it";
  const isPaypal = method === "PAYPAL";
  const label = method === "POSTEPAY" ? "Postepay" : method === "HYPE" ? "HYPE" : "PayPal";

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {isPaypal ? (
        <label className="field-label">
          <span>{italian ? "Email del tuo conto PayPal" : "Your PayPal account email"}</span>
          <input className="input-field" type="email" name="paypalEmail" defaultValue={defaultPaypalEmail} required autoComplete="email" />
          <small className="text-[var(--muted)]">{italian ? "Useremo solo questa email per inviare il pagamento." : "We only use this email to send your payout."}</small>
          {state.fieldErrors?.paypalEmail ? <small className="text-[#b91c1c]">{state.fieldErrors.paypalEmail}</small> : null}
        </label>
      ) : (
        <>
          <label className="field-label">
            <span>{italian ? "Intestatario del conto" : "Account holder"}</span>
            <input className="input-field" name="accountHolder" required autoComplete="name" />
            {state.fieldErrors?.accountHolder ? <small className="text-[#b91c1c]">{state.fieldErrors.accountHolder}</small> : null}
          </label>
          <label className="field-label">
            <span>{italian ? "IBAN italiano" : "Italian IBAN"}</span>
            <input className="input-field" name="iban" inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder="IT60 X054 2811 1010 0000 0123 456" required />
            <small className="text-[var(--muted)]">{italian ? "Cifrato e mostrato solo come ultime 4 cifre." : "Encrypted and only shown as the last 4 digits."}</small>
            {state.fieldErrors?.iban ? <small className="text-[#b91c1c]">{state.fieldErrors.iban}</small> : null}
          </label>
        </>
      )}
      {state.error ? <p className="rounded-xl bg-[rgba(185,28,28,0.08)] px-4 py-3 text-sm text-[#991b1b]">{state.error}</p> : null}
      <FormSubmitButton className="btn-primary w-full sm:w-auto">{italian ? `Salva ${label}` : `Save ${label}`}</FormSubmitButton>
    </form>
  );
}
