import type { PartnerPayoutMethod, PartnerWithdrawalStatus } from "@prisma/client";
import type { Locale } from "@/lib/i18n";

export type WithdrawalBlockReason = "disabled" | "unresolved" | "debt" | "setup" | "minimum" | "hold" | null;

export function cashoutBlockReason(input: {
  enabled: boolean; available: number; minimum: number; setupReady: boolean;
  unresolved: boolean; debt: boolean; held: number;
}): WithdrawalBlockReason {
  if (!input.enabled) return "disabled";
  if (input.unresolved) return "unresolved";
  if (input.debt) return "debt";
  if (!input.setupReady) return "setup";
  if (input.available < input.minimum) return "minimum";
  return null;
}

export function maskWithdrawalDestination(method: PartnerPayoutMethod, value: string) {
  if (method === "PAYPAL") {
    const [name, domain] = value.split("@");
    return name && domain ? `${name.slice(0, 2)}••••@${domain}` : "••••";
  }
  return `•••• ${value.slice(-4)}`;
}

const copy = {
  en: {
    statuses: { REQUESTED: "Requested", PROCESSING: "Processing", ACTION_REQUIRED: "Needs attention", PAID: "Paid", FAILED: "Failed", CANCELED: "Canceled" },
    blocks: {
      disabled: "Cash-outs are not available yet. Eligible earnings continue under the current payout schedule.",
      unresolved: "A withdrawal is already open. Please wait until it is resolved.",
      debt: "Cash-outs are paused while an account adjustment is being reviewed.",
      setup: "Complete your payout details before requesting a withdrawal.",
      minimum: "Cash-outs are available once you have at least {minimum}.",
      hold: "Some earnings are on hold. You can request a withdrawal when enough funds are available.",
    },
    errors: {
      cashout_disabled: "Cash-outs are not available yet.", below_minimum_payout: "Your available balance is below the minimum.",
      payout_destination_unavailable: "Complete your payout details before requesting a withdrawal.",
      withdrawal_already_open: "A withdrawal is already open.", commission_reservation_changed: "Your balance changed. Please review it and try again.",
      withdrawal_write_conflict: "Your request could not be confirmed. Please try again.",
      withdrawal_financial_hold: "This withdrawal is on hold for financial review.",
      admin_required: "Admin access is required.", withdrawal_processing_disabled: "Withdrawal processing is disabled.",
      withdrawal_reconciliation_disabled: "Withdrawal reconciliation is disabled.",
      stripe_continuation_not_safe: "This Stripe payout cannot be continued safely. Reconcile provider records first.",
      verified_bank_return_required: "Record a verified bank return with its reference and evidence.",
      bank_return_evidence_required: "Confirm the full bank return and provide its reference and evidence.",
      bank_return_conflict: "A different bank return is already recorded for this withdrawal.",
      paypal_batch_reference_invalid: "Enter a valid PayPal batch ID.",
      paypal_batch_attach_conflict: "This PayPal batch cannot be attached in the current state.",
      paypal_batch_attribution_conflict: "The PayPal batch does not match this withdrawal.",
      provider_reference_conflict: "Provider records conflict with the saved payout reference. Investigate before continuing.",
      settlement_evidence_required: "Confirm receipt and provide at least 20 characters of evidence.",
      manual_exception_evidence_required: "Provide at least 20 characters of evidence.",
      no_transfer_evidence_required: "Confirm with at least 20 characters why no transfer was sent.",
    },
  },
  it: {
    statuses: { REQUESTED: "Richiesto", PROCESSING: "In elaborazione", ACTION_REQUIRED: "Richiede attenzione", PAID: "Pagato", FAILED: "Non riuscito", CANCELED: "Annullato" },
    blocks: {
      disabled: "I prelievi non sono ancora disponibili. I guadagni idonei seguono il programma attuale dei pagamenti.",
      unresolved: "Hai già una richiesta aperta. Attendi che venga risolta.",
      debt: "I prelievi sono sospesi mentre viene verificata una rettifica del conto.",
      setup: "Completa i dati di pagamento prima di richiedere un prelievo.",
      minimum: "Puoi richiedere un prelievo quando hai almeno {minimum} disponibili.",
      hold: "Alcuni guadagni sono sospesi. Potrai richiedere un prelievo quando ci saranno fondi sufficienti.",
    },
    errors: {
      cashout_disabled: "I prelievi non sono ancora disponibili.", below_minimum_payout: "Il saldo disponibile è inferiore alla soglia minima.",
      payout_destination_unavailable: "Completa i dati di pagamento prima di richiedere un prelievo.",
      withdrawal_already_open: "Hai già una richiesta aperta.", commission_reservation_changed: "Il saldo è cambiato. Controllalo e riprova.",
      withdrawal_write_conflict: "Impossibile confermare la richiesta. Riprova.",
      withdrawal_financial_hold: "Il prelievo è sospeso per una verifica finanziaria.",
      admin_required: "È necessario l'accesso Admin.", withdrawal_processing_disabled: "L'elaborazione dei prelievi è disattivata.",
      withdrawal_reconciliation_disabled: "La riconciliazione dei prelievi è disattivata.",
      stripe_continuation_not_safe: "Non è sicuro continuare questo payout Stripe. Verifica prima i dati del provider.",
      verified_bank_return_required: "Registra la restituzione bancaria verificata con riferimento e prova.",
      bank_return_evidence_required: "Conferma la restituzione integrale e fornisci riferimento e prova.",
      bank_return_conflict: "Per questo prelievo è già registrata una restituzione diversa.",
      paypal_batch_reference_invalid: "Inserisci un ID batch PayPal valido.",
      paypal_batch_attach_conflict: "Questo batch PayPal non può essere collegato nello stato attuale.",
      paypal_batch_attribution_conflict: "Il batch PayPal non corrisponde a questo prelievo.",
      provider_reference_conflict: "I dati del provider non corrispondono al riferimento salvato. Verifica prima di continuare.",
      settlement_evidence_required: "Conferma la ricezione e fornisci almeno 20 caratteri di prova.",
      manual_exception_evidence_required: "Fornisci almeno 20 caratteri di prova.",
      no_transfer_evidence_required: "Spiega con almeno 20 caratteri perché il bonifico non è stato inviato.",
    },
  },
} as const;

