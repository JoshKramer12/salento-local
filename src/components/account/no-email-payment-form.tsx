"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePromises = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(key: string) {
  let promise = stripePromises.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripePromises.set(key, promise);
  }
  return promise;
}

function PaymentForm({ amount, locale, ownerEmail, returnUrl }: { amount: string; locale: "en" | "it"; ownerEmail: string; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [slow, setSlow] = useState(false);
  const [verySlow, setVerySlow] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!busy) return;
    const slowTimer = window.setTimeout(() => setSlow(true), 20_000);
    const verySlowTimer = window.setTimeout(() => setVerySlow(true), 120_000);
    return () => { window.clearTimeout(slowTimer); window.clearTimeout(verySlowTimer); };
  }, [busy]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setSlow(false);
    setVerySlow(false);
    setError("");
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl,
          ...(ownerEmail ? { payment_method_data: { billing_details: { email: ownerEmail } } } : {}),
        },
        redirect: "if_required",
      });
      if (result.error) {
        setError(locale === "it"
          ? "Pagamento non riuscito. Controlla i dati e riprova."
          : result.error.message || "Payment failed. Check your details and try again.");
        submitting.current = false;
        setBusy(false);
      } else {
        window.location.assign(returnUrl);
      }
    } catch {
      setError(locale === "it"
        ? "Pagamento non riuscito. Controlla i dati e riprova."
        : "Payment failed. Check your details and try again.");
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-6">
    <PaymentElement options={{ wallets: { link: "never" }, layout: "tabs",
      ...(ownerEmail ? { fields: { billingDetails: { email: "never" as const } } } : {}),
    }} />
    {busy ? <div role="status" className="mt-6 rounded-2xl bg-[rgba(42,98,87,0.07)] px-5 py-6 text-center text-[var(--foreground)]">
      <span aria-hidden="true" className="mx-auto block h-9 w-9 animate-spin rounded-full border-[3px] border-[rgba(42,98,87,0.2)] border-t-[var(--primary)] motion-reduce:animate-none" />
      <h2 className="mt-4 font-serif text-2xl">{locale === "it" ? "Pagamento in elaborazione" : "Processing your payment"}</h2>
      <p className="mt-2 text-sm leading-6">{slow
        ? locale === "it" ? "La conferma del pagamento sta richiedendo un po' più di tempo. Tieni aperta questa pagina." : "Your payment is taking a little longer to confirm. Please keep this page open."
        : locale === "it" ? "Attendi mentre confermiamo il pagamento. Non chiudere questa pagina." : "Please wait while we confirm your payment. Do not close this page."}</p>
      {verySlow ? <a href={returnUrl} className="btn-secondary mt-4 inline-flex">{locale === "it" ? "Controlla lo stato del pagamento" : "Check payment status"}</a> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-4 rounded-xl bg-[rgba(191,91,42,0.09)] p-3 text-sm text-[var(--accent)]">{error}</p> : null}
    <button type="submit" disabled={!stripe || !elements || busy} className="btn-primary mt-6 flex min-h-14 w-full text-base disabled:cursor-wait disabled:opacity-60">
      {busy ? (locale === "it" ? "Elaborazione..." : "Processing...") : `${locale === "it" ? "Paga" : "Pay"} ${amount}`}
    </button>
  </form>;
}

export function NoEmailPaymentForm({ amount, clientSecret, locale, ownerEmail = "", publishableKey, returnUrl }: {
  amount: string;
  clientSecret: string;
  locale: "en" | "it";
  ownerEmail?: string;
  publishableKey: string;
  returnUrl: string;
}) {
  return <Elements stripe={getStripePromise(publishableKey)} options={{
    clientSecret,
    locale,
    appearance: { theme: "stripe", variables: { colorPrimary: "#2a6257", borderRadius: "12px" } },
  }}>
    <PaymentForm amount={amount} locale={locale} ownerEmail={ownerEmail} returnUrl={returnUrl} />
  </Elements>;
}
