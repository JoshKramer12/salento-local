"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cancelCashoutRequest, submitCashoutRequest } from "@/app/(account)/dashboard/earnings/cashout-actions";
import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";
import { cashoutBlockReason } from "@/lib/partner-cashout-presenter";
import type { CashoutHistoryItem, CashoutView } from "@/lib/partner-cashout-view";

const wording = {
  en: {
    title: "Your earnings", gross: "Total earned before refunds", grossNote: "Historical live commissions; refund adjustments are shown separately.",
    available: "Available to cash out", pending: "Pending earnings", reserved: "Processing / reserved", paid: "Previously paid out",
    debt: "Outstanding refund adjustment", debtBody: "An approved refund reversed a previous commission. Future eligible earnings will offset this amount. Your bank account is not charged.",
    excluded: "Test and unverified activity cannot be cashed out", test: "Test activity", unverified: "Unverified history",
    cashout: "Cash Out", paused: "Cash Out is temporarily unavailable.", active: "You already have a withdrawal in progress.",
    review: "A previous payout needs review before another request.", debtBlock: "An outstanding refund adjustment must be resolved first.",
    destinationBlock: "Connect a Stripe payout account to continue.", pendingBlock: "Your commissions are still within the holding period or awaiting review.",
    minimumBlock: "You need at least €50 to cash out.", payoutAccount: "Stripe Connect payout account", connected: "Bank account ending in", notConnected: "Setup incomplete",
    manage: "Manage payout account", reviewTitle: "Cash Out", reviewIntro: "Review your withdrawal details before submitting your request.",
    amount: "Full available amount", destination: "Payout destination", minimum: "Minimum", fees: "The final bank deposit may vary if provider or bank fees apply.",
    processing: "Your withdrawal will be processed automatically through your connected payout account. You can track its status in your earnings history.",
    confirm: "Confirm Cash Out Request", cancel: "Cancel", submitting: "Submitting…", stale: "Your available balance changed. Review the updated amount, then confirm again.",
    reviewUpdated: "Review updated amount", network: "We could not confirm the result. Retry using the same request reference.",
    unavailable: "Cash Out is currently unavailable. Refresh to see the latest status.", success: "Cash Out request submitted", requestReference: "Request reference",
    currentStatus: "Current status", viewHistory: "View withdrawal history", close: "Close", history: "Withdrawal history", empty: "No withdrawal requests yet.",
    requested: "Requested", processingStatus: "Processing", paidStatus: "Paid", canceled: "Canceled", actionRequired: "Action required", failed: "Failed",
    verifying: "We're verifying the status of this payout.", requestDate: "Requested", completionDate: "Completed", cancelRequest: "Cancel request",
    cancelQuestion: "Cancel this withdrawal request? The reserved amount will return to your available balance if it remains eligible.",
    cancelNoLonger: "Processing has started, so this request can no longer be canceled.", cancelError: "Cancellation could not be completed. Refresh and try again.",
    older: "Earlier payouts", olderNote: "These payouts were initiated before Partner Cash Out and are shown separately.",
    previous: "Previous", next: "Next", seeAll: "See all withdrawals", method: "Method", status: "Status",
  },
  it: {
    title: "I tuoi guadagni", gross: "Guadagni totali prima dei rimborsi", grossNote: "Commissioni live storiche; le rettifiche per rimborso sono indicate a parte.",
    available: "Disponibile per il pagamento", pending: "Guadagni in attesa", reserved: "In elaborazione / riservato", paid: "Già pagato",
    debt: "Rettifica per rimborso in sospeso", debtBody: "Un rimborso approvato ha annullato una commissione precedente. I prossimi guadagni idonei compenseranno questo importo. Non verrà addebitato il tuo conto bancario.",
    excluded: "Le attività test e lo storico non verificato non sono pagabili", test: "Attività test", unverified: "Storico non verificato",
    cashout: "Richiedi pagamento", paused: "La richiesta di pagamento non è temporaneamente disponibile.", active: "Hai già una richiesta di pagamento in corso.",
    review: "Un pagamento precedente richiede una verifica prima di una nuova richiesta.", debtBlock: "Prima è necessario risolvere una rettifica per rimborso in sospeso.",
    destinationBlock: "Collega un conto Stripe per ricevere i pagamenti.", pendingBlock: "Le tue commissioni sono ancora nel periodo di attesa o in verifica.",
    minimumBlock: "Servono almeno €50 per richiedere il pagamento.", payoutAccount: "Conto pagamenti Stripe Connect", connected: "Conto bancario che termina con", notConnected: "Configurazione incompleta",
    manage: "Gestisci il conto per i pagamenti", reviewTitle: "Richiedi pagamento", reviewIntro: "Controlla i dettagli prima di inviare la richiesta.",
    amount: "Intero importo disponibile", destination: "Destinazione del pagamento", minimum: "Minimo", fees: "L'importo accreditato in banca potrebbe variare in caso di commissioni del gestore o della banca.",
    processing: "La richiesta sarà elaborata automaticamente tramite il conto collegato. Potrai seguirne lo stato nello storico dei guadagni.",
    confirm: "Conferma richiesta di pagamento", cancel: "Annulla", submitting: "Invio in corso…", stale: "Il saldo disponibile è cambiato. Controlla il nuovo importo e conferma di nuovo.",
    reviewUpdated: "Controlla il nuovo importo", network: "Non siamo riusciti a confermare l'esito. Riprova con lo stesso riferimento della richiesta.",
    unavailable: "La richiesta di pagamento non è disponibile. Aggiorna la pagina per vedere lo stato attuale.", success: "Richiesta di pagamento inviata", requestReference: "Riferimento richiesta",
    currentStatus: "Stato attuale", viewHistory: "Vedi lo storico dei pagamenti richiesti", close: "Chiudi", history: "Storico dei pagamenti richiesti", empty: "Non hai ancora richieste di pagamento.",
    requested: "Richiesto", processingStatus: "In elaborazione", paidStatus: "Pagato", canceled: "Annullato", actionRequired: "Azione richiesta", failed: "Non riuscito",
    verifying: "Stiamo verificando lo stato di questo pagamento.", requestDate: "Richiesto il", completionDate: "Completato il", cancelRequest: "Annulla richiesta",
    cancelQuestion: "Annullare questa richiesta? L'importo riservato tornerà disponibile se ancora idoneo.",
    cancelNoLonger: "L'elaborazione è iniziata, quindi la richiesta non può più essere annullata.", cancelError: "Impossibile annullare la richiesta. Aggiorna la pagina e riprova.",
    older: "Pagamenti precedenti", olderNote: "Questi pagamenti sono stati avviati prima delle richieste Partner e sono mostrati separatamente.",
    previous: "Precedente", next: "Successiva", seeAll: "Vedi tutte le richieste", method: "Metodo", status: "Stato",
  },
} as const;

