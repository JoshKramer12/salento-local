"use client";

import Link from "next/link";

import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";

type PartnerPayoutHistoryItem = {
  amountCents: number;
  attemptCount: number;
  bankAccountLast4: string | null;
  bankName: string | null;
  commissions: { payment: { stripeLivemode: boolean | null } | null }[];
  failureMessage: string | null;
  id: string;
  initiatedAt: Date;
  paidAt: Date | null;
  payoutMethod: "STRIPE" | "PAYPAL" | "POSTEPAY" | "HYPE";
  providerBatchId: string | null;
  providerReference: string | null;
  status: "ACTION_REQUIRED" | "CANCELED" | "FAILED" | "PAID" | "PROCESSING" | "SCHEDULED";
  updatedAt: Date;
};

type PartnerPayoutSummaryProps = {
  balances: {
    available: number;
    debt: number;
    nextPayoutDate: Date;
    paid: number;
    pending: number;
    totalEarned: number;
  };
  history: PartnerPayoutHistoryItem[];
  locale: Locale;
  payoutsPaused: boolean;
  setup: {
    bankAccountLast4?: string | null;
    bankName?: string | null;
    destinationLast4?: string | null;
    payoutMethod?: "STRIPE" | "PAYPAL" | "POSTEPAY" | "HYPE";
    paypalPayoutEmail?: string | null;
    setupState: "action-required" | "ready" | "restricted" | "setup-incomplete" | "setup-not-started";
  } | null;
};

function getStatusLabel(status: PartnerPayoutHistoryItem["status"], locale: Locale) {
  const labels = {
    ACTION_REQUIRED: locale === "it" ? "Azione richiesta" : "Action required",
    CANCELED: locale === "it" ? "Annullato" : "Canceled",
    FAILED: locale === "it" ? "Non riuscito" : "Failed",
    PAID: locale === "it" ? "Pagato" : "Paid",
    PROCESSING: locale === "it" ? "In elaborazione" : "Processing",
    SCHEDULED: locale === "it" ? "Programmato" : "Scheduled",
  } as const;

  return labels[status];
}

function isPayoutNotSent(entry: PartnerPayoutHistoryItem) {
  return entry.status === "ACTION_REQUIRED" && entry.attemptCount === 0;
}

