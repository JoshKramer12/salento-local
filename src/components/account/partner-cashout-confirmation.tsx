"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";
import type { PartnerWithdrawalDashboard } from "@/lib/partner-withdrawal-dashboard";
import { createWithdrawalIdempotencyKey, recoverAcceptedWithdrawal } from "@/lib/partner-withdrawal-recovery";
import { payoutMethodLabel, withdrawalBlockMessage, withdrawalErrorMessage, withdrawalStatusLabel } from "@/lib/partner-withdrawal-view";

const storageKey = "salento-partner-cashout-idempotency";

export function PartnerCashoutConfirmation({ initialData, locale }: { initialData: PartnerWithdrawalDashboard; locale: Locale }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const it = locale === "it";

  async function refreshSnapshot() {
    const response = await fetch("/api/partner/withdrawals", { cache: "no-store" });
    if (!response.ok) throw new Error("snapshot_unavailable");
    const next = await response.json() as PartnerWithdrawalDashboard;
    setData(next);
    router.refresh();
    return next;
  }

  async function submit() {
    if (busyRef.current || !data.canRequest) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const key = sessionStorage.getItem(storageKey) || createWithdrawalIdempotencyKey(crypto.randomUUID());
    sessionStorage.setItem(storageKey, key);
    try {
      const response = await fetch("/api/partner/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: key }) });
      const result = await response.json() as { id?: string; error?: string };
      if (response.ok && result.id) {
        setAcceptedId(result.id);
        sessionStorage.removeItem(storageKey);
        await refreshSnapshot().catch(() => undefined);
      } else {
        const next = await refreshSnapshot().catch(() => null);
        const recovered = next && recoverAcceptedWithdrawal(next, key);
        if (recovered) { setAcceptedId(recovered.id); sessionStorage.removeItem(storageKey); }
        else setError(withdrawalErrorMessage(result.error ?? "unknown", locale));
      }
    } catch {
      const next = await refreshSnapshot().catch(() => null);
      const recovered = next && recoverAcceptedWithdrawal(next, key);
      if (recovered) { setAcceptedId(recovered.id); sessionStorage.removeItem(storageKey); }
      else setError(it ? "Connessione interrotta. Riprova: useremo la stessa richiesta per evitare duplicati." : "Connection interrupted. Retry safely; we will use the same request to avoid duplicates.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  const accepted = data.history.find((row) => row.id === acceptedId);
  return <main className="shell px-4 py-10 sm:px-6 sm:py-14"><section className="card withdrawal-actions mx-auto max-w-2xl p-5 sm:p-8" aria-live="polite">
    {acceptedId ? <>
      <p className="section-kicker">{it ? "Richiesta ricevuta" : "Request received"}</p>
      <h1 className="mt-2 font-serif text-4xl">{it ? "Prelievo richiesto" : "Withdrawal requested"}</h1>
      <p className="mt-4 leading-7 text-[var(--muted)]">{it ? "La tua richiesta è stata registrata. I fondi sono in elaborazione; il pagamento non è ancora confermato." : "Your request has been recorded. The funds are processing; payment has not yet been confirmed."}</p>
      {accepted ? <p className="mt-4 text-sm">{formatCurrencyFromCents(accepted.amountCents, locale)} · {withdrawalStatusLabel(accepted.status, locale)}</p> : null}
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-[color:rgba(247,244,239,0.62)] p-4">{it ? "Disponibile" : "Available"}<strong className="mt-1 block font-serif text-xl">{formatCurrencyFromCents(data.availableCents, locale)}</strong></div><div className="rounded-xl bg-[color:rgba(247,244,239,0.62)] p-4">{it ? "In elaborazione" : "Processing"}<strong className="mt-1 block font-serif text-xl">{formatCurrencyFromCents(data.processingCents, locale)}</strong></div></div>
      <Link className="btn-primary mt-6 inline-flex w-full justify-center sm:w-auto" href="/dashboard/earnings">{it ? "Vedi guadagni e storico" : "View earnings and history"}</Link>
    </> : <>
      <p className="section-kicker">{it ? "Conferma prelievo" : "Confirm withdrawal"}</p>
      <h1 className="mt-2 font-serif text-4xl">{it ? "Preleva il saldo disponibile" : "Withdraw available balance"}</h1>
      <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{it ? "La richiesta include l'intero saldo disponibile. L'importo e la destinazione saranno verificati nuovamente sul server." : "This request includes your full available balance. The server will verify the amount and destination again."}</p>
      <dl className="mt-7 grid gap-3 rounded-2xl bg-[color:rgba(247,244,239,0.62)] p-5 text-sm"><div className="flex justify-between gap-3"><dt>{it ? "Importo" : "Amount"}</dt><dd className="font-semibold">{formatCurrencyFromCents(data.availableCents, locale)}</dd></div><div className="flex justify-between gap-3"><dt>{it ? "Metodo" : "Method"}</dt><dd>{payoutMethodLabel(data.method)}</dd></div><div className="flex justify-between gap-3"><dt>{it ? "Destinazione" : "Destination"}</dt><dd>{data.destinationMasked}</dd></div></dl>
      <p className="mt-5 text-sm leading-6 text-[var(--muted)]">{it ? "Dopo la conferma, la richiesta sarà elaborata. Riceverai un aggiornamento quando il pagamento sarà verificato; non è prevista una data fissa di arrivo." : "After confirmation, your request will be processed. The payment status will update when settlement is verified; there is no fixed arrival date."}</p>
      {data.blockReason ? <p className="mt-5 text-sm text-[#9a3412]" role="status">{withdrawalBlockMessage(data.blockReason, locale, formatCurrencyFromCents(data.minimumCents, locale))}{data.blockReason === "setup" ? <> <Link href="/partner/payout?returnTo=%2Fdashboard%2Fearnings%2Fcash-out" className="font-semibold underline">{it ? "Configura i pagamenti" : "Set up payouts"}</Link></> : null}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
      <div className="mt-7 grid gap-3 sm:grid-cols-2"><button type="button" disabled={!data.canRequest || busy} onClick={submit} className="btn-primary min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">{busy ? it ? "Invio in corso…" : "Submitting…" : it ? "Conferma prelievo" : "Confirm cash out"}</button><Link href="/dashboard/earnings" className="btn-secondary min-h-12 inline-flex items-center justify-center">{it ? "Indietro" : "Back"}</Link></div>
    </>}
  </section></main>;
}
