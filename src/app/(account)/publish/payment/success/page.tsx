import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  IconCalendarEvent,
  IconCheck,
  IconCircleCheck,
  IconEye,
  IconFileDescription,
  IconInfoCircle,
  IconReceipt2,
  IconRocket,
  IconWallet,
} from "@tabler/icons-react";

import { DocumentActions } from "@/components/account/document-actions";
import { formatCurrencyFromCents } from "@/lib/account";
import { getViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { buildAgreementPageUrl, buildPaymentReceiptPageUrl, getReceiptData, getSignedAgreementData } from "@/lib/receipts";
import { getOriginFromHeaders } from "@/lib/request-origin";
import {
  syncStripePaymentForSubmission,
  syncStripePaymentFromReceiptAccess,
} from "@/lib/stripe-payment-sync";
import { getSingleParam } from "@/lib/site";

type PublishPaymentSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SummaryRow({
  children,
  icon,
  label,
  last = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  last?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[2.6rem_1fr_auto] items-center gap-3 px-4 py-4 sm:px-5 ${last ? "" : "border-b border-[var(--border)]"}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(42,98,87,0.08)] text-[var(--primary)]">{icon}</span>
      <span className="text-sm text-[var(--foreground)] sm:text-base">{label}</span>
      <span className="max-w-40 text-right text-sm font-semibold text-[var(--foreground)] sm:max-w-none sm:text-base">{children}</span>
    </div>
  );
}