export function withdrawalStatusLabel(status: PartnerWithdrawalStatus, locale: Locale) { return copy[locale].statuses[status]; }
export function withdrawalBlockMessage(reason: Exclude<WithdrawalBlockReason, null>, locale: Locale, minimum: string) {
  return copy[locale].blocks[reason].replace("{minimum}", minimum);
}
export function withdrawalErrorMessage(code: string, locale: Locale) {
  return (copy[locale].errors as Record<string, string>)[code] ?? (locale === "it" ? "Impossibile completare l'operazione. Riprova o contatta l'assistenza." : "The action could not be completed. Please retry or contact support.");
}
export function payoutMethodLabel(method: PartnerPayoutMethod) {
  return { STRIPE: "Stripe Connect", PAYPAL: "PayPal", POSTEPAY: "Postepay", HYPE: "HYPE" }[method];
}

export function withdrawalAuditReason(reason: string, locale: Locale) {
  const labels: Record<string, { en: string; it: string }> = {
    admin_processing_claim: { en: "Processing claimed by Admin", it: "Elaborazione presa in carico dall'Admin" },
    provider_dispatch_started: { en: "Provider dispatch started", it: "Invio al provider avviato" },
    stripe_payout_dispatch_started: { en: "Stripe payout request started", it: "Richiesta payout Stripe avviata" },
    existing_transfer_payout_continuation: { en: "Payout continued from verified transfer", it: "Payout continuato dal trasferimento verificato" },
    verified_bank_return_pending_accounting: { en: "Verified bank return; accounting review pending", it: "Restituzione bancaria verificata; revisione contabile in sospeso" },
    provider_reference_recorded: { en: "Provider reference recorded", it: "Riferimento provider registrato" },
    provider_outcome_verified: { en: "Provider outcome verified", it: "Esito provider verificato" },
    destination_revealed: { en: "Bank details viewed", it: "Dati bancari visualizzati" },
    manual_transfer_initiated_outside_site: { en: "External bank transfer recorded", it: "Bonifico esterno registrato" },
    manual_transfer_not_sent: { en: "No bank transfer sent", it: "Nessun bonifico inviato" },
    no_transfer_evidence_recorded: { en: "No-transfer evidence recorded", it: "Prova del mancato invio registrata" },
    manual_uncertain: { en: "Bank transfer outcome uncertain", it: "Esito del bonifico incerto" },
    manual_failed: { en: "Bank transfer failed", it: "Bonifico non riuscito" },
    manual_returned: { en: "Bank transfer returned", it: "Bonifico restituito" },
    commission_reversed_during_dispatch: { en: "Commission reversed during dispatch", it: "Commissione stornata durante l'invio" },
    withdrawal_financial_hold: { en: "Financial review hold", it: "Sospeso per verifica finanziaria" },
    stripe_outcome_requires_reconciliation: { en: "Stripe outcome requires reconciliation", it: "Esito Stripe da riconciliare" },
    paypal_outcome_requires_reconciliation: { en: "PayPal outcome requires reconciliation", it: "Esito PayPal da riconciliare" },
    stripe_payout_not_verified: { en: "Stripe payout not yet verified", it: "Pagamento Stripe non ancora verificato" },
    paypal_batch_reference_missing: { en: "PayPal batch reference missing", it: "Riferimento batch PayPal mancante" },
  };
  return labels[reason]?.[locale] ?? (locale === "it" ? "Evento finanziario registrato" : "Financial event recorded");
}

