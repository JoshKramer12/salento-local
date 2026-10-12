"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PartnerPayoutMethod, PartnerWithdrawalStatus } from "@prisma/client";
import type { Locale } from "@/lib/i18n";
import { availableWithdrawalAdminActions, payoutMethodLabel, withdrawalErrorMessage } from "@/lib/partner-withdrawal-view";

type Props = { id: string; locale: Locale; method: PartnerPayoutMethod; status: PartnerWithdrawalStatus;
  dispatchStarted: boolean; manualInitiated: boolean; processingEnabled: boolean; reconciliationEnabled: boolean;
  canContinueStripe: boolean; needsPaypalBatch: boolean; returnRecorded: boolean; amountCents: number };

export function AdminWithdrawalActions({ id, locale, method, status, dispatchStarted, manualInitiated,
  processingEnabled, reconciliationEnabled, canContinueStripe, needsPaypalBatch, returnRecorded, amountCents }: Props) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [iban, setIban] = useState("");
  const [reference, setReference] = useState("");
  const [bankName, setBankName] = useState("");
  const [evidence, setEvidence] = useState("");
  const [cancelEvidence, setCancelEvidence] = useState("");
  const [returnReference, setReturnReference] = useState("");
  const [paypalBatchId, setPaypalBatchId] = useState("");
  const [verifiedReturned, setVerifiedReturned] = useState(false);
  const [confirmedReceived, setConfirmedReceived] = useState(false);
  const [outcome, setOutcome] = useState<"UNCERTAIN" | "FAILED" | "RETURNED">("UNCERTAIN");
  const it = locale === "it";
  const { manual, process: mayProcess, reconcile: mayReconcile, recordTransfer: mayRecord,
    settleOrFlag: maySettle, cancelUnsent: mayCancel, flagAfterSettlement } = availableWithdrawalAdminActions(method, status, dispatchStarted, manualInitiated);

  async function act(action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (busyRef.current || !(action === "process" || action === "continue-stripe-payout" ? processingEnabled : reconciliationEnabled || action === "reveal-bank-destination")) return;
    if (confirmText && !window.confirm(confirmText)) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/internal/partner-withdrawals/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
      });
      const result = await response.json() as { error?: string; iban?: string; status?: string };
      if (!response.ok) { setError(withdrawalErrorMessage(result.error ?? "unknown", locale)); return; }
      if (action === "reveal-bank-destination") {
        setIban(result.iban ?? "");
        setNotice(it ? "Accesso ai dettagli bancari registrato." : "Bank detail access was recorded.");
      } else {
        setIban(""); setEvidence(""); setReference(""); setConfirmedReceived(false);
        setNotice(it ? "Operazione registrata. Controlla lo stato aggiornato." : "Action recorded. Review the updated status.");
        router.refresh();
      }
    } catch { setError(it ? "Connessione interrotta. Controlla lo stato prima di riprovare." : "Connection interrupted. Check the status before retrying."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!processingEnabled && !reconciliationEnabled) return <p className="rounded-xl bg-[color:rgba(247,244,239,0.78)] p-4 text-sm" role="status">{it ? "Elaborazione e riconciliazione disattivate. Le azioni finanziarie non sono disponibili." : "Processing and reconciliation are disabled. Financial actions are unavailable."}</p>;

  return <section className="card withdrawal-actions p-5 sm:p-7" aria-label={it ? "Azioni prelievo" : "Withdrawal actions"}>
    <h2 className="font-serif text-2xl">{it ? "Gestisci richiesta" : "Manage request"}</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">{payoutMethodLabel(method)} · {it ? "Verifica stato e dettagli prima di agire." : "Verify the status and details before acting."}</p>
    {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p> : null}
    {notice ? <p className="mt-4 rounded-xl bg-[color:rgba(39,124,92,0.12)] p-3 text-sm text-[#1f6c51]" role="status">{notice}</p> : null}
    <div className="mt-5 grid gap-3">
      {mayProcess && processingEnabled ? <button type="button" disabled={busy} className="btn-primary min-h-11 w-full sm:w-auto disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]" onClick={() => act("process", {}, it ? `Confermi l'avvio dell'elaborazione tramite ${payoutMethodLabel(method)}?` : `Start ${payoutMethodLabel(method)} processing for this withdrawal?`)}>{busy ? it ? "Attendi…" : "Please wait…" : manual ? it ? "Segna in elaborazione" : "Mark as processing" : it ? "Avvia elaborazione provider" : "Start provider processing"}</button> : null}
      {mayReconcile && reconciliationEnabled ? <button type="button" disabled={busy} className="btn-secondary min-h-11 w-full sm:w-auto disabled:opacity-50" onClick={() => act("reconcile")}>{it ? "Verifica stato provider" : "Reconcile provider status"}</button> : null}
      {canContinueStripe && processingEnabled && reconciliationEnabled ? <button type="button" disabled={busy} className="btn-primary min-h-11 w-full sm:w-auto disabled:opacity-50" onClick={() => act("continue-stripe-payout", {}, it ? "Confermi la creazione del payout dal trasferimento Stripe già registrato, dopo la verifica del provider?" : "Create the payout from the existing recorded Stripe transfer after provider verification?")}>{it ? "Continua payout Stripe esistente" : "Continue existing Stripe payout"}</button> : null}
      {needsPaypalBatch && reconciliationEnabled ? <form className="grid gap-3 rounded-xl border border-[var(--border)] p-4" onSubmit={(event) => { event.preventDefault(); void act("attach-paypal-batch", { batchId: paypalBatchId }, it ? "Confermi il riferimento del batch PayPal dopo la verifica dei dati del provider?" : "Attach this PayPal batch after checking the provider record?"); }}><p className="text-sm font-semibold">{it ? "Collega batch PayPal esistente" : "Attach existing PayPal batch"}</p><p className="text-sm text-[var(--muted)]">{it ? "Inserisci l'ID del batch trovato nel provider. Il server verifica destinatario, importo e chiavi; non invia un nuovo pagamento." : "Enter the batch ID found at PayPal. The server checks recipient, amount, and keys; it does not send a new payment."}</p><label className="text-sm">{it ? "ID batch PayPal" : "PayPal batch ID"}<input required minLength={6} maxLength={128} value={paypalBatchId} onChange={(event) => setPaypalBatchId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label><button disabled={busy} className="btn-secondary min-h-11 disabled:opacity-50">{it ? "Verifica e collega batch" : "Verify and attach batch"}</button></form> : null}
      {manual ? <button type="button" disabled={busy} className="btn-secondary min-h-11 w-full sm:w-auto disabled:opacity-50" onClick={() => iban ? setIban("") : act("reveal-bank-destination")}>{iban ? it ? "Nascondi dettagli bancari" : "Hide bank details" : it ? "Visualizza dati bancari" : "View bank details"}</button> : null}
      {iban ? <p className="rounded-xl border border-[var(--border)] bg-white p-4 text-sm"><span className="block font-semibold">IBAN · {it ? "solo per il bonifico esterno" : "for the external bank transfer only"}</span><span className="mt-2 block break-all font-mono">{iban}</span></p> : null}
      {mayRecord && reconciliationEnabled ? <form className="grid gap-3 rounded-xl border border-[var(--border)] p-4" onSubmit={(event) => { event.preventDefault(); void act("manual-initiated", { reference, bankName }, it ? "Confermi che il bonifico è stato inviato fuori dal sito?" : "Confirm that the bank transfer was sent outside this site?"); }}><p className="text-sm font-semibold">{it ? "Registra bonifico esterno" : "Record external bank transfer"}</p><p className="text-sm text-[var(--muted)]">{it ? "Il sito non invia il bonifico. Usa il tuo conto bancario e registra qui il riferimento." : "This site does not send the transfer. Use your bank account, then record its reference here."}</p><label className="text-sm">{it ? "Riferimento bonifico" : "Transfer reference"}<input required minLength={6} maxLength={160} value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label><label className="text-sm">{it ? "Nome banca" : "Bank name"}<input required minLength={2} maxLength={120} value={bankName} onChange={(event) => setBankName(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label><button disabled={busy} className="btn-primary min-h-11 disabled:opacity-50">{it ? "Registra bonifico" : "Record transfer"}</button></form> : null}
      {maySettle && reconciliationEnabled ? <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4"><p className="text-sm font-semibold">{it ? "Esito e riconciliazione" : "Settlement and reconciliation"}</p><label className="text-sm">{it ? "Prova documentale o riferimento della verifica" : "Evidence or verification reference"}<textarea required minLength={20} maxLength={2000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedReceived} onChange={(event) => setConfirmedReceived(event.target.checked)} className="mt-1" />{it ? "Confermo che il regolamento del bonifico è stato verificato." : "I confirm that bank transfer settlement was verified."}</label><button type="button" disabled={busy || !confirmedReceived || evidence.trim().length < 20} className="btn-primary min-h-11 disabled:opacity-50" onClick={() => act("manual-settled", { evidence, confirmedReceived: true }, it ? "Confermi il pagamento dopo aver verificato il regolamento?" : "Mark paid after verifying settlement?")}>{it ? "Conferma pagamento verificato" : "Confirm verified settlement"}</button><label className="text-sm">{it ? "Esito eccezionale" : "Exception outcome"}<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3"><option value="UNCERTAIN">{it ? "Incerto" : "Uncertain"}</option><option value="FAILED">{it ? "Non riuscito" : "Failed"}</option><option value="RETURNED">{it ? "Restituito" : "Returned"}</option></select></label><button type="button" disabled={busy || evidence.trim().length < 20} className="btn-secondary min-h-11 disabled:opacity-50" onClick={() => act("manual-exception", { outcome, evidence }, it ? "Confermi la registrazione di questo esito?" : "Record this exception outcome?")}>{it ? "Registra eccezione" : "Record exception"}</button></div> : null}
      {flagAfterSettlement && reconciliationEnabled && !returnRecorded ? <form className="grid gap-3 rounded-xl border border-[var(--border)] p-4" onSubmit={(event) => { event.preventDefault(); void act("verified-bank-return", { bankReturnReference: returnReference, amountCents, evidence, verifiedReturned }, it ? "Confermi che la banca ha restituito l’intero importo e che la prova è verificata?" : "Confirm that the bank returned the full amount and the evidence was verified?"); }}>
        <p className="text-sm font-semibold">{it ? "Registra restituzione verificata" : "Record verified bank return"}</p>
        <p className="text-sm text-[var(--muted)]">{it ? "Lo storico pagato resta invariato. La rettifica contabile richiede una revisione separata." : "Paid history stays intact. Accounting correction requires separate review."}</p>
        <label className="text-sm">{it ? "Riferimento restituzione bancaria" : "Bank return reference"}<input required minLength={6} maxLength={160} value={returnReference} onChange={(event) => setReturnReference(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label>
        <label className="text-sm">{it ? "Prova della restituzione" : "Return evidence"}<textarea required minLength={20} maxLength={2000} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verifiedReturned} onChange={(event) => setVerifiedReturned(event.target.checked)} className="mt-1" />{it ? "Confermo il riaccredito bancario verificato dell’intero importo." : "I verified the bank return of the full amount."}</label>
        <button disabled={busy || !verifiedReturned || returnReference.trim().length < 6 || evidence.trim().length < 20} className="btn-secondary min-h-11 disabled:opacity-50">{it ? "Registra restituzione" : "Record bank return"}</button>
      </form> : null}
      {flagAfterSettlement && returnRecorded ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{it ? "Restituzione già registrata; revisione contabile in sospeso." : "Return already recorded; accounting review is pending."}</p> : null}
      {mayCancel && reconciliationEnabled ? <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4"><p className="text-sm font-semibold">{it ? "Annulla solo se il bonifico non è stato inviato" : "Cancel only if no transfer was sent"}</p><label className="text-sm">{it ? "Conferma documentata del mancato invio" : "Documented confirmation that no transfer was sent"}<textarea minLength={20} maxLength={2000} rows={2} value={cancelEvidence} onChange={(event) => setCancelEvidence(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] p-3" /></label><button type="button" disabled={busy || cancelEvidence.trim().length < 20} className="btn-secondary min-h-11 disabled:opacity-50" onClick={() => act("cancel-unsent", { confirmation: cancelEvidence }, it ? "Confermi che nessun bonifico è stato inviato?" : "Confirm that no bank transfer was sent?")}>{it ? "Annulla richiesta non inviata" : "Cancel unsent request"}</button></div> : null}
      {!mayProcess && !mayReconcile && !mayRecord && !maySettle && !mayCancel && !flagAfterSettlement ? <p className="text-sm text-[var(--muted)]">{it ? "Nessuna azione di elaborazione disponibile per questo stato." : "No processing action is available for this status."}</p> : null}
    </div>
  </section>;
}
