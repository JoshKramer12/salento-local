import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { IconLock, IconShieldCheck } from "@tabler/icons-react";

import { NoEmailPaymentForm } from "@/components/account/no-email-payment-form";
import { InitialPaymentRefundPolicy } from "@/components/account/initial-payment-refund-policy";
import { formatCurrencyFromCents } from "@/lib/account";
import { getCurrentLocale } from "@/lib/locale";
import { EMAIL_MANUAL_PAYMENT_FLOW, findInitialElementTokenPayment, matchesManualElementPaymentIntent, NO_EMAIL_PAYMENT_FLOW } from "@/lib/no-email-payment";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getPaymentElementPublishableKey, getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

export default async function NoEmailPaymentPage({ params }: Props) {
  const { token } = await params;
  const locale = await getCurrentLocale();
  const payment = await findInitialElementTokenPayment(token);
  const returnPath = `/publish/payment/success?payment_token=${encodeURIComponent(token)}&locale=${locale}`;
  const returnUrl = `${getOriginFromHeaders(await headers())}${returnPath}`;
  if (!payment) return <PaymentUnavailable locale={locale} />;
  if (payment.status === "PAID") redirect(returnPath);
  if (payment.businessSubmission.paymentStatus === "PAID" || payment.businessSubmission.status === "PUBLISHED") {
    return <main className="shell px-4 py-12"><section className="card mx-auto max-w-xl p-6 text-center">
      <h1 className="font-serif text-3xl">{locale === "it" ? "Pagamento già ricevuto" : "Payment already received"}</h1>
      <p className="mt-3 text-[var(--muted)]">{locale === "it" ? "Questa adesione è già stata pagata. Non effettuare un secondo pagamento." : "This membership has already been paid. Do not make another payment."}</p>
    </section></main>;
  }
  if (payment.status !== "PENDING_PAYMENT") return <PaymentUnavailable locale={locale} />;

  let intent;
  try {
    intent = await getStripe().paymentIntents.retrieve(payment.stripePaymentIntentId!);
  } catch {
    return <PaymentUnavailable locale={locale} />;
  }
  if (payment.stripeSubscriptionId) {
    let subscription;
    try {
      subscription = await getStripe().subscriptions.retrieve(payment.stripeSubscriptionId, {
        expand: ["latest_invoice.confirmation_secret"],
      });
    } catch { return <PaymentUnavailable locale={locale} />; }
    const invoice = typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
    if (subscription.customer !== payment.stripeCustomerId || invoice?.id !== payment.stripeInvoiceId ||
      invoice?.confirmation_secret?.client_secret !== intent.client_secret ||
      intent.id !== payment.stripePaymentIntentId || intent.amount !== payment.amountCents ||
      intent.currency !== payment.currency || subscription.status === "incomplete_expired") {
      return <PaymentUnavailable locale={locale} />;
    }
  } else if (!matchesManualElementPaymentIntent(intent, payment,
    payment.businessSubmission.ownerEmail.trim() ? EMAIL_MANUAL_PAYMENT_FLOW : NO_EMAIL_PAYMENT_FLOW)) {
    return <PaymentUnavailable locale={locale} />;
  }
  if (intent.status === "succeeded" || intent.status === "processing") {
    redirect(returnPath);
  }
  if (intent.status === "canceled" || !intent.client_secret) return <PaymentUnavailable locale={locale} />;

  const publishableKey = getPaymentElementPublishableKey();
  if (!publishableKey) return <PaymentUnavailable locale={locale} />;
  const amount = formatCurrencyFromCents(payment.amountCents, locale);
  return <main className="shell px-4 py-8 sm:px-6 sm:py-14">
    <section className="card mx-auto max-w-xl overflow-hidden p-5 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--primary)]">Salento Local</p>
      <h1 className="mt-4 font-serif text-4xl leading-tight text-[var(--foreground)]">{locale === "it" ? "Completa il pagamento" : "Complete your payment"}</h1>
      <p className="mt-3 text-lg text-[var(--foreground)]">{payment.businessSubmission.businessName}</p>
      <div className="mt-6 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-2xl border border-[var(--border)] bg-white p-4">
        <span className="min-w-0 text-sm font-medium leading-5 text-[var(--foreground)]">{locale === "it" ? "Adesione annuale Salento Local" : "Salento Local annual membership"}</span>
        <strong className="shrink-0 text-xl text-[var(--primary)]">{amount}</strong>
        <span className="col-span-2 flex items-start gap-2 text-sm leading-5 text-[var(--muted)]"><IconLock aria-hidden="true" size={18} className="shrink-0 text-[var(--primary)]" />{locale === "it" ? "Pagamento sicuro direttamente a Salento Local" : "Secure payment directly to Salento Local"}</span>
      </div>
      <InitialPaymentRefundPolicy amount={amount} locale={locale} />
      <NoEmailPaymentForm amount={amount} clientSecret={intent.client_secret} locale={locale} ownerEmail={payment.businessSubmission.ownerEmail.trim()} publishableKey={publishableKey} returnUrl={returnUrl}
        subscription={payment.stripeSubscriptionId ? { amountCents: payment.amountCents, managementUrl: `${getOriginFromHeaders(await headers())}/dashboard` } : undefined} />
      <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs leading-5 text-[var(--muted)]"><IconShieldCheck size={18} />{locale === "it" ? "Pagamenti elaborati in modo sicuro da Stripe." : "Payments are securely processed by Stripe."}</p>
    </section>
  </main>;
}

function PaymentUnavailable({ locale }: { locale: "en" | "it" }) {
  return <main className="shell px-4 py-12"><section className="card mx-auto max-w-xl p-6 text-center">
    <h1 className="font-serif text-3xl">{locale === "it" ? "Pagamento non disponibile" : "Payment unavailable"}</h1>
    <p className="mt-3 text-[var(--muted)]">{locale === "it" ? "Chiedi al Local Partner un nuovo codice QR di pagamento." : "Ask your Local Partner for a new payment QR code."}</p>
  </section></main>;
}
