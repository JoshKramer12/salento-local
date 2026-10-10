"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";

type SubscriptionPayment = { amountCents: number; managementUrl: string };

const stripePromises = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(key: string) {
  let promise = stripePromises.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripePromises.set(key, promise);
  }
  return promise;
}

export function PaymentForm({ amount, clientSecret, locale, ownerEmail, returnUrl, subscription }: { amount: string; clientSecret: string; locale: "en" | "it"; ownerEmail: string; returnUrl: string; subscription?: SubscriptionPayment }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const walletOpen = useRef(false);
  const [walletPending, setWalletPending] = useState(false);
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [slow, setSlow] = useState(false);
  const [verySlow, setVerySlow] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!busy) return;
    const slowTimer = window.setTimeout(() => setSlow(true), 20_000);
    const verySlowTimer = window.setTimeout(() => setVerySlow(true), 120_000);
    return () => { window.clearTimeout(slowTimer); window.clearTimeout(verySlowTimer); };
  }, [busy]);

  function releasePayment() {
    submitting.current = false;
    walletOpen.current = false;
    setBusy(false);
    setWalletPending(false);
  }

  async function confirm(walletEvent?: StripeExpressCheckoutElementConfirmEvent) {
    if (submitting.current) return;
    if (!stripe || !elements) {
      walletEvent?.paymentFailed();
      releasePayment();
      return;
    }
    const readyStripe = stripe;
    submitting.current = true;
    setBusy(true);
    setSlow(false);
    setVerySlow(false);
    setError("");
    const fail = (message?: string) => {
      const localized = locale === "it"
        ? "Pagamento non riuscito. Controlla i dati e riprova."
        : message || "Payment failed. Check your details and try again.";
      setError(localized);
      releasePayment();
      walletEvent?.paymentFailed({ reason: "fail", message: localized });
    };
    async function paymentMayHaveCompleted() {
      try {
        const { paymentIntent } = await readyStripe.retrievePaymentIntent(clientSecret);
        if (paymentIntent && !["succeeded", "processing"].includes(paymentIntent.status)) return false;
      } catch {
        // A lost confirmation response can also prevent Stripe.js from reading
        // the intent. Let the server verify payment before offering a retry.
      }
      window.location.assign(returnUrl);
      return true;
    }
    try {
      // Submit from Express Checkout's confirm event so Stripe collects the
      // wallet details, rather than requiring entry in the card Element.
      if (walletEvent) {
        const submitted = await elements.submit();
        if (submitted.error) { fail(submitted.error.message); return; }
      }
      const result = await readyStripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl,
          ...(ownerEmail ? { payment_method_data: { billing_details: { email: ownerEmail } } } : {}),
        },
        redirect: "if_required",
      });
      if (result.error) {
        if (await paymentMayHaveCompleted()) return;
        fail(result.error.message);
      } else {
        window.location.assign(returnUrl);
      }
    } catch {
      if (await paymentMayHaveCompleted()) return;
      fail();
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (walletOpen.current) return;
    void confirm();
  }

  return <form onSubmit={submit} className="mt-6">
    <div hidden={!walletAvailable} data-payment-wallets>
      <ExpressCheckoutElement options={{
        paymentMethods: { applePay: "auto", googlePay: "auto", link: "never", paypal: "never", amazonPay: "never", klarna: "never" },
        buttonHeight: 48,
        layout: { maxColumns: 1, maxRows: 0, overflow: "never" },
        billingAddressRequired: false,
        emailRequired: false,
        phoneNumberRequired: false,
        shippingAddressRequired: false,
        ...(subscription ? {
          buttonType: { applePay: "subscribe" as const, googlePay: "subscribe" as const },
          applePay: { recurringPaymentRequest: {
            paymentDescription: locale === "it" ? "Adesione annuale Salento Local" : "Salento Local annual membership",
            managementURL: subscription.managementUrl,
            regularBilling: {
              amount: subscription.amountCents,
              label: locale === "it" ? "Adesione annuale Salento Local" : "Salento Local annual membership",
              recurringPaymentIntervalUnit: "year" as const,
              recurringPaymentIntervalCount: 1,
            },
          } },
        } : {}),
      }}
        onReady={({ availablePaymentMethods }) => setWalletAvailable(Boolean(availablePaymentMethods?.applePay || availablePaymentMethods?.googlePay))}
        onAvailablePaymentMethodsChange={({ paymentMethods }) => setWalletAvailable(Boolean(paymentMethods?.applePay?.available || paymentMethods?.googlePay?.available))}
        onLoadError={() => setWalletAvailable(false)}
        onClick={(event) => {
          if (!stripe || !elements || submitting.current || walletOpen.current) { event.reject(); return; }
          walletOpen.current = true;
          setWalletPending(true);
          setError("");
          event.resolve();
        }}
        onCancel={() => {
          // Closing the sheet cannot unlock a confirmation already in flight.
          if (!submitting.current) releasePayment();
        }}
        onConfirm={confirm}
      />
      <div className="my-5 flex items-center gap-3 text-sm text-[var(--muted)]">
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
        <span>{locale === "it" ? "oppure paga con carta" : "or pay by card"}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
      </div>
    </div>
    <PaymentElement options={{ wallets: { applePay: "never", googlePay: "never", link: "never" }, layout: "tabs",
      defaultValues: { billingDetails: { address: { country: "IT" } } },
      ...(ownerEmail ? { fields: { billingDetails: { email: "never" as const } } } : {}),
    }} />
    {busy ? <div role="status" className="mt-6 rounded-2xl bg-[rgba(42,98,87,0.07)] px-5 py-6 text-center text-[var(--foreground)]">
      <span aria-hidden="true" className="payment-processing-spinner mx-auto block h-9 w-9 rounded-full border-[3px] border-[rgba(42,98,87,0.2)] border-t-[var(--primary)]" />
      <h2 className="mt-4 font-serif text-2xl">{locale === "it" ? "Pagamento in elaborazione" : "Processing your payment"}</h2>
      <p className="mt-2 text-sm leading-6">{slow
        ? locale === "it" ? "La conferma del pagamento sta richiedendo un po' più di tempo. Tieni aperta questa pagina." : "Your payment is taking a little longer to confirm. Please keep this page open."
        : locale === "it" ? "Attendi mentre confermiamo il pagamento. Non chiudere questa pagina." : "Please wait while we confirm your payment. Do not close this page."}</p>
      {verySlow ? <a href={returnUrl} className="btn-secondary mt-4 inline-flex">{locale === "it" ? "Controlla lo stato del pagamento" : "Check payment status"}</a> : null}
    </div> : null}
    {error ? <p role="alert" className="mt-4 rounded-xl bg-[rgba(191,91,42,0.09)] p-3 text-sm text-[var(--accent)]">{error}</p> : null}
    <button type="submit" disabled={!stripe || !elements || busy || walletPending} className="btn-primary mt-6 flex min-h-14 w-full text-base disabled:cursor-wait disabled:opacity-60">
      {busy ? (locale === "it" ? "Elaborazione..." : "Processing...") : `${locale === "it" ? "Paga" : "Pay"} ${amount}`}
    </button>
  </form>;
}

export function NoEmailPaymentForm({ amount, clientSecret, locale, ownerEmail = "", publishableKey, returnUrl, subscription }: {
  amount: string;
  clientSecret: string;
  locale: "en" | "it";
  ownerEmail?: string;
  publishableKey: string;
  returnUrl: string;
  subscription?: SubscriptionPayment;
}) {
  return <Elements stripe={getStripePromise(publishableKey)} options={{
    clientSecret,
    locale,
    appearance: { theme: "stripe", variables: { colorPrimary: "#2a6257", borderRadius: "12px" } },
  }}>
    <PaymentForm amount={amount} clientSecret={clientSecret} locale={locale} ownerEmail={ownerEmail} returnUrl={returnUrl} subscription={subscription} />
  </Elements>;
}
