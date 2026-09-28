import { RefundPolicySummary } from "@/components/account/refund-policy-summary";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  IconBuildingBank,
  IconBrandWhatsapp,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDeviceMobile,
  IconDownload,
  IconInfoCircle,
  IconLock,
  IconQrcode,
  IconReceipt2,
  IconShieldCheck,
} from "@tabler/icons-react";
import QRCode from "qrcode";

import { simulateStripeBankTransferAction } from "@/app/(account)/payment-actions";
import { CheckoutStatusWatcher } from "@/components/account/checkout-status-watcher";
import { FormSubmitButton } from "@/components/form-submit-button";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireCompletedViewer } from "@/lib/auth-guards";
import {
  getNoEmailOwnerWhatsAppHandoff,
  shouldContinuePartnerWhatsAppHandoffPolling,
} from "@/lib/business-owner-access";
import { getCurrentLocale } from "@/lib/locale";
import { getPendingPaymentCopy } from "@/lib/payment";
import { createNoEmailPaymentToken, ensureManualElementPaymentIntent, isInitialElementEligible } from "@/lib/no-email-payment";
import { ensureEmbeddedSubscription } from "@/lib/embedded-subscription";
import { prisma } from "@/lib/prisma";
import { getReceiptData } from "@/lib/receipts";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getSingleParam } from "@/lib/site";
import { canUseStripeBankTransferTestSimulation, getPaymentElementPublishableKey } from "@/lib/stripe";
import { ensureStripeBankTransferIntent } from "@/lib/stripe-checkout";
import {
  buildNoEmailPaymentQrPayload,
  generateStripePaymentQrDataUrl,
} from "@/lib/stripe-payment-qr";

type PublishPaymentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function SummaryRow({
  children,
  label,
  last = false,
}: {
  children: React.ReactNode;
  label: string;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-4 sm:px-5 ${last ? "" : "border-b border-[var(--border)]"}`}>
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="text-right text-sm font-semibold text-[var(--foreground)]">{children}</span>
    </div>
  );
}

export default async function PublishPaymentPage({ searchParams }: PublishPaymentPageProps) {
  const requestHeaders = await headers();
  const appUrl = getOriginFromHeaders(requestHeaders);
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const submissionId = getSingleParam(resolvedSearchParams.submission);
  const bankTransferTestStatus = getSingleParam(resolvedSearchParams.bankTransferTest);

  if (!submissionId) {
    redirect("/dashboard");
  }

  const submission = await prisma.businessSubmission.findUnique({
    where: { id: submissionId },
    select: {
      amountPaidCents: true,
      amountOwedCents: true,
      agreementSignature: true,
      automaticRenewalAtAcceptance: true,
      bankTransferReference: true,
      businessName: true,
      businessPriceCents: true,
      businessTermsAcceptedAt: true,
      email: true,
      id: true,
      ownerEmail: true,
      ownerHasNoEmail: true,
      ownerName: true,
      ownerPhone: true,
      paymentMethod: true,
      paymentStatus: true,
      signedAt: true,
      status: true,
      userId: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  const copy = locale === "it"
    ? {
        amountDue: "Importo dovuto", amountPaid: "Importo pagato", bankTitle: "Bonifico bancario", beneficiary: "Beneficiario",
        cardFallback: "Apri Stripe Checkout", cardIntro: (amount: string) => `Inquadra il QR qui sotto per pagare ${amount} e pubblicare la tua scheda su Salento Local.`, cardPolling: "Stiamo verificando automaticamente il pagamento.", cardQrHint: "Apri l'app della tua banca, inquadra il codice e completa il pagamento.", cardQrTitle: "Inquadra questo codice QR con il tuo telefono", cardWaiting: "Tieni aperta questa pagina fino alla conferma del pagamento.",
        date: "Data pagamento", emailSent: "Ricevuta inviata", emailSentHint: "Una ricevuta è stata inviata all'email del titolare.", failed: "Il pagamento non è stato completato. Puoi riprovare quando sei pronto.",
        iban: "IBAN", next: "Cosa succede ora?", nextPending: "Verificheremo automaticamente il pagamento. Quando Stripe lo confermerà, la scheda verrà pubblicata.", nextSuccess: "Il pagamento è stato confermato e la tua scheda è ora pubblicata.",
        paymentConfirmed: "Pagamento confermato!", paymentStep: "Passaggio pagamento", paymentSuccess: "Grazie! Il tuo pagamento è stato ricevuto correttamente.", pendingReference: "Riferimento in attesa",
        handoffBody: "L'attività è online. Invia al titolare la sua scheda e il link sicuro per creare l'account su WhatsApp.", handoffCta: "Invia accesso via WhatsApp", handoffHint: "WhatsApp si aprirà con il numero del titolare e i link già compilati. Controlla il messaggio e premi Invia.", handoffTitle: "Dai accesso al titolare",
        handoffPreparing: "Stiamo preparando il link di accesso del titolare.",
        receipt: "La tua ricevuta", receiptHint: "Scansiona il QR per visualizzare e salvare la ricevuta.", receiptUnavailable: "La ricevuta sarà disponibile appena la conferma sarà completata.", reference: "Riferimento", returnDashboard: "Torna alla dashboard",
        sandboxBody: "Simula la ricezione del bonifico da parte di Stripe per verificare il flusso di pubblicazione locale.", sandboxCta: "Simula bonifico ricevuto", sandboxTitle: "Test sandbox Stripe", secure: "Pagamento sicuro", status: "Stato pagamento", statusConfirmed: "Confermato", useBankingApp: "Usa l'app della tua banca",
        titleBank: "Completa il tuo bonifico", titleCard: "Completa il tuo pagamento", transferAction: "Apri istruzioni bonifico", transferAmount: "Importo da trasferire", transferHint: "Scansiona questo QR per aprire le istruzioni di bonifico Stripe sul telefono del titolare.",
        transferIntro: "Invia il pagamento usando i dettagli qui sotto. Non appena Stripe confermerà il bonifico, la scheda verrà pubblicata automaticamente.", transferUnavailable: "Non siamo riusciti a caricare le istruzioni di bonifico Stripe. Aggiorna la pagina e riprova.", transferWaiting: "Stiamo aspettando che Stripe riceva il bonifico. Puoi lasciare aperta questa pagina o tornare più tardi. La scheda verrà pubblicata automaticamente quando il pagamento sarà confermato.",
      }
    : {
        amountDue: "Amount due", amountPaid: "Amount paid", bankTitle: "Bank transfer", beneficiary: "Beneficiary",
        cardFallback: "Open Stripe Checkout", cardIntro: (amount: string) => `Scan the QR code below to pay ${amount} and publish your listing on Salento Local.`, cardPolling: "We're automatically checking for your payment.", cardQrHint: "Open your banking app, scan the code, and complete the payment.", cardQrTitle: "Scan this QR code with your phone", cardWaiting: "Keep this page open until the payment is confirmed.",
        date: "Payment date", emailSent: "Receipt sent", emailSentHint: "A receipt has been sent to the business owner's email.", failed: "The payment was not completed. You can try again whenever you are ready.",
        iban: "IBAN", next: "What happens next?", nextPending: "We'll automatically check for your payment. Once Stripe confirms it, your listing will be published.", nextSuccess: "Your payment is confirmed and your listing is now published.",
        paymentConfirmed: "Payment confirmed!", paymentStep: "Payment step", paymentSuccess: "Thank you! Your payment has been received successfully.", pendingReference: "Pending reference",
        handoffBody: "The business is live. Send the owner their listing and secure account-creation link on WhatsApp.", handoffCta: "Send access via WhatsApp", handoffHint: "WhatsApp will open with the owner’s number and links already filled in. Review the message and press Send.", handoffTitle: "Give the owner access",
        handoffPreparing: "We’re preparing the owner’s access link.",
        receipt: "Your receipt", receiptHint: "Scan the QR code to view and save your receipt.", receiptUnavailable: "Your receipt will be available as soon as confirmation is complete.", reference: "Reference", returnDashboard: "Back to dashboard",
        sandboxBody: "Simulate Stripe receiving the transfer to verify the local publication flow.", sandboxCta: "Simulate received bank transfer", sandboxTitle: "Stripe sandbox test", secure: "Secure payment", status: "Payment status", statusConfirmed: "Confirmed", useBankingApp: "Use your banking app",
        titleBank: "Complete your bank transfer", titleCard: "Complete your payment", transferAction: "Open bank transfer instructions", transferAmount: "Amount to transfer", transferHint: "Scan this QR code to open Stripe's bank transfer instructions on the business owner's phone.",
        transferIntro: "Send the payment using the details below. As soon as Stripe confirms the transfer, your listing will be published automatically.", transferUnavailable: "We could not load Stripe's bank transfer instructions. Please refresh the page and try again.", transferWaiting: "We are waiting for Stripe to receive the transfer. Keep this page open or come back later. The listing will publish automatically once payment is confirmed.",
      };

  let qrCodeDataUrl: string | null = null;
  let elementPaymentUrl: string | null = null;
  let bankTransferInstructionsUrl: string | null = null;
  let bankTransferQrDataUrl: string | null = null;
  let bankTransferAccountHolderName: string | null = null;
  let bankTransferIban: string | null = null;
  let bankTransferBic: string | null = null;
  let bankTransferAmountRemainingCents: number | null = null;
  let bankTransferReference = submission.bankTransferReference;

  const elementPaidPayment = submission.paymentStatus === "PAID"
    ? await prisma.payment.findUnique({
        where: { id: `initial-element:${submission.id}` },
        select: { id: true, status: true },
      })
    : null;
  const exactElementPaymentId = elementPaidPayment?.status === "PAID" ? elementPaidPayment.id : null;
  const receipt = submission.paymentStatus === "PAID"
    ? await getReceiptData({ appUrl, paymentId: exactElementPaymentId, submissionId: submission.id, viewerId: viewer.id })
    : null;
  const receiptUrl = receipt?.receiptUrl && exactElementPaymentId
    ? `${receipt.receiptUrl}?payment_token=${encodeURIComponent(createNoEmailPaymentToken(exactElementPaymentId))}`
    : receipt?.receiptUrl;
  const receiptQrDataUrl = receiptUrl
    ? await QRCode.toDataURL(receiptUrl, { margin: 1, width: 320 })
    : null;

  if (submission.paymentMethod === "ONLINE" && submission.paymentStatus !== "PAID") {
    if (isInitialElementEligible({ ...submission, submittingUserRole: viewer.role }) && getPaymentElementPublishableKey()) {
      const payment = submission.automaticRenewalAtAcceptance
        ? await ensureEmbeddedSubscription(submission.id)
        : await ensureManualElementPaymentIntent(submission.id);
      if (payment) {
        elementPaymentUrl = buildNoEmailPaymentQrPayload({
          appUrl,
          token: createNoEmailPaymentToken(payment.id),
        });
        qrCodeDataUrl = await generateStripePaymentQrDataUrl(elementPaymentUrl);
      }
    }
  }

  if (submission.paymentMethod === "BANK_TRANSFER" && submission.paymentStatus !== "PAID") {
    const bankTransferIntent = await ensureStripeBankTransferIntent({
      submission: { amountOwedCents: submission.amountOwedCents, businessName: submission.businessName, email: submission.email, id: submission.id, ownerEmail: submission.ownerEmail, ownerName: submission.ownerName, ownerPhone: submission.ownerPhone, userId: submission.userId },
      viewer: { email: viewer.email, id: viewer.id, role: viewer.role },
    });
    const instructions = bankTransferIntent.instructions;
    bankTransferInstructionsUrl = instructions?.hostedInstructionsUrl ?? null;
    bankTransferAccountHolderName = instructions?.accountHolderName ?? null;
    bankTransferIban = instructions?.iban ?? null;
    bankTransferBic = instructions?.bic ?? null;
    bankTransferAmountRemainingCents = instructions?.amountRemainingCents ?? null;
    bankTransferReference = instructions?.reference ?? bankTransferReference;
    bankTransferQrDataUrl = bankTransferInstructionsUrl
      ? await QRCode.toDataURL(bankTransferInstructionsUrl, { margin: 1, width: 260 })
      : null;
  }

  const paymentAmountCents = receipt?.payment.amountCents ?? (submission.amountPaidCents > 0 ? submission.amountPaidCents : submission.businessPriceCents);
  const paymentDate = receipt?.payment.paidAt
    ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(receipt.payment.paidAt)
    : null;
  const showBankTransferSandboxTools = submission.paymentMethod === "BANK_TRANSFER" && submission.paymentStatus !== "PAID" && canUseStripeBankTransferTestSimulation();
  const bankTransferTestNotice = showBankTransferSandboxTools && bankTransferTestStatus === "success"
    ? locale === "it" ? "Bonifico sandbox simulato. Stripe ha ricevuto il pagamento di test." : "Sandbox bank transfer simulated. Stripe received the test payment."
    : showBankTransferSandboxTools && bankTransferTestStatus === "failed"
      ? locale === "it" ? "Non siamo riusciti a simulare il bonifico sandbox. Riprova." : "We could not simulate the sandbox transfer. Please try again."
      : null;
  const isPaid = submission.paymentStatus === "PAID";
  const isFailed = submission.paymentStatus === "FAILED" || submission.paymentStatus === "REFUNDED";
  const amountDue = formatCurrencyFromCents(submission.amountOwedCents, locale);
  // This authenticated QR page belongs to the submitting Partner. Its paid state
  // is reached after CheckoutStatusWatcher has authoritatively confirmed payment.
  const ownerWhatsAppHandoff = isPaid && viewer.role === "GETTER"
    ? await getNoEmailOwnerWhatsAppHandoff({
        appUrl,
        submissionId: submission.id,
      })
    : null;
  const shouldContinueHandoffPolling = shouldContinuePartnerWhatsAppHandoffPolling({
    handoffAvailable: Boolean(ownerWhatsAppHandoff),
    ownerEmail: submission.ownerEmail,
    ownerHasNoEmail: submission.ownerHasNoEmail,
    ownerPhone: submission.ownerPhone,
    paymentStatus: submission.paymentStatus,
    status: submission.status,
    viewerRole: viewer.role,
  });

  return (
    <main className="shell px-4 py-9 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        {isPaid ? (
          <section className="card overflow-hidden p-5 sm:p-8">
            <div className="mx-auto max-w-xl text-center">
              <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#2f806e,#1d5b4f)] text-white shadow-[0_14px_32px_rgba(42,98,87,0.24)]">
                <span aria-hidden="true" className="absolute -left-7 -top-2 h-3 w-3 rotate-45 rounded-sm bg-[#d4c882]" /><span aria-hidden="true" className="absolute -right-8 top-7 h-3 w-3 rotate-45 rounded-sm bg-[#df7a46]" /><span aria-hidden="true" className="absolute -bottom-3 left-1 h-2.5 w-2.5 rotate-45 rounded-sm bg-[#a8c6a4]" />
                <IconCheck size={58} stroke={3} />
              </div>
              <h1 className="mt-8 font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{copy.paymentConfirmed}</h1>
              <p className="mt-3 text-lg leading-8 text-[var(--muted)]">{copy.paymentSuccess}</p>
            </div>
            <div className="mt-8 rounded-[1.4rem] border border-[rgba(42,98,87,0.14)] bg-[rgba(42,98,87,0.05)] p-5 sm:p-6"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[var(--primary)]"><IconShieldCheck size={24} /></span><div><h2 className="text-xl font-bold text-[var(--foreground)]">{copy.next}</h2><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.nextSuccess}</p></div></div></div>
            <div className="mt-6 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-white">
              <SummaryRow label={copy.amountPaid}>{formatCurrencyFromCents(paymentAmountCents, locale)}</SummaryRow>
              <SummaryRow label={copy.date}>{paymentDate ?? "—"}</SummaryRow>
              <SummaryRow label={copy.status} last><span className="pill-success inline-flex items-center gap-1.5"><IconCircleCheck size={16} /> {copy.statusConfirmed}</span></SummaryRow>
            </div>
            <div className="mt-6 rounded-[1.4rem] border border-[rgba(191,91,42,0.15)] bg-[linear-gradient(135deg,rgba(255,248,243,0.96),rgba(255,255,255,0.98))] p-5 sm:p-6"><div className="grid items-center gap-5 sm:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-3 text-[var(--accent)]"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(191,91,42,0.09)]"><IconReceipt2 size={23} /></span><h2 className="text-xl font-bold text-[var(--foreground)]">{copy.receipt}</h2></div><p className="mt-4 max-w-md leading-7 text-[var(--foreground)]">{copy.receiptHint}</p>{receipt?.submission.purchaseConfirmationSentAt && receipt.recipientEmail ? <p className="mt-4 text-sm font-medium text-[var(--primary)]">{copy.emailSent} · {copy.emailSentHint}</p> : null}{receipt?.receiptUrl ? <a href={receiptUrl} download className="btn-secondary mt-5 inline-flex border-[rgba(191,91,42,0.4)] text-[var(--accent)]"><IconDownload size={18} /> {locale === "it" ? "Scarica ricevuta PDF" : "Download PDF receipt"}</a> : <p className="mt-4 text-sm text-[var(--muted)]">{copy.receiptUnavailable}</p>}</div>{receiptQrDataUrl ? <div className="mx-auto rounded-[1.25rem] border border-[var(--border)] bg-white p-3 shadow-sm"><img src={receiptQrDataUrl} alt={locale === "it" ? "QR della ricevuta" : "Receipt QR code"} className="h-44 w-44 rounded-xl sm:h-40 sm:w-40" /></div> : null}</div></div>
            {ownerWhatsAppHandoff ? <section className="mt-6 rounded-[1.4rem] border border-[rgba(37,211,102,0.24)] bg-[linear-gradient(135deg,rgba(238,251,242,0.96),rgba(255,255,255,0.98))] p-5 sm:p-6"><div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgba(37,211,102,0.12)] text-[#168846]"><IconBrandWhatsapp size={25} /></span><div className="min-w-0"><h2 className="text-xl font-bold text-[var(--foreground)]">{copy.handoffTitle}</h2><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.handoffBody}</p><a href={ownerWhatsAppHandoff.href} className="btn-primary mt-5 flex w-full py-4 text-base sm:w-auto" target="_blank" rel="noreferrer"><IconBrandWhatsapp size={22} /> {copy.handoffCta}</a><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{copy.handoffHint}</p></div></div></section> : null}
            {shouldContinueHandoffPolling ? <CheckoutStatusWatcher copy={{ paid: copy.handoffPreparing, pending: copy.handoffPreparing }} submissionId={submission.id} /> : null}
            <Link href="/dashboard" className="btn-primary mt-8 flex w-full py-4 text-base">{copy.returnDashboard}</Link>
          </section>
        ) : (
          <>
            <div className="mb-5 sm:mb-8"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)] sm:section-kicker sm:mb-4">{copy.paymentStep}</p><h1 className="mt-2 max-w-xl font-serif text-[2.55rem] leading-[0.98] text-[var(--foreground)] sm:mt-0 sm:text-5xl sm:leading-tight">{submission.paymentMethod === "BANK_TRANSFER" ? copy.titleBank : copy.titleCard}</h1><p className="mt-3 max-w-2xl text-base leading-6 text-[var(--muted)] sm:mt-4 sm:text-lg sm:leading-8">{submission.paymentMethod === "BANK_TRANSFER" ? copy.nextPending : copy.cardIntro(amountDue)}</p>{submission.paymentMethod === "ONLINE" ? <p className="mt-3 max-w-2xl text-xs leading-5 text-[var(--muted)] sm:text-sm">{getPendingPaymentCopy(locale)}</p> : null}</div>
            <RefundPolicySummary locale={locale} bank={submission.paymentMethod === "BANK_TRANSFER"} />
            <section className="card overflow-hidden p-5 sm:p-8">
              {submission.paymentMethod === "BANK_TRANSFER" ? (
                <div><div className="flex items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgba(191,91,42,0.09)] text-[var(--accent)]"><IconBuildingBank size={29} /></span><div><h2 className="text-2xl font-bold text-[var(--foreground)]">{copy.bankTitle}</h2><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.transferIntro}</p></div></div>
                  {bankTransferIban && bankTransferAccountHolderName ? <><div className="mt-6 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-white"><SummaryRow label={copy.beneficiary}>{bankTransferAccountHolderName}</SummaryRow><SummaryRow label={copy.iban}>{bankTransferIban}</SummaryRow><SummaryRow label="BIC">{bankTransferBic || "—"}</SummaryRow><SummaryRow label={copy.reference}>{bankTransferReference || copy.pendingReference}</SummaryRow><SummaryRow label={copy.transferAmount} last><span className="text-lg text-[var(--accent)]">{formatCurrencyFromCents(bankTransferAmountRemainingCents ?? submission.amountOwedCents, locale)}</span></SummaryRow></div>
                    <div className="mt-6 grid items-center gap-5 rounded-[1.4rem] bg-[rgba(42,98,87,0.055)] p-4 sm:grid-cols-[auto_1fr] sm:p-5">{bankTransferQrDataUrl ? <div className="mx-auto rounded-2xl bg-white p-3 shadow-sm sm:mx-0"><img src={bankTransferQrDataUrl} alt={locale === "it" ? "QR delle istruzioni per il bonifico" : "QR code for bank transfer instructions"} className="h-36 w-36 rounded-xl" /></div> : null}<div><div className="flex items-center gap-2 text-[var(--primary)]"><IconQrcode size={20} /><h3 className="text-lg font-bold">{locale === "it" ? "Scansiona per le istruzioni" : "Scan to view instructions"}</h3></div><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.transferHint}</p></div></div>
                    {bankTransferInstructionsUrl ? <a href={bankTransferInstructionsUrl} target="_blank" rel="noreferrer" className="btn-primary mt-6 flex w-full py-4 text-base"><IconDeviceMobile size={21} /> {copy.transferAction}</a> : null}</> : <p className="mt-6 rounded-[1.25rem] border border-[rgba(191,91,42,0.18)] bg-[rgba(191,91,42,0.05)] px-4 py-4 leading-7 text-[var(--foreground)]">{copy.transferUnavailable}</p>}
                  <div className="mt-6 rounded-[1.25rem] border border-[rgba(42,98,87,0.14)] bg-[rgba(42,98,87,0.05)] p-4 sm:p-5"><div className="flex items-start gap-3"><IconInfoCircle size={24} className="mt-0.5 shrink-0 text-[var(--primary)]" /><p className="leading-7 text-[var(--foreground)]">{copy.transferWaiting}</p></div></div>
                </div>
              ) : (
                <div><div className="rounded-[1.35rem] border border-[rgba(42,98,87,0.13)] bg-[linear-gradient(135deg,rgba(243,248,242,0.98),rgba(247,244,239,0.92))] p-5 sm:rounded-none sm:border-x-0 sm:border-t-0 sm:border-dashed sm:border-[var(--border)] sm:bg-transparent sm:px-0 sm:pb-6"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--primary)]">{copy.amountDue}</p><div className="mt-2 flex items-end justify-between gap-4"><p className="font-serif text-5xl leading-none text-[var(--foreground)] sm:text-6xl">{amountDue}</p><p className="mb-0.5 inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--primary)]"><IconLock size={19} /> <span className="max-w-20 leading-5 sm:max-w-none">{copy.secure}</span></p></div></div>
                  {qrCodeDataUrl ? <div className="mt-4 rounded-[1.4rem] border border-[var(--border)] bg-white p-4 text-center sm:mt-6 sm:p-6"><h2 className="text-xl font-bold leading-7 text-[var(--foreground)] sm:text-2xl">{copy.cardQrTitle}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)] sm:text-base sm:leading-7">{copy.cardQrHint} <strong className="font-semibold text-[var(--foreground)]">{amountDue}</strong></p><div className="mx-auto mt-4 w-full max-w-[16.5rem] rounded-[1.25rem] border border-[var(--border)] bg-white p-3 shadow-sm sm:mt-5 sm:p-4"><img src={qrCodeDataUrl} alt={locale === "it" ? "QR del pagamento Stripe" : "QR code for Stripe payment"} className="aspect-square h-auto w-full" /></div><div className="mt-4 rounded-[1.15rem] bg-[rgba(42,98,87,0.06)] px-4 py-4 text-left sm:mt-5 sm:flex sm:items-start sm:gap-4"><IconDeviceMobile size={25} className="mb-2 shrink-0 text-[var(--primary)] sm:mb-0" /><div><h3 className="font-bold text-[var(--foreground)]">{copy.useBankingApp}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.cardQrHint} <strong className="font-semibold text-[var(--primary)]">{amountDue}</strong></p></div></div><div className="mt-4 border-t border-[var(--border)] pt-4 text-left sm:mt-5 sm:pt-5"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(191,91,42,0.1)] text-[var(--accent)]"><IconClock size={20} /></span><div><h3 className="font-bold text-[var(--foreground)]">{copy.next}</h3><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.nextPending}</p><p className="mt-2 text-sm font-medium text-[var(--foreground)]">{copy.cardWaiting}</p></div></div></div>{elementPaymentUrl ? <Link href={elementPaymentUrl} className="btn-secondary mt-4 flex min-h-12 w-full">{locale === "it" ? "Apri pagamento" : "Open payment"}</Link> : null}</div> : <p className="mt-6 text-sm text-[var(--accent)]">{locale === "it" ? "Pagamento non disponibile. Verifica i dati del titolare e riprova." : "Payment unavailable. Check the owner details and try again."}</p>}
                </div>
              )}
              {isFailed ? <p className="mt-6 rounded-[1.2rem] bg-[rgba(191,91,42,0.08)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">{copy.failed}</p> : null}
              <CheckoutStatusWatcher copy={{ paid: locale === "it" ? "Pagamento ricevuto. Stiamo aggiornando questa pagina." : "Payment received. We are updating this page.", pending: submission.paymentMethod === "BANK_TRANSFER" ? copy.transferWaiting : copy.cardPolling }} submissionId={submission.id} />
            </section>
            {showBankTransferSandboxTools ? <aside className="mt-5 rounded-[1.35rem] border border-dashed border-[var(--border)] bg-white/65 p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{copy.sandboxTitle}</p><p className="mt-2 text-sm leading-7 text-[var(--muted)]">{copy.sandboxBody}</p>{bankTransferTestNotice ? <p className="mt-3 text-sm font-medium text-[var(--primary)]">{bankTransferTestNotice}</p> : null}<form action={simulateStripeBankTransferAction} className="mt-4"><input type="hidden" name="submissionId" value={submission.id} /><FormSubmitButton className="btn-secondary w-full sm:w-auto">{copy.sandboxCta}</FormSubmitButton></form></aside> : null}
          </>
        )}
      </div>
    </main>
  );
}