function statusLabel(status: string, locale: Locale) {
  const t = wording[locale];
  if (status === "REQUESTED" || status === "READY_FOR_PROCESSING") return t.requested;
  if (status === "PROCESSING") return t.processingStatus;
  if (status === "PAID") return t.paidStatus;
  if (status === "CANCELED") return t.canceled;
  if (status === "OUTCOME_UNKNOWN") return t.verifying;
  if (status === "ACTION_REQUIRED") return t.actionRequired;
  return t.failed;
}

function date(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "medium" }).format(new Date(value));
}

export function PartnerCashoutPanel({ view, locale, compact = false, preview = false }: {
  view: CashoutView; locale: Locale; compact?: boolean; preview?: boolean;
}) {
  const t = wording[locale];
  const router = useRouter();
  const [dialog, setDialog] = useState<"review" | "success" | null>(null);
  const [reviewedAmount, setReviewedAmount] = useState(view.availableCents);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState<{ id: string; amountCents: number; status: string; destinationLast4: string | null } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [previewCanceledIds, setPreviewCanceledIds] = useState<string[]>([]);
  const submitLock = useRef(false);
  const keyRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const blocker = cashoutBlockReason(view);
  const blockMessage = blocker === "paused" ? t.paused : blocker === "active" ? t.active : blocker === "review" ? t.review :
    blocker === "debt" ? t.debtBlock : blocker === "destination" ? t.destinationBlock : blocker === "pending" ? t.pendingBlock : blocker === "minimum" ? t.minimumBlock : "";

  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault(); focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault(); focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); };
  }, [dialog, busy]);

  function openReview() {
    if (blocker) return;
    setReviewedAmount(view.availableCents);
    setStale(false); setMessage("");
    keyRef.current ??= sessionStorage.getItem("partner-cashout-request-key") || crypto.randomUUID();
    sessionStorage.setItem("partner-cashout-request-key", keyRef.current);
    setDialog("review");
  }

  async function confirmRequest() {
    if (submitLock.current || busy || reviewedAmount < view.minimumCents) return;
    if (stale) { setStale(false); setMessage(""); return; }
    submitLock.current = true; setBusy(true); setMessage("");
    try {
      const result = preview
        ? { kind: "submitted" as const, id: "preview-request", amountCents: reviewedAmount, status: "REQUESTED", destinationLast4: view.destinationLast4 }
        : await submitCashoutRequest(keyRef.current!, reviewedAmount);
      if (result.kind === "submitted") {
        setSuccess(result); setDialog("success");
        keyRef.current = null; sessionStorage.removeItem("partner-cashout-request-key");
        if (!preview) router.refresh();
      } else if (result.kind === "changed") {
        if (result.newKey) {
          keyRef.current = crypto.randomUUID();
          sessionStorage.setItem("partner-cashout-request-key", keyRef.current);
        }
        setReviewedAmount(result.availableCents); setStale(true); setMessage(t.stale);
        if (!preview) router.refresh();
      } else setMessage(t.unavailable);
    } catch { setMessage(t.network); }
    finally { submitLock.current = false; setBusy(false); }
  }

  async function cancelRequest(item: CashoutHistoryItem) {
    if (!item.canCancel || busy || cancellingId) return;
    if (!window.confirm(t.cancelQuestion)) return;
    setCancellingId(item.id); setMessage("");
    try {
      const result = preview ? { kind: "canceled" as const } : await cancelCashoutRequest(item.id);
      if (result.kind === "canceled") {
        if (preview) setPreviewCanceledIds((ids) => [...ids, item.id]);
        else router.refresh();
      } else setMessage(result.kind === "processing" ? t.cancelNoLonger : t.cancelError);
    } catch { setMessage(t.cancelError); }
    finally { setCancellingId(null); }
  }

  const history = view.history.map((item) => previewCanceledIds.includes(item.id)
    ? { ...item, status: "CANCELED", canCancel: false } : item);
  const visibleHistory = compact ? history.slice(0, 3) : history;
  return <section className="min-w-0 space-y-5" aria-label={t.title}>
    <div className="card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="section-kicker">{t.title}</p>
          <h2 className="mt-2 font-serif text-2xl text-[var(--foreground)] sm:text-3xl">{t.available}</h2>
          <p className="mt-3 break-words font-serif text-4xl leading-tight text-[var(--primary)] sm:text-5xl">{formatCurrencyFromCents(view.availableCents, locale)}</p>
          <p className="mt-3 text-sm text-[var(--muted)]">{t.minimum}: {formatCurrencyFromCents(view.minimumCents, locale)}</p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:max-w-xs">
          <button type="button" className="btn-primary min-h-12 w-full px-6 disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(blocker)} onClick={openReview}>{t.cashout}</button>
          {blockMessage ? <p className="text-sm leading-6 text-[var(--muted)]" role="status">{blockMessage}</p> : null}
        </div>
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-6 sm:grid-cols-4">
        {[[t.gross, view.grossEarnedCents], [t.pending, view.pendingCents], [t.reserved, view.reservedCents], [t.paid, view.paidCents]].map(([label, amount]) =>
          <div key={label} className="min-w-0 rounded-2xl bg-[color:rgba(247,244,239,0.72)] p-3 sm:p-4"><p className="text-xs leading-5 text-[var(--muted)]">{label}</p><p className="mt-2 break-words text-lg font-semibold text-[var(--foreground)] sm:text-xl">{formatCurrencyFromCents(Number(amount), locale)}</p></div>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t.grossNote}</p>
      {view.debtCents > 0 ? <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><p className="font-semibold">{t.debt}: {formatCurrencyFromCents(view.debtCents, locale)}</p><p className="mt-2 text-sm leading-6">{t.debtBody}</p></div> : null}
      <p className="mt-5 text-xs leading-5 text-[var(--muted)]">{t.excluded}: {t.test} {formatCurrencyFromCents(view.testCents, locale)} · {t.unverified} {formatCurrencyFromCents(view.unverifiedCents, locale)}</p>
    </div>

    <div className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-serif text-2xl text-[var(--foreground)]">{t.payoutAccount}</h2><p className="mt-2 text-sm text-[var(--muted)]">{view.destinationReady ? `${view.bankName ? `${view.bankName} · ` : ""}${t.connected} •••• ${view.destinationLast4 ?? "—"}` : t.notConnected}</p></div><Link href="/partner/payout" className="text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline">{t.manage}</Link></div>
    </div>

    <div className="card p-5 sm:p-7" id="cashout-history">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-2xl text-[var(--foreground)]">{t.history}</h2>{compact ? <Link href="/dashboard/earnings#cashout-history" className="text-sm font-semibold text-[var(--primary)] hover:underline">{t.seeAll}</Link> : null}</div>
      {message && !dialog ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950" role="alert">{message}</p> : null}
      {visibleHistory.length ? <div className="mt-5 space-y-3">{visibleHistory.map((item) =>
        <article key={item.id} className="min-w-0 rounded-2xl border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-[var(--foreground)]">{formatCurrencyFromCents(item.amountCents, locale)}</p><p className="mt-1 text-xs text-[var(--muted)]">{t.requestDate}: {date(item.requestedAt, locale)}</p></div><span className="max-w-full rounded-full bg-[color:rgba(39,124,92,0.12)] px-3 py-1 text-xs font-semibold text-[#1f6c51] break-words">{statusLabel(item.status, locale)}</span></div>
          <p className="mt-2 text-sm text-[var(--muted)]">Stripe Connect{item.destinationLast4 ? ` · •••• ${item.destinationLast4}` : ""}</p>
          {item.completedAt ? <p className="mt-1 text-xs text-[var(--muted)]">{t.completionDate}: {date(item.completedAt, locale)}</p> : null}
          {item.canCancel ? <button type="button" className="mt-3 min-h-11 text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline disabled:opacity-50" disabled={Boolean(cancellingId)} onClick={() => void cancelRequest(item)}>{t.cancelRequest}</button> : null}
        </article>)}
      </div> : <p className="mt-5 text-sm text-[var(--muted)]">{t.empty}</p>}
      {!compact && (view.page > 1 || view.hasMore) ? <nav className="mt-5 flex gap-3" aria-label={t.history}>{view.page > 1 ? <Link className="btn-secondary min-h-11" href={`/dashboard/earnings?cashoutPage=${view.page - 1}#cashout-history`}>{t.previous}</Link> : null}{view.hasMore ? <Link className="btn-secondary min-h-11" href={`/dashboard/earnings?cashoutPage=${view.page + 1}#cashout-history`}>{t.next}</Link> : null}</nav> : null}
    </div>

    {!compact && view.legacyHistory.length ? <div className="card p-5 sm:p-7"><h2 className="font-serif text-2xl">{t.older}</h2><p className="mt-2 text-sm text-[var(--muted)]">{t.olderNote}</p><div className="mt-4 space-y-3">{view.legacyHistory.map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"><span>{formatCurrencyFromCents(item.amountCents, locale)} · {item.method}</span><span>{statusLabel(item.status, locale)} · {date(item.initiatedAt, locale)}</span></div>)}</div></div> : null}

    {dialog ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cashout-dialog-title" tabIndex={-1} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl sm:p-7">
        <h2 id="cashout-dialog-title" className="font-serif text-3xl text-[var(--foreground)]">{dialog === "success" ? t.success : t.reviewTitle}</h2>
        {dialog === "success" && success ? <div className="mt-5 space-y-3 text-sm"><p className="text-3xl font-semibold text-[var(--primary)]">{formatCurrencyFromCents(success.amountCents, locale)}</p><p>{t.requestReference}: <span className="break-all font-mono">{success.id}</span></p><p>{t.currentStatus}: {statusLabel(success.status, locale)}</p><p>Stripe Connect{success.destinationLast4 ? ` · •••• ${success.destinationLast4}` : ""}</p><div className="flex flex-wrap gap-3 pt-3"><Link href="/dashboard/earnings#cashout-history" className="btn-primary min-h-12" onClick={() => setDialog(null)}>{t.viewHistory}</Link><button type="button" className="btn-secondary min-h-12" onClick={() => setDialog(null)}>{t.close}</button></div></div> : <div className="mt-4 space-y-4 text-sm">
          <p className="text-[var(--muted)]">{t.reviewIntro}</p>
          <div className="rounded-2xl bg-[color:rgba(247,244,239,0.72)] p-4"><p className="text-xs text-[var(--muted)]">{t.amount}</p><p className="mt-1 break-words font-serif text-4xl text-[var(--primary)]">{formatCurrencyFromCents(reviewedAmount, locale)}</p></div>
          <div><p className="font-semibold">{t.destination}</p><p className="mt-1 text-[var(--muted)]">Stripe Connect{view.bankName ? ` · ${view.bankName}` : ""}{view.destinationLast4 ? ` · ${t.connected} •••• ${view.destinationLast4}` : ""}</p></div>
          <p>{t.minimum}: {formatCurrencyFromCents(view.minimumCents, locale)}</p><p className="leading-6 text-[var(--muted)]">{t.fees}</p><p className="leading-6 text-[var(--muted)]">{t.processing}</p>
          {message ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-amber-950">{message}</p> : null}
          <div className="flex flex-col gap-3 pt-2 sm:flex-row-reverse"><button type="button" className="btn-primary min-h-12 w-full disabled:opacity-50" disabled={busy || reviewedAmount < view.minimumCents} onClick={() => void confirmRequest()}>{busy ? t.submitting : stale ? t.reviewUpdated : t.confirm}</button><button type="button" className="btn-secondary min-h-12 w-full" disabled={busy} onClick={() => setDialog(null)}>{t.cancel}</button></div>
        </div>}
      </div>
    </div> : null}
  </section>;
}
