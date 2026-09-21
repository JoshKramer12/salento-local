import Link from "next/link";
import { IconFileDescription, IconInfoCircle } from "@tabler/icons-react";

import { DocumentActions } from "@/components/account/document-actions";
import { auth } from "@/lib/auth";
import { getCurrentLocale } from "@/lib/locale";
import { buildPaymentReceiptPageUrl, getReceiptData } from "@/lib/receipts";
import { getStripeHostedReceiptUrl } from "@/lib/stripe-receipts";

type PageProps = { params: Promise<{ paymentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined) { return typeof value === "string" ? value : null; }

export default async function PaymentReceiptPage({ params, searchParams }: PageProps) {
  const [{ paymentId }, query, locale] = await Promise.all([params, searchParams, getCurrentLocale()]);
  const checkoutSessionId = one(query.session);
  const viewer = checkoutSessionId ? null : (await auth())?.user;
  const receipt = await getReceiptData({
    allowInternal: Boolean(checkoutSessionId), checkoutSessionId, paymentId,
    viewerId: viewer?.id ?? null, viewerRole: viewer?.role ?? null,
  });
  const italian = locale === "it";
  if (!receipt) return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-xl p-6 text-center sm:p-8"><IconInfoCircle className="mx-auto text-[var(--accent)]" size={34} /><h1 className="mt-4 font-serif text-3xl">{italian ? "Ricevuta non disponibile" : "Receipt unavailable"}</h1><p className="mt-3 leading-7 text-[var(--muted)]">{italian ? "Non hai l'accesso necessario a questa ricevuta." : "You do not have access to this receipt."}</p><Link href="/dashboard" className="btn-secondary mt-6">{italian ? "Torna alla dashboard" : "Back to dashboard"}</Link></section></main>;

  const stripeReceiptUrl = await getStripeHostedReceiptUrl(receipt.payment);
  const apiUrl = `/api/receipts/payment/${encodeURIComponent(paymentId)}${checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}&locale=${locale}` : `?locale=${locale}`}`;
  const downloadUrl = `${apiUrl}${checkoutSessionId ? "&" : "?"}download=1`;
  const viewUrl = stripeReceiptUrl || apiUrl;
  return <main className="shell px-4 py-10 sm:px-6"><section className="card mx-auto max-w-xl p-6 sm:p-8"><IconFileDescription className="text-[var(--primary)]" size={34} /><p className="section-kicker mt-5">{italian ? "DOCUMENTI" : "DOCUMENTS"}</p><h1 className="mt-2 font-serif text-3xl text-[var(--foreground)]">{italian ? "Ricevuta di pagamento" : "Payment Receipt"}</h1><p className="mt-3 leading-7 text-[var(--muted)]">{italian ? "Prova finanziaria di questa esatta transazione." : "Financial proof for this exact transaction."}</p>{stripeReceiptUrl ? <p className="mt-3 text-sm text-[var(--muted)]">{italian ? "È disponibile il documento finanziario ospitato da Stripe." : "A Stripe-hosted financial document is available."}</p> : null}<div className="mt-6"><DocumentActions downloadUrl={downloadUrl} locale={locale} shareUrl={buildPaymentReceiptPageUrl(paymentId)} title={italian ? "Ricevuta di pagamento Salento Local" : "Salento Local Payment Receipt"} viewUrl={viewUrl} /></div></section></main>;
}