export default async function PublishPaymentSuccessPage({
  searchParams,
}: PublishPaymentSuccessPageProps) {
  const requestHeaders = await headers();
  const viewer = await getViewer();
  const resolvedSearchParams = await searchParams;
  const submissionId = getSingleParam(resolvedSearchParams.submission);
  const checkoutSessionId = getSingleParam(resolvedSearchParams.session);
  const ownerCheckoutLocale = getSingleParam(resolvedSearchParams.locale);
  const locale = checkoutSessionId
    ? ownerCheckoutLocale === "en"
      ? "en"
      : "it"
    : await getCurrentLocale();

  if (!submissionId) {
    redirect("/");
  }

  let verificationUnavailable = false;
  let syncResult = null;

  try {
    syncResult = checkoutSessionId
      ? await syncStripePaymentFromReceiptAccess({
          checkoutSessionId,
          revalidatePaths: false,
          submissionId,
        })
      : viewer
        ? await syncStripePaymentForSubmission({
            revalidatePaths: false,
            submissionId,
            userId: viewer.id,
          })
        : null;
  } catch {
    verificationUnavailable = true;
  }
  const paymentReceived = syncResult?.paymentReceived ?? false;
  const [receipt, agreement, submission] = paymentReceived
    ? await Promise.all([
        getReceiptData({
          allowInternal: Boolean(checkoutSessionId),
          appUrl: getOriginFromHeaders(requestHeaders),
          checkoutSessionId,
          submissionId,
          viewerId: viewer?.id ?? null,
        }),
        getSignedAgreementData({
          allowInternal: Boolean(checkoutSessionId),
          checkoutSessionId,
          submissionId,
          viewerId: viewer?.id ?? null,
          viewerRole: viewer?.role ?? null,
        }),
        prisma.businessSubmission.findUnique({
          where: { id: submissionId },
          select: {
            createdBusiness: {
              select: { slug: true },
            },
            paymentStatus: true,
            status: true,
          },
        }),
      ])
    : [null, null, null];

  const paymentConfirmed = paymentReceived && receipt && submission?.paymentStatus === "PAID";
  const businessListingHref =
    submission?.status === "PUBLISHED" && submission.createdBusiness?.slug
      ? `/businesses/${encodeURIComponent(submission.createdBusiness.slug)}`
      : null;
  const listingIsLive = Boolean(businessListingHref);

  const copy = locale === "it"
    ? {
        amount: "Importo pagato",
        backHome: "Torna a Salento Local",
        date: "Data pagamento",
        download: "Scarica ricevuta",
        listingPreparing: "La tua scheda è in preparazione per la pubblicazione. Ti avviseremo quando sarà online.",
        listingPreparingTitle: "Stiamo preparando la tua scheda",
        liveBody: "La tua scheda è stata pubblicata ed è ora visibile su Salento Local. I clienti possono trovarti e contattarti.",
        liveTitle: "La tua attività è online!",
        open: "Apri ricevuta PDF",
        pendingBody: "Stripe sta ancora confermando il pagamento. Aggiorna tra qualche istante per visualizzare la ricevuta.",
        pendingTitle: "Stiamo confermando il pagamento",
        retry: "Riprova la verifica",
        verificationUnavailable: "Non riusciamo a verificare Stripe in questo momento. Riprova tra qualche istante: non verranno effettuati altri addebiti.",
        receiptBody: "Puoi aprire o scaricare la ricevuta in PDF per i tuoi archivi.",
        receiptSent: "Ricevuta inviata a",
        receiptTitle: "La tua ricevuta è pronta",
        status: "Stato pagamento",
        statusConfirmed: "Confermato",
        successIntro: "Grazie! Il tuo pagamento è stato ricevuto e la tua scheda",
        successLive: "è ora online.",
        successTitle: "Pagamento riuscito!",
        summaryTitle: "Riepilogo pagamento",
        viewListing: "Vedi la mia scheda",
      }
    : {
        amount: "Amount paid",
        backHome: "Back to Salento Local",
        date: "Payment date",
        download: "Download receipt",
        listingPreparing: "Your listing is being prepared for publication. We’ll let you know when it is live.",
        listingPreparingTitle: "We’re preparing your listing",
        liveBody: "Your listing has been published and is now visible on Salento Local. Customers can find and contact you.",
        liveTitle: "Your business is live!",
        open: "Open PDF receipt",
        pendingBody: "Stripe is still confirming the payment. Refresh in a moment to see your receipt.",
        pendingTitle: "We’re confirming your payment",
        retry: "Retry verification",
        verificationUnavailable: "We cannot verify Stripe right now. Try again shortly; no additional charge will be made.",
        receiptBody: "You can open or download your receipt as a PDF for your records.",
        receiptSent: "Receipt sent to",
        receiptTitle: "Your receipt is ready",
        status: "Payment status",
        statusConfirmed: "Confirmed",
        successIntro: "Thank you! Your payment has been received and your listing",
        successLive: "is now live.",
        successTitle: "Payment successful!",
        summaryTitle: "Payment summary",
        viewListing: "View my business listing",
      };

  if (!paymentConfirmed) {
    return (
      <main className="shell px-4 py-9 sm:px-6 sm:py-12">
        <section className="card mx-auto max-w-xl p-6 text-center sm:p-8">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(42,98,87,0.08)] text-[var(--primary)]"><IconInfoCircle size={32} /></span>
          <h1 className="mt-5 font-serif text-3xl text-[var(--foreground)]">{copy.pendingTitle}</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">{verificationUnavailable ? copy.verificationUnavailable : copy.pendingBody}</p>
          {checkoutSessionId ? (
            <Link
              href={`/publish/payment/success?submission=${encodeURIComponent(submissionId)}&session=${encodeURIComponent(checkoutSessionId)}&locale=${locale}`}
              className="btn-secondary mt-4"
            >
              {copy.retry}
            </Link>
          ) : null}
          {viewer?.profileCompleted ? (
            <Link href={`/publish/payment?submission=${encodeURIComponent(submissionId)}`} className="btn-primary mt-6">
              {locale === "it" ? "Torna al pagamento" : "Back to payment"}
            </Link>
          ) : (
            <Link href="/" className="btn-primary mt-6">{copy.backHome}</Link>
          )}
        </section>
      </main>
    );
  }

  const paymentDate = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(receipt.payment.paidAt ?? receipt.submission.createdAt);
  const amount = formatCurrencyFromCents(
    receipt.payment.amountCents || receipt.submission.amountPaidCents,
    locale,
  );
  const receiptViewUrl = buildPaymentReceiptPageUrl(receipt.payment.id, checkoutSessionId);
  const receiptDownloadUrl = `/api/receipts/payment/${encodeURIComponent(receipt.payment.id)}${checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}&locale=${locale}&download=1` : `?locale=${locale}&download=1`}`;
  const agreementViewUrl = buildAgreementPageUrl(submissionId, checkoutSessionId);
  const agreementDownloadUrl = `/api/agreements/${encodeURIComponent(submissionId)}${checkoutSessionId ? `?session=${encodeURIComponent(checkoutSessionId)}&locale=${locale}&download=1` : `?locale=${locale}&download=1`}`;
  return (
    <main className="shell px-4 py-7 sm:px-6 sm:py-12">
      <section className="card mx-auto max-w-3xl overflow-hidden p-5 sm:p-8">
        <div className="mx-auto max-w-xl text-center">
          <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-[rgba(42,98,87,0.16)] bg-[radial-gradient(circle_at_35%_30%,#f5faf3,#e6f0e2)] text-[var(--primary)]">
            <span aria-hidden="true" className="absolute -left-7 -top-2 h-3 w-3 rotate-45 rounded-sm bg-[#eead7d]" />
            <span aria-hidden="true" className="absolute -right-8 top-7 h-3 w-3 rotate-45 rounded-sm bg-[#9dbca1]" />
            <span aria-hidden="true" className="absolute -bottom-3 left-1 h-2.5 w-2.5 rotate-45 rounded-sm bg-[#d4c882]" />
            <IconCheck size={58} stroke={3} />
          </div>
          <h1 className="mt-7 font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.successTitle}</h1>
          <p className="mt-4 text-lg leading-8 text-[var(--muted)]">
            {listingIsLive ? <>{copy.successIntro} <strong className="font-bold text-[var(--primary)]">{copy.successLive}</strong></> : locale === "it" ? "Grazie! Il tuo pagamento è stato ricevuto correttamente." : "Thank you! Your payment has been received successfully."}
          </p>
        </div>

        <div className="mt-8 rounded-[1.4rem] border border-[rgba(42,98,87,0.14)] bg-[rgba(42,98,87,0.05)] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[var(--primary)]"><IconRocket size={25} /></span>
            <div>
              <h2 className="text-xl font-bold text-[var(--primary)]">{listingIsLive ? copy.liveTitle : copy.listingPreparingTitle}</h2>
              <p className="mt-2 leading-7 text-[var(--foreground)]">{listingIsLive ? copy.liveBody : copy.listingPreparing}</p>
            </div>
          </div>
        </div>

        <section className="mt-8">
          <h2 className="text-xl font-bold text-[var(--foreground)]">{copy.summaryTitle}</h2>
          <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-white">
            <SummaryRow label={copy.amount} icon={<IconWallet size={21} />}>{amount}</SummaryRow>
            <SummaryRow label={copy.date} icon={<IconCalendarEvent size={21} />}>{paymentDate}</SummaryRow>
            <SummaryRow label={copy.status} icon={<IconCircleCheck size={21} />} last>
              <span className="pill-success inline-flex items-center gap-1.5"><IconCircleCheck size={16} /> {copy.statusConfirmed}</span>
            </SummaryRow>
          </div>
        </section>

        <section className="mt-6 rounded-[1.4rem] border border-[rgba(191,91,42,0.15)] bg-[linear-gradient(135deg,rgba(255,248,243,0.96),rgba(255,255,255,0.98))] p-5 sm:p-6">
          <p className="section-kicker mb-4">{locale === "it" ? "I TUOI DOCUMENTI" : "YOUR DOCUMENTS"}</p>
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgba(191,91,42,0.09)] text-[var(--accent)]"><IconReceipt2 size={25} /></span>
            <div>
              <h2 className="text-xl font-bold text-[var(--foreground)]">{copy.receiptTitle}</h2>
              <p className="mt-2 leading-7 text-[var(--foreground)]">{copy.receiptBody}</p>
              {receipt.submission.purchaseConfirmationSentAt && receipt.recipientEmail ? (
                <p className="mt-3 text-sm font-medium text-[var(--primary)]">{copy.receiptSent} {receipt.recipientEmail}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-5"><DocumentActions downloadUrl={receiptDownloadUrl} locale={locale} shareUrl={buildPaymentReceiptPageUrl(receipt.payment.id)} title={locale === "it" ? "Ricevuta di pagamento Salento Local" : "Salento Local Payment Receipt"} viewUrl={receiptViewUrl} /></div>
          {agreement ? <div className="mt-6 border-t border-[rgba(191,91,42,0.16)] pt-5"><div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgba(42,98,87,0.09)] text-[var(--primary)]"><IconFileDescription size={25} /></span><div><h2 className="text-xl font-bold text-[var(--foreground)]">{locale === "it" ? "Accordo di adesione firmato" : "Signed Membership Agreement"}</h2><p className="mt-2 leading-7 text-[var(--foreground)]">{locale === "it" ? "I termini della tua membership e il record della tua accettazione firmata." : "Your membership terms and signed acceptance record."}</p></div></div><div className="mt-5"><DocumentActions downloadUrl={agreementDownloadUrl} locale={locale} shareUrl={buildAgreementPageUrl(submissionId)} title={locale === "it" ? "Accordo di adesione firmato Salento Local" : "Salento Local Signed Membership Agreement"} viewUrl={agreementViewUrl} /></div></div> : null}
        </section>

        <div className="mt-8 grid gap-3">
          {businessListingHref ? (
            <Link href={businessListingHref} className="btn-primary flex w-full py-4 text-base">
              <IconEye size={22} /> {copy.viewListing}
            </Link>
          ) : (
            <Link href="/" className="btn-primary flex w-full py-4 text-base">{copy.backHome}</Link>
          )}
        </div>
      </section>
    </main>
  );
}
