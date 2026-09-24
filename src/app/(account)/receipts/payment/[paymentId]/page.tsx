import Link from "next/link";
import { redirect } from "next/navigation";
import { IconInfoCircle } from "@tabler/icons-react";

import { auth } from "@/lib/auth";
import { getCurrentLocale } from "@/lib/locale";
import { getReceiptData } from "@/lib/receipts";
import { getStripeHostedReceiptUrl } from "@/lib/stripe-receipts";
import { findNoEmailTokenPayment } from "@/lib/no-email-payment";

type PageProps = { params: Promise<{ paymentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined) { return typeof value === "string" ? value : null; }

export default async function PaymentReceiptPage({ params, searchParams }: PageProps) {
  const [{ paymentId: encodedPaymentId }, query, locale] = await Promise.all([params, searchParams, getCurrentLocale()]);
  const paymentId = encodedPaymentId.replace(/%3a/gi, ":");
  const checkoutSessionId = one(query.session);
  const paymentToken = one(query.payment_token);
  const tokenPayment = paymentToken ? await findNoEmailTokenPayment(paymentToken, { paid: true, paymentId }) : null;
  const viewer = checkoutSessionId || tokenPayment ? null : (await auth())?.user;
  const receipt = await getReceiptData({
    allowInternal: Boolean(checkoutSessionId || tokenPayment), checkoutSessionId, paymentId,
    viewerId: viewer?.id ?? null, viewerRole: viewer?.role ?? null,
  });
  const italian = locale === "it";
  if (!receipt) return <main className="shell px-4 py-12 sm:px-6"><section className="card mx-auto max-w-xl p-6 text-center sm:p-8"><IconInfoCircle className="mx-auto text-[var(--accent)]" size={34} /><h1 className="mt-4 font-serif text-3xl">{italian ? "Ricevuta non disponibile" : "Receipt unavailable"}</h1><p className="mt-3 leading-7 text-[var(--muted)]">{italian ? "Non hai l'accesso necessario a questa ricevuta." : "You do not have access to this receipt."}</p><Link href="/dashboard" className="btn-secondary mt-6">{italian ? "Torna alla dashboard" : "Back to dashboard"}</Link></section></main>;

  const stripeReceiptUrl = await getStripeHostedReceiptUrl(receipt.payment);
  const apiUrl = `/api/receipts/payment/${encodeURIComponent(paymentId)}?locale=${locale}${checkoutSessionId ? `&session=${encodeURIComponent(checkoutSessionId)}` : ""}${tokenPayment && paymentToken ? `&payment_token=${encodeURIComponent(paymentToken)}` : ""}`;
  redirect(stripeReceiptUrl || apiUrl);
}
