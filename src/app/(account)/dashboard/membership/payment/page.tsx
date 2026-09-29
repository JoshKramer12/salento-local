import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { NoEmailPaymentForm } from "@/components/account/no-email-payment-form";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { getMembershipElementSnapshot, syncMembershipElementPayment } from "@/lib/membership-element-payment";
import { getPaymentPurposeLabel } from "@/lib/membership-renewal";
import { prisma } from "@/lib/prisma";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getSingleParam } from "@/lib/site";
import { getPaymentElementPublishableKey } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function MembershipPaymentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireCompletedViewer();
  const locale = await getCurrentLocale();
  const italian = locale === "it";
  const id = getSingleParam((await searchParams).payment)?.trim();
  if (!id?.startsWith("membership-element:")) redirect("/dashboard");
  const payment = await prisma.payment.findUnique({ where: { id }, include: {
    business: { select: { name: true } }, businessSubmission: { select: { ownerEmail: true } },
  } });
  if (!payment?.businessId || !(await canManageBusiness({ businessId: payment.businessId, userId: viewer.id }))) redirect("/dashboard");
  const returnPath = `/dashboard/membership/payment?payment=${encodeURIComponent(id)}&locale=${locale}`;
  const returnUrl = `${getOriginFromHeaders(await headers())}${returnPath}`;
  let snapshot: Awaited<ReturnType<typeof getMembershipElementSnapshot>> | null = null;
  let confirmed = payment.status === "PAID";
  let purpose = payment.purpose;
  if (payment.status === "PENDING_PAYMENT") {
    try {
      snapshot = await getMembershipElementSnapshot(payment);
      if (snapshot.paid) {
        const result = await syncMembershipElementPayment(id);
        confirmed = Boolean(result);
        if (result) purpose = result.purpose;
      }
    } catch { /* Fail closed; the owner can retry server confirmation. */ }
  }
  const key = getPaymentElementPublishableKey();
  const available = payment.status === "PENDING_PAYMENT" && snapshot && key &&
    !["canceled", "processing", "succeeded"].includes(snapshot.intent.status) &&
    snapshot.subscription?.status !== "incomplete_expired" && snapshot.intent.client_secret;
  const pending = !confirmed && snapshot && ["succeeded", "processing"].includes(snapshot.intent.status);
  return <main className="shell px-4 py-8 sm:px-6 sm:py-14"><section className="card mx-auto max-w-xl overflow-hidden p-5 sm:p-8">
    <p className="section-kicker">Salento Local</p>
    <h1 className="mt-4 font-serif text-4xl leading-tight text-[var(--foreground)]">{confirmed
      ? italian ? "Pagamento confermato" : "Payment confirmed"
      : italian ? "Completa il pagamento" : "Complete your payment"}</h1>
    <p className="mt-3 text-lg text-[var(--foreground)]">{payment.business?.name}</p>
    <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4">
      <span className="text-sm">{getPaymentPurposeLabel(purpose, locale)}</span>
      <strong className="shrink-0 text-xl text-[var(--primary)]">{formatCurrencyFromCents(payment.amountCents, locale)}</strong>
    </div>
    {confirmed ? <><p role="status" className="mt-6 text-[var(--primary)]">{italian ? "La tua membership è stata aggiornata. La tua Pagina Attività è attiva." : "Your membership has been updated. Your Business Page is active."}</p><Link href={`/receipts/payment/${encodeURIComponent(id)}`} className="btn-secondary mt-5">{italian ? "Visualizza ricevuta" : "View receipt"}</Link></>
      : available && snapshot && key ? <>
        {snapshot.subscription ? <p className="mt-5 text-sm leading-6 text-[var(--muted)]">{italian ? "€100/anno. Questo pagamento rinnova la tua membership e autorizza il rinnovo automatico annuale. Puoi disattivarlo dal tuo account." : "€100/year. This payment renews your membership and authorizes automatic annual renewal. You can turn it off from your account."}</p> : null}
        <NoEmailPaymentForm amount={formatCurrencyFromCents(payment.amountCents, locale)} clientSecret={snapshot.intent.client_secret!} locale={locale} ownerEmail={payment.businessSubmission.ownerEmail.trim()} publishableKey={key} returnUrl={returnUrl}
          subscription={snapshot.subscription ? { amountCents: payment.amountCents, managementUrl: `${getOriginFromHeaders(await headers())}/dashboard` } : undefined} />
      </> : <div className="mt-6"><p role="status" className="text-sm leading-6 text-[var(--muted)]">{pending
        ? italian ? "Stiamo aspettando la conferma del pagamento. Non effettuare un altro pagamento." : "We are waiting for payment confirmation. Do not make another payment."
        : italian ? "Pagamento non disponibile. Torna alla dashboard per riprovare." : "Payment unavailable. Return to your dashboard to try again."}</p>{pending ? <Link href={returnPath} className="btn-secondary mt-4">{italian ? "Controlla stato" : "Check status"}</Link> : null}</div>}
    <Link href="/dashboard" className="btn-secondary mt-6 flex min-h-12 w-full">{italian ? "Torna alla dashboard" : "Back to dashboard"}</Link>
  </section></main>;
}
