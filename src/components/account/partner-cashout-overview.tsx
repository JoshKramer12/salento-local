import Link from "next/link";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";
import type { PartnerWithdrawalDashboard } from "@/lib/partner-withdrawal-dashboard";
import { payoutMethodLabel, withdrawalBlockMessage, withdrawalStatusLabel } from "@/lib/partner-withdrawal-view";

export function PartnerCashoutOverview({ data, locale }: { data: PartnerWithdrawalDashboard; locale: Locale }) {
  const it = locale === "it";
  const date = (value: string) => new Intl.DateTimeFormat(it ? "it-IT" : "en-US", { dateStyle: "medium" }).format(new Date(value));
  return <section className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]" aria-label={it ? "Prelievi partner" : "Partner withdrawals"}>
    <div className="grid gap-5">
      <article className="card p-5 sm:p-7">
        <p className="section-kicker">{it ? "Saldo partner" : "Partner balance"}</p>
        <h2 className="mt-2 text-sm text-[var(--muted)]">{it ? "Disponibile da prelevare" : "Available to withdraw"}</h2>
        <p className="mt-2 font-serif text-4xl text-[var(--foreground)] sm:text-5xl">{formatCurrencyFromCents(data.availableCents, locale)}</p>
        {data.canRequest ? <Link href="/dashboard/earnings/cash-out" className="btn-primary mt-6 inline-flex min-h-12 w-full items-center justify-center text-center sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
          {it ? `Preleva ${formatCurrencyFromCents(data.availableCents, locale)}` : `Cash out ${formatCurrencyFromCents(data.availableCents, locale)}`}
        </Link> : <p className="mt-5 rounded-xl bg-[color:rgba(247,244,239,0.78)] p-4 text-sm leading-6 text-[var(--foreground)]" role="status">
          {data.blockReason ? withdrawalBlockMessage(data.blockReason, locale, formatCurrencyFromCents(data.minimumCents, locale)) : null}
          {data.blockReason === "setup" ? <> <Link className="font-semibold text-[var(--primary)] underline" href="/partner/payout?returnTo=%2Fdashboard%2Fearnings">{it ? "Configura i pagamenti" : "Set up payouts"}</Link></> : null}
        </p>}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[color:rgba(247,244,239,0.62)] p-4"><p className="text-xs text-[var(--muted)]">{it ? "In attesa" : "Pending"}</p><p className="mt-1 font-serif text-xl">{formatCurrencyFromCents(data.pendingCents, locale)}</p></div>
          <div className="rounded-xl bg-[color:rgba(247,244,239,0.62)] p-4"><p className="text-xs text-[var(--muted)]">{it ? "In elaborazione" : "Processing"}</p><p className="mt-1 font-serif text-xl">{formatCurrencyFromCents(data.processingCents, locale)}</p></div>
          <div className="col-span-2 rounded-xl bg-[color:rgba(247,244,239,0.62)] p-4 sm:col-span-1"><p className="text-xs text-[var(--muted)]">{it ? "Pagato netto" : "Net paid out"}</p><p className="mt-1 font-serif text-xl">{formatCurrencyFromCents(data.paidCents, locale)}</p></div>
        </div>
        {data.returnedCents > 0 ? <p className="mt-4 text-sm text-[var(--muted)]">{it ? "Pagamenti lordi" : "Gross payouts"}: {formatCurrencyFromCents(data.grossPaidCents, locale)} · {it ? "Fondi restituiti" : "Returned funds"}: {formatCurrencyFromCents(data.returnedCents, locale)}</p> : null}
        {data.heldCents > 0 || data.debtCents > 0 ? <p className="mt-4 text-sm text-[var(--muted)]">{it ? "Alcuni fondi o guadagni sono in verifica. Gli importi sospesi non sono inclusi nel saldo disponibile." : "Some funds or earnings are under review. Held amounts are excluded from your available balance."}</p> : null}
      </article>
      <article className="card p-5 sm:p-7">
        <h2 className="font-serif text-2xl">{it ? "Guadagni recenti" : "Recent earnings"}</h2>
        {data.recentEarnings.length ? <ul className="mt-4 divide-y divide-[var(--border)]">{data.recentEarnings.map((row) => <li className="flex justify-between gap-3 py-3 text-sm" key={row.id}><span><strong className="block font-medium">{row.businessName}</strong><span className="text-[var(--muted)]">{date(row.date)}</span></span><span className="font-semibold">{formatCurrencyFromCents(row.amountCents, locale)}</span></li>)}</ul> : <p className="mt-4 text-sm text-[var(--muted)]">{it ? "I guadagni confermati appariranno qui." : "Confirmed earnings will appear here."}</p>}
      </article>
    </div>
    <article className="card self-start p-5 sm:p-7">
      <h2 className="font-serif text-2xl">{it ? "Storico prelievi" : "Withdrawal history"}</h2>
      {data.history.length ? <ul className="mt-4 divide-y divide-[var(--border)]">{data.history.map((row) => <li key={row.id} className="py-4 first:pt-0"><div className="flex items-start justify-between gap-3"><span className="font-semibold">{formatCurrencyFromCents(row.amountCents, locale)}</span><span className="rounded-full bg-[color:rgba(39,124,92,0.12)] px-3 py-1 text-xs font-medium text-[#1f6c51]">{withdrawalStatusLabel(row.status, locale)}</span></div><p className="mt-2 text-sm text-[var(--muted)]">{payoutMethodLabel(row.method)} · {row.destinationMasked}</p><p className="mt-1 text-sm text-[var(--muted)]">{it ? "Richiesto" : "Requested"}: {date(row.requestedAt)}</p>{row.settledAt ? <p className="mt-1 text-sm text-[var(--muted)]">{it ? "Pagamento verificato" : "Settlement verified"}: {date(row.settledAt)}</p> : null}{row.returnedCents > 0 ? <p className="mt-1 text-sm text-[var(--muted)]">{it ? "Restituito" : "Returned"}: {formatCurrencyFromCents(row.returnedCents, locale)}</p> : null}{row.needsSupport ? <p className="mt-2 text-sm text-[#9a3412]">{it ? "Questa richiesta richiede una verifica. Contatta l'assistenza se hai bisogno di aggiornamenti." : "This request needs review. Contact support if you need an update."}</p> : null}</li>)}</ul> : <p className="mt-4 text-sm text-[var(--muted)]">{it ? "Le tue richieste di prelievo appariranno qui." : "Your withdrawal requests will appear here."}</p>}
    </article>
  </section>;
}
