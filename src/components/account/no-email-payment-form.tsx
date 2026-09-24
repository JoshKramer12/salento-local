"use client";

import { useState } from "react";
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

function PaymentForm({ amount, locale, returnUrl }: { amount: string; locale: "en" | "it"; returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error) {
        setError(locale === "it"
          ? "Pagamento non riuscito. Controlla i dati e riprova."
          : result.error.message || "Payment failed. Check your details and try again.");
      } else {
        window.location.assign(returnUrl);
      }
    } catch {
      setError(locale === "it"
        ? "Pagamento non riuscito. Controlla i dati e riprova."
        : "Payment failed. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-6">
    <PaymentElement options={{ wallets: { link: "never" }, layout: "tabs" }} />
    {error ? <p role="alert" className="mt-4 rounded-xl bg-[rgba(191,91,42,0.09)] p-3 text-sm text-[var(--accent)]">{error}</p> : null}
    <button type="submit" disabled={!stripe || !elements || busy} className="btn-primary mt-6 flex min-h-14 w-full text-base disabled:cursor-wait disabled:opacity-60">
      {busy ? (locale === "it" ? "Elaborazione..." : "Processing...") : `${locale === "it" ? "Paga" : "Pay"} ${amount}`}
    </button>
  </form>;
}

export function NoEmailPaymentForm({ amount, clientSecret, locale, publishableKey, returnUrl }: {
  amount: string;
  clientSecret: string;
  locale: "en" | "it";
  publishableKey: string;
  returnUrl: string;
}) {
  return <Elements stripe={getStripePromise(publishableKey)} options={{
    clientSecret,
    locale,
    appearance: { theme: "stripe", variables: { colorPrimary: "#2a6257", borderRadius: "12px" } },
  }}>
    <PaymentForm amount={amount} locale={locale} returnUrl={returnUrl} />
  </Elements>;
}
