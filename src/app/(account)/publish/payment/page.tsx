import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  IconBuildingBank,
  IconCheck,
  IconCircleCheck,
  IconDeviceMobile,
  IconDownload,
  IconInfoCircle,
  IconLock,
  IconQrcode,
  IconReceipt2,
  IconShieldCheck,
} from "@tabler/icons-react";
import QRCode from "qrcode";

import {
  simulateStripeBankTransferAction,
  startStripeCheckoutAction,
} from "@/app/(account)/payment-actions";
import { CheckoutStatusWatcher } from "@/components/account/checkout-status-watcher";
import { FormSubmitButton } from "@/components/form-submit-button";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPendingPaymentCopy } from "@/lib/payment";
import { prisma } from "@/lib/prisma";
import { getReceiptData } from "@/lib/receipts";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getSingleParam } from "@/lib/site";
import { canUseStripeBankTransferTestSimulation } from "@/lib/stripe";
import {
  ensureStripeBankTransferIntent,
  ensureStripeCheckoutSession,
} from "@/lib/stripe-checkout";

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
      bankTransferReference: true,
      businessName: true,
      businessPriceCents: true,
      email: true,
      id: true,
      ownerEmail: true,
      ownerName: true,
      ownerPhone: true,
      paymentMethod: true,
      paymentStatus: true,
      userId: true,
    },
  });

  if (!submission || submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  const copy = locale === "it"
    ? {
        amountDue: "Importo dovuto", amountPaid: "Importo pagato", bankTitle: "Bonifico bancario", beneficiary: "Beneficiario",
        cardFallback: "Apri Stripe Checkout", cardQrHint: "Inquadra questo QR con il telefono per aprire la pagina di pagamento.", cardWaiting: "Tieni aperta questa pagina fino alla conferma del pagamento.",
        date: "Data pagamento", emailSent: "Ricevuta inviata", emailSentHint: "Una ricevuta è stata inviata all'email del titolare.", failed: "Il pagamento non è stato completato. Puoi riprovare quando sei pronto.",
        iban: "IBAN", next: "Cosa succede ora?", nextPending: "Verificheremo automaticamente il pagamento. Quando Stripe lo confermerà, la scheda verrà pubblicata.", nextSuccess: "Il pagamento è stato confermato e la tua scheda è ora pubblicata.",
        paymentConfirmed: "Pagamento confermato!", paymentStep: "Passaggio pagamento", paymentSuccess: "Grazie! Il tuo pagamento è stato ricevuto correttamente.", pendingReference: "Riferimento in attesa",
        receipt: "La tua ricevuta", receiptHint: "Scansiona il QR per visualizzare e salvare la ricevuta.", receiptUnavailable: "La ricevuta sarà disponibile appena la conferma sarà completata.", reference: "Riferimento", returnDashboard: "Torna alla dashboard",
        sandboxBody: "Simula la ricezione del bonifico da parte di Stripe per verificare il flusso di pubblicazione locale.", sandboxCta: "Simula bonifico ricevuto", sandboxTitle: "Test sandbox Stripe", secure: "Pagamento sicuro", status: "Stato pagamento", statusConfirmed: "Confermato",
        titleBank: "Completa il tuo bonifico", titleCard: "Completa il pagamento della tua scheda", transferAction: "Apri istruzioni bonifico", transferAmount: "Importo da trasferire", transferHint: "Scansiona questo QR per aprire le istruzioni di bonifico Stripe sul telefono del titolare.",
        transferIntro: "Invia il pagamento usando i dettagli qui sotto. Non appena Stripe confermerà il bonifico, la scheda verrà pubblicata automaticamente.", transferUnavailable: "Non siamo riusciti a caricare le istruzioni di bonifico Stripe. Aggiorna la pagina e riprova.", transferWaiting: "Stiamo aspettando che Stripe riceva il bonifico. Puoi lasciare aperta questa pagina o tornare più tardi. La scheda verrà pubblicata automaticamente quando il pagamento sarà confermato.",
      }
    : {
        amountDue: "Amount due", amountPaid: "Amount paid", bankTitle: "Bank transfer", beneficiary: "Beneficiary",
        cardFallback: "Open Stripe Checkout", cardQrHint: "Scan this QR code with your phone to open the payment page.", cardWaiting: "Keep this page open until the payment is confirmed.",
        date: "Payment date", emailSent: "Receipt sent", emailSentHint: "A receipt has been sent to the business owner's email.", failed: "The payment was not completed. You can try again whenever you are ready.",
        iban: "IBAN", next: "What happens next?", nextPending: "We'll automatically check for your payment. Once Stripe confirms it, your listing will be published.", nextSuccess: "Your payment is confirmed and your listing is now published.",
        paymentConfirmed: "Payment confirmed!", paymentStep: "Payment step", paymentSuccess: "Thank you! Your payment has been received successfully.", pendingReference: "Pending reference",
        receipt: "Your receipt", receiptHint: "Scan the QR code to view and save your receipt.", receiptUnavailable: "Your receipt will be available as soon as confirmation is complete.", reference: "Reference", returnDashboard: "Back to dashboard",
        sandboxBody: "Simulate Stripe receiving the transfer to verify the local publication flow.", sandboxCta: "Simulate received bank transfer", sandboxTitle: "Stripe sandbox test", secure: "Secure payment", status: "Payment status", statusConfirmed: "Confirmed",
        titleBank: "Complete your bank transfer", titleCard: "Complete your listing payment", transferAction: "Open bank transfer instructions", transferAmount: "Amount to transfer", transferHint: "Scan this QR code to open Stripe's bank transfer instructions on the business owner's phone.",
        transferIntro: "Send the payment using the details below. As soon as Stripe confirms the transfer, your listing will be published automatically.", transferUnavailable: "We could not load Stripe's bank transfer instructions. Please refresh the page and try again.", transferWaiting: "We are waiting for Stripe to receive the transfer. Keep this page open or come back later. The listing will publish automatically once payment is confirmed.",
      };

  let checkoutUrl: string | null = null;
  let qrCodeDataUrl: string | null = null;
  let bankTransferInstructionsUrl: string | null = null;
  let bankTransferQrDataUrl: string | null = null;
  let bankTransferAccountHolderName: string | null = null;
  let bankTransferIban: string | null = null;
  let bankTransferBic: string | null = null;
  let bankTransferAmountRemainingCents: number | null = null;
  let bankTransferReference = submission.bankTransferReference;

  const receipt = submission.paymentStatus === "PAID"
    ? await getReceiptData({ appUrl, submissionId: submission.id, viewerId: viewer.id })
    : null;
  const receiptQrDataUrl = receipt?.receiptUrl
    ? await QRCode.toDataURL(receipt.receiptUrl, { margin: 1, width: 320 })
    : null;

  if (submission.paymentMethod === "ONLINE" && submission.paymentStatus !== "PAID") {
    const checkoutSession = await ensureStripeCheckoutSession({
      appUrl,
      submission: { amountOwedCents: submission.amountOwedCents, businessName: submission.businessName, email: submission.email, id: submission.id, ownerEmail: submission.ownerEmail, userId: submission.userId },
      viewer: { email: viewer.email, id: viewer.id, role: viewer.role },
    });
    checkoutUrl = checkoutSession.url;
    qrCodeDataUrl = checkoutUrl ? await QRCode.toDataURL(checkoutUrl, { margin: 1, width: 320 }) : null;
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
            <div className="mt-6 rounded-[1.4rem] border border-[rgba(191,91,42,0.15)] bg-[linear-gradient(135deg,rgba(255,248,243,0.96),rgba(255,255,255,0.98))] p-5 sm:p-6"><div className="grid items-center gap-5 sm:grid-cols-[1fr_auto]"><div><div className="flex items-center gap-3 text-[var(--accent)]"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(191,91,42,0.09)]"><IconReceipt2 size={23} /></span><h2 className="text-xl font-bold text-[var(--foreground)]">{copy.receipt}</h2></div><p className="mt-4 max-w-md leading-7 text-[var(--foreground)]">{copy.receiptHint}</p>{receipt?.submission.purchaseConfirmationSentAt && receipt.recipientEmail ? <p className="mt-4 text-sm font-medium text-[var(--primary)]">{copy.emailSent} · {copy.emailSentHint}</p> : null}{receipt?.receiptUrl ? <a href={receipt.receiptUrl} download className="btn-secondary mt-5 inline-flex border-[rgba(191,91,42,0.4)] text-[var(--accent)]"><IconDownload size={18} /> {locale === "it" ? "Scarica ricevuta PDF" : "Download PDF receipt"}</a> : <p className="mt-4 text-sm text-[var(--muted)]">{copy.receiptUnavailable}</p>}</div>{receiptQrDataUrl ? <div className="mx-auto rounded-[1.25rem] border border-[var(--border)] bg-white p-3 shadow-sm"><img src={receiptQrDataUrl} alt={locale === "it" ? "QR della ricevuta" : "Receipt QR code"} className="h-44 w-44 rounded-xl sm:h-40 sm:w-40" /></div> : null}</div></div>
            <Link href="/dashboard" className="btn-primary mt-8 flex w-full py-4 text-base">{copy.returnDashboard}</Link>
          </section>
        ) : (
          <>
            <div className="mb-8"><p className="section-kicker mb-4">{copy.paymentStep}</p><h1 className="max-w-xl font-serif text-4xl leading-tight text-[var(--foreground)] sm:text-5xl">{submission.paymentMethod === "BANK_TRANSFER" ? copy.titleBank : copy.titleCard}</h1><p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">{submission.paymentMethod === "BANK_TRANSFER" ? copy.nextPending : getPendingPaymentCopy(locale)}</p></div>
            <section className="card overflow-hidden p-5 sm:p-8">
              {submission.paymentMethod === "BANK_TRANSFER" ? (
                <div><div className="flex items-start gap-4"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgba(191,91,42,0.09)] text-[var(--accent)]"><IconBuildingBank size={29} /></span><div><h2 className="text-2xl font-bold text-[var(--foreground)]">{copy.bankTitle}</h2><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.transferIntro}</p></div></div>
                  {bankTransferIban && bankTransferAccountHolderName ? <><div className="mt-6 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-white"><SummaryRow label={copy.beneficiary}>{bankTransferAccountHolderName}</SummaryRow><SummaryRow label={copy.iban}>{bankTransferIban}</SummaryRow><SummaryRow label="BIC">{bankTransferBic || "—"}</SummaryRow><SummaryRow label={copy.reference}>{bankTransferReference || copy.pendingReference}</SummaryRow><SummaryRow label={copy.transferAmount} last><span className="text-lg text-[var(--accent)]">{formatCurrencyFromCents(bankTransferAmountRemainingCents ?? submission.amountOwedCents, locale)}</span></SummaryRow></div>
                    <div className="mt-6 grid items-center gap-5 rounded-[1.4rem] bg-[rgba(42,98,87,0.055)] p-4 sm:grid-cols-[auto_1fr] sm:p-5">{bankTransferQrDataUrl ? <div className="mx-auto rounded-2xl bg-white p-3 shadow-sm sm:mx-0"><img src={bankTransferQrDataUrl} alt={locale === "it" ? "QR delle istruzioni per il bonifico" : "QR code for bank transfer instructions"} className="h-36 w-36 rounded-xl" /></div> : null}<div><div className="flex items-center gap-2 text-[var(--primary)]"><IconQrcode size={20} /><h3 className="text-lg font-bold">{locale === "it" ? "Scansiona per le istruzioni" : "Scan to view instructions"}</h3></div><p className="mt-2 leading-7 text-[var(--foreground)]">{copy.transferHint}</p></div></div>
                    {bankTransferInstructionsUrl ? <a href={bankTransferInstructionsUrl} target="_blank" rel="noreferrer" className="btn-primary mt-6 flex w-full py-4 text-base"><IconDeviceMobile size={21} /> {copy.transferAction}</a> : null}</> : <p className="mt-6 rounded-[1.25rem] border border-[rgba(191,91,42,0.18)] bg-[rgba(191,91,42,0.05)] px-4 py-4 leading-7 text-[var(--foreground)]">{copy.transferUnavailable}</p>}
                  <div className="mt-6 rounded-[1.25rem] border border-[rgba(42,98,87,0.14)] bg-[rgba(42,98,87,0.05)] p-4 sm:p-5"><div className="flex items-start gap-3"><IconInfoCircle size={24} className="mt-0.5 shrink-0 text-[var(--primary)]" /><p className="leading-7 text-[var(--foreground)]">{copy.transferWaiting}</p></div></div>
                </div>
              ) : (
                <div><div className="border-b border-dashed border-[var(--border)] pb-6"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{copy.amountDue}</p><p className="mt-2 font-serif text-5xl text-[var(--foreground)] sm:text-6xl">{formatCurrencyFromCents(submission.amountOwedCents, locale)}</p><p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)]"><IconLock size={17} /> {copy.secure}</p></div>
                  {qrCodeDataUrl ? <div className="flex flex-col items-center py-6 text-center"><p className="max-w-md text-base leading-7 text-[var(--muted)]">{copy.cardQrHint}</p><div className="mt-5 rounded-[1.5rem] border border-[var(--border)] bg-white p-4 shadow-sm"><img src={qrCodeDataUrl} alt={locale === "it" ? "QR del pagamento Stripe" : "QR code for Stripe payment"} className="h-60 w-60 rounded-xl sm:h-64 sm:w-64" /></div><p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"><IconDeviceMobile size={19} className="text-[var(--primary)]" /> {copy.cardWaiting}</p></div> : <form action={startStripeCheckoutAction} className="mt-6"><input type="hidden" name="submissionId" value={submission.id} /><FormSubmitButton className="btn-primary flex w-full py-4 text-base">{copy.cardFallback}</FormSubmitButton></form>}
                  <div className="rounded-[1.25rem] border border-[rgba(42,98,87,0.14)] bg-[rgba(42,98,87,0.05)] p-4 sm:p-5"><div className="flex items-start gap-3"><IconInfoCircle size={24} className="mt-0.5 shrink-0 text-[var(--primary)]" /><div><h2 className="font-bold text-[var(--foreground)]">{copy.next}</h2><p className="mt-1 leading-7 text-[var(--foreground)]">{copy.nextPending}</p></div></div></div>
                </div>
              )}
              {isFailed ? <p className="mt-6 rounded-[1.2rem] bg-[rgba(191,91,42,0.08)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">{copy.failed}</p> : null}
              <CheckoutStatusWatcher copy={{ paid: locale === "it" ? "Pagamento ricevuto. Stiamo aggiornando questa pagina." : "Payment received. We are updating this page.", pending: submission.paymentMethod === "BANK_TRANSFER" ? copy.transferWaiting : copy.cardWaiting }} submissionId={submission.id} />
            </section>
            {showBankTransferSandboxTools ? <aside className="mt-5 rounded-[1.35rem] border border-dashed border-[var(--border)] bg-white/65 p-5"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">{copy.sandboxTitle}</p><p className="mt-2 text-sm leading-7 text-[var(--muted)]">{copy.sandboxBody}</p>{bankTransferTestNotice ? <p className="mt-3 text-sm font-medium text-[var(--primary)]">{bankTransferTestNotice}</p> : null}<form action={simulateStripeBankTransferAction} className="mt-4"><input type="hidden" name="submissionId" value={submission.id} /><FormSubmitButton className="btn-secondary w-full sm:w-auto">{copy.sandboxCta}</FormSubmitButton></form></aside> : null}
          </>
        )}
      </div>
    </main>
  );
}