export function PartnerPayoutSummary({
  balances,
  history,
  locale,
  payoutsPaused,
  setup,
}: PartnerPayoutSummaryProps) {
  const copy =
    locale === "it"
      ? {
          actionRequiredBody:
            "Aggiorna le tue informazioni in modo che Stripe possa continuare a inviarti i pagamenti.",
          actionRequiredTitle: "I tuoi dati pagamento richiedono attenzione",
          available: "Da pagare",
          bankConnected: "Conto collegato",
          emptyHistory: "I tuoi futuri pagamenti appariranno qui.",
          finishBody: "Stripe ha ancora bisogno di alcune informazioni prima di abilitare i pagamenti.",
          finishTitle: "Completa la configurazione dei pagamenti",
          historyTitle: "Storico pagamenti",
          nextPayout: "Prossimo pagamento previsto",
          notStartedBody: "Collega il tuo conto bancario prima di poter ricevere i guadagni.",
          notStartedTitle: "Configura i pagamenti",
          paid: "Pagato",
          pending: "In attesa di approvazione",
          payoutNote:
            "I pagamenti vengono avviati una volta a settimana quando il saldo idoneo raggiunge almeno €50. La banca puo impiegare ancora alcuni giorni lavorativi.",
          readyBody:
            "Il tuo conto bancario e collegato e i tuoi guadagni idonei verranno pagati automaticamente.",
          readyTitle: "I pagamenti sono pronti",
          restrictedBody:
            "Stripe ha bisogno di ulteriori informazioni prima che i pagamenti possano continuare.",
          restrictedTitle: "I pagamenti sono temporaneamente non disponibili",
          review: "Controlla dati pagamento",
          setUp: "Configura i pagamenti",
          title: "Pagamenti partner",
          toBePaid: "Da pagare",
          update: "Aggiorna dati pagamento",
        }
      : {
          actionRequiredBody:
            "Please update your information so Stripe can continue sending your payouts.",
          actionRequiredTitle: "Your payout information needs attention",
          available: "Available",
          bankConnected: "Connected bank",
          emptyHistory: "Your future payouts will appear here.",
          finishBody:
            "Stripe still needs some information before payouts can be enabled.",
          finishTitle: "Finish setting up your payouts",
          historyTitle: "Payout history",
          nextPayout: "Next expected payout",
          notStartedBody: "Connect your bank account before you can receive earnings.",
          notStartedTitle: "Set up your payouts",
          paid: "Paid",
          pending: "Awaiting approval",
          payoutNote:
            "Payouts are initiated once per week when your eligible balance reaches at least €50. Bank settlement can still take additional business days.",
          readyBody:
            "Your bank account is connected and your eligible earnings will be paid automatically.",
          readyTitle: "Payouts are ready",
          restrictedBody:
            "Stripe needs additional information before payouts can continue.",
          restrictedTitle: "Payouts are temporarily unavailable",
          review: "Review payout details",
          setUp: "Set up payouts",
          title: "Partner payouts",
          toBePaid: "To be paid",
          update: "Update payout details",
        };

  const setupState = setup?.setupState ?? "setup-not-started";
  const payoutMethod = setup?.payoutMethod ?? "STRIPE";
  const payoutMethodLabel = {
    STRIPE: "Stripe",
    PAYPAL: "PayPal",
    POSTEPAY: "Postepay",
    HYPE: "HYPE",
  }[payoutMethod];
  const setupCopy =
    payoutsPaused
      ? { body: locale === "it" ? "I pagamenti ai Partner sono temporaneamente sospesi. Le commissioni test e lo storico non verificato non sono pagabili." : "Partner payouts are temporarily paused. Test commissions and unverified history are not payable.", cta: null, title: locale === "it" ? "Pagamenti sospesi" : "Payouts paused" }
      : setupState === "ready"
      ? { body: copy.readyBody, cta: null, title: copy.readyTitle }
      : setupState === "action-required"
        ? { body: copy.actionRequiredBody, cta: copy.update, title: copy.actionRequiredTitle }
        : setupState === "restricted"
          ? { body: copy.restrictedBody, cta: copy.review, title: copy.restrictedTitle }
          : setupState === "setup-incomplete"
            ? { body: copy.finishBody, cta: copy.setUp, title: copy.finishTitle }
            : { body: copy.notStartedBody, cta: copy.setUp, title: copy.notStartedTitle };

  return (
    <section className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <article className="card p-6">
        <p className="section-kicker mb-2">{copy.title}</p>
        <h2 className="font-serif text-3xl text-[var(--foreground)]">{setupCopy.title}</h2>
        <p className="mt-4 max-w-2xl text-[var(--muted)]">{setupCopy.body}</p>
        {setup?.destinationLast4 || setup?.bankAccountLast4 ? (
          <p className="mt-4 text-sm text-[var(--foreground)]">
            {payoutMethodLabel} · {setup.bankName ? `${setup.bankName} ` : ""}•••• {setup.destinationLast4 ?? setup.bankAccountLast4}
          </p>
        ) : null}
        {payoutMethod === "PAYPAL" && setup?.paypalPayoutEmail ? <p className="mt-4 text-sm text-[var(--foreground)]">{payoutMethodLabel} · {setup.paypalPayoutEmail}</p> : null}
        {setupCopy.cta ? (
          <div className="mt-6">
            <Link
              href="/partner/payout"
              className="btn-primary inline-flex w-full justify-center sm:w-auto"
            >
              {setupCopy.cta}
            </Link>
          </div>
        ) : null}
        {setupState === "ready" && !payoutsPaused ? (
          <div className="mt-5">
            <Link href="/partner/payout" className="text-sm font-medium text-[var(--primary)] hover:underline">
              {locale === "it" ? "Cambia metodo di pagamento" : "Change payout method"}
            </Link>
          </div>
        ) : null}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-[1.2rem] bg-[color:rgba(247,244,239,0.62)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
              {copy.toBePaid}
            </p>
            <p className="mt-2 font-serif text-2xl text-[var(--foreground)]">
              {formatCurrencyFromCents(balances.available, locale)}
            </p>
          </div>
          <div className="rounded-[1.2rem] bg-[color:rgba(247,244,239,0.62)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
              {copy.pending}
            </p>
            <p className="mt-2 font-serif text-2xl text-[var(--foreground)]">
              {formatCurrencyFromCents(balances.pending, locale)}
            </p>
          </div>
          <div className="rounded-[1.2rem] bg-[color:rgba(247,244,239,0.62)] px-4 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
              {copy.nextPayout}
            </p>
            <p className="mt-2 text-base font-medium text-[var(--foreground)]">
              {payoutsPaused ? (locale === "it" ? "Temporaneamente sospeso" : "Temporarily paused") : new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                dateStyle: "medium",
              }).format(balances.nextPayoutDate)}
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm leading-7 text-[var(--muted)]">{payoutsPaused ? (locale === "it" ? "Nessun pagamento ai Partner verrà inviato finché i pagamenti sono sospesi." : "No Partner payout will be sent while payouts are paused.") : copy.payoutNote}</p>
      </article>

      <article className="card p-6">
        <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.historyTitle}</h2>
        <div className="mt-5 grid gap-4">
          {history.length ? (
            history.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-[1.4rem] border px-4 py-4 ${
                  isPayoutNotSent(entry)
                    ? "border-[color:rgba(185,28,28,0.28)] bg-[color:rgba(254,242,242,0.82)]"
                    : "border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-[var(--foreground)]">
                    {formatCurrencyFromCents(entry.amountCents, locale)}
                  </p>
                  <p className={`text-sm font-semibold ${isPayoutNotSent(entry) ? "text-[#b91c1c]" : "text-[var(--primary)]"}`}>
                    {isPayoutNotSent(entry)
                      ? locale === "it"
                        ? "Pagamento non inviato"
                        : "Payout not sent"
                      : getStatusLabel(entry.status, locale)}
                  </p>
                </div>
                {!entry.commissions.length || entry.commissions.some((commission) => commission.payment?.stripeLivemode !== true) ? (
                  <p className="mt-1 text-xs font-semibold text-amber-800">
                    {entry.commissions.some((commission) => commission.payment?.stripeLivemode === false)
                      ? (locale === "it" ? "Storico test · Non pagabile" : "Test history · Not payable")
                      : (locale === "it" ? "Storico non verificato · Non pagabile" : "Unverified history · Not payable")}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {entry.payoutMethod} · {" "}
                  {isPayoutNotSent(entry)
                    ? locale === "it"
                      ? "Verificato"
                      : "Checked"
                    : locale === "it"
                      ? "Avviato"
                      : "Initiated"}{" "}
                  {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                    dateStyle: "medium",
                  }).format(entry.initiatedAt)}
                </p>
                {entry.paidAt ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {locale === "it" ? "Pagato" : "Paid"}{" "}
                    {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                      dateStyle: "medium",
                    }).format(entry.paidAt)}
                  </p>
                ) : null}
                {entry.bankAccountLast4 ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {entry.bankName ? `${entry.bankName} ` : ""}•••• {entry.bankAccountLast4}
                  </p>
                ) : null}
                {entry.failureMessage ? (
                  <p className={`mt-2 text-sm ${isPayoutNotSent(entry) ? "font-medium text-[#b91c1c]" : "text-[var(--foreground)]"}`}>{entry.failureMessage}</p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">{copy.emptyHistory}</p>
          )}
        </div>
      </article>
    </section>
  );
}
