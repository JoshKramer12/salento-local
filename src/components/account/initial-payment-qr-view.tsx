import Link from "next/link";
import {
  IconClock,
  IconDeviceMobile,
  IconLock,
  IconShieldCheck,
  IconUsersGroup,
} from "@tabler/icons-react";

import { CheckoutStatusWatcher } from "@/components/account/checkout-status-watcher";

type PaymentQrCopy = {
  cardIntro: (amount: string) => string;
  cardPolling: string;
  cardQrHint: string;
  cardQrTitle: string;
  confirmationNotice: string;
  failed: string;
  membershipLabel: string;
  paymentStep: string;
  refundSummary: (amount: string) => string;
  refundTerms: string;
  secureDirect: string;
  titleCard: string;
};

export function InitialPaymentQrView({
  amount,
  copy,
  failed,
  locale,
  paymentUrl,
  qrCodeDataUrl,
  submissionId,
  warning,
}: {
  amount: string;
  copy: PaymentQrCopy;
  failed: boolean;
  locale: "en" | "it";
  paymentUrl: string | null;
  qrCodeDataUrl: string | null;
  submissionId: string;
  warning: string;
}) {
  return <>
    <header className="mb-5 sm:mb-7">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">{copy.paymentStep}</p>
      <h1 className="mt-2 max-w-xl font-serif text-[clamp(2.6rem,10vw,4.5rem)] leading-[1.02] tracking-[-0.025em] text-[var(--foreground)]">{copy.titleCard}</h1>
      <p className="mt-3 max-w-2xl text-[1.05rem] leading-[1.55] text-[var(--muted)] sm:text-lg">{copy.cardIntro(amount)}</p>
    </header>

    <section aria-label={copy.membershipLabel} className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-[1.45rem] border border-[var(--border)] bg-[#fffdfa] px-4 py-4 sm:mb-4 sm:px-5">
      <p className="min-w-0 text-sm font-medium leading-5 text-[var(--foreground)] sm:text-base">{copy.membershipLabel}</p>
      <strong className="whitespace-nowrap text-xl font-bold leading-6 text-[var(--primary)] sm:text-2xl">{amount}</strong>
      <p className="col-span-2 mt-1 flex items-start gap-2 text-xs leading-5 text-[var(--muted)] sm:text-sm"><IconLock aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--primary)]" />{copy.secureDirect}</p>
    </section>

    <section aria-labelledby="qr-payment-title" className="rounded-[1.7rem] border border-[var(--border)] bg-white px-4 py-5 shadow-[0_10px_28px_rgba(36,50,58,0.04)] sm:px-7 sm:py-7">
      <h2 id="qr-payment-title" className="text-center text-[1.55rem] font-bold leading-8 text-[var(--foreground)] sm:text-3xl">{copy.cardQrTitle}</h2>
      {qrCodeDataUrl ? <>
        <div className="mx-auto mt-4 w-full max-w-[17rem] rounded-[1.25rem] border border-[#f0e9e1] bg-white p-3 shadow-[0_3px_13px_rgba(36,50,58,0.07)] sm:mt-5">
          <img src={qrCodeDataUrl} alt={locale === "it" ? "QR del pagamento Stripe" : "QR code for Stripe payment"} className="block aspect-square h-auto w-full" />
        </div>
        <p className="mx-auto mt-4 flex max-w-md items-start justify-center gap-3 text-sm leading-6 text-[var(--muted)] sm:text-base">
          <IconDeviceMobile aria-hidden="true" size={23} className="mt-0.5 shrink-0 text-[var(--primary)]" />
          <span>{copy.cardQrHint}</span>
        </p>
        {paymentUrl ? <Link href={paymentUrl} className="mt-5 flex min-h-14 w-full items-center justify-center rounded-full bg-[var(--primary)] px-5 py-3 text-center text-lg font-bold transition-colors hover:bg-[#205449] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" style={{ color: "white" }}>{locale === "it" ? "Apri pagamento" : "Open payment"}</Link> : null}
        <div className="mx-auto mt-5 flex max-w-md items-start gap-3 text-sm leading-6 text-[var(--muted)]">
          <IconClock aria-hidden="true" size={22} className="mt-0.5 shrink-0" />
          <p>{copy.confirmationNotice}</p>
        </div>
      </> : <p className="mt-5 text-sm text-[var(--accent)]">{locale === "it" ? "Pagamento non disponibile. Verifica i dati del titolare e riprova." : "Payment unavailable. Check the owner details and try again."}</p>}
      {failed ? <p className="mt-5 rounded-[1.2rem] bg-[rgba(191,91,42,0.08)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">{copy.failed}</p> : null}
      <CheckoutStatusWatcher copy={{ paid: locale === "it" ? "Pagamento ricevuto. Stiamo aggiornando questa pagina." : "Payment received. We are updating this page.", pending: copy.cardPolling }} submissionId={submissionId} />
    </section>

    <section aria-labelledby="refund-policy-title" className="mt-3 flex items-start gap-3 rounded-[1.45rem] border border-[rgba(42,98,87,0.1)] bg-[#f2f7f3] p-4 sm:mt-4 sm:p-5">
      <IconShieldCheck aria-hidden="true" size={27} className="mt-0.5 shrink-0 text-[#39885a]" />
      <div className="min-w-0">
        <h2 id="refund-policy-title" className="text-lg font-bold leading-6 text-[var(--foreground)]">{locale === "it" ? "Rimborso entro 14 giorni" : "14-day refund policy"}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{copy.refundSummary(amount)}</p>
        <Link href="/terms#refunds" className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2" style={{ color: "var(--primary)" }}>{copy.refundTerms} <span aria-hidden="true">→</span></Link>
      </div>
    </section>

    <aside className="mt-3 flex items-start gap-3 rounded-[1.45rem] border border-[rgba(191,91,42,0.1)] bg-[#fff4ec] p-4 text-sm leading-5 text-[var(--muted-strong)] sm:mt-4 sm:p-5">
      <IconUsersGroup aria-hidden="true" size={23} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <p>{warning}</p>
    </aside>
  </>;
}