export function commissionRecordLabel(type: string, status: string, locale: Locale) {
  const types: Record<string, { en: string; it: string }> = {
    COMMISSION: { en: "Commission", it: "Commissione" }, REVERSAL: { en: "Reversal", it: "Storno" }, ADJUSTMENT: { en: "Adjustment", it: "Rettifica" },
  };
  const statuses: Record<string, { en: string; it: string }> = {
    PENDING: { en: "Pending", it: "In attesa" }, AVAILABLE: { en: "Available", it: "Disponibile" },
    RESERVED: { en: "Reserved", it: "Riservata" }, PAID: { en: "Paid", it: "Pagata" },
    REVERSED: { en: "Reversed", it: "Stornata" }, DEBT: { en: "Debt", it: "Debito" },
  };
  return `${types[type]?.[locale] ?? type} · ${statuses[status]?.[locale] ?? status}`;
}

export function availableWithdrawalAdminActions(method: PartnerPayoutMethod, status: PartnerWithdrawalStatus,
  dispatchStarted: boolean, manualInitiated: boolean) {
  const manual = method === "POSTEPAY" || method === "HYPE";
  const process = status === "REQUESTED" || status === "ACTION_REQUIRED" && !dispatchStarted && !manualInitiated;
  return {
    manual,
    process,
    reconcile: !manual && (status === "PROCESSING" || status === "ACTION_REQUIRED") && !process,
    recordTransfer: manual && status === "PROCESSING" && !manualInitiated,
    settleOrFlag: manual && manualInitiated && (status === "PROCESSING" || status === "ACTION_REQUIRED"),
    flagAfterSettlement: manual && manualInitiated && status === "PAID",
    cancelUnsent: manual && !manualInitiated && (status === "REQUESTED" || status === "PROCESSING" || status === "ACTION_REQUIRED"),
  };
}
