import { formatCurrencyFromCents } from "@/lib/account";
import type { Locale } from "@/lib/i18n";

export function withdrawalConfirmationKind(status: string): "submitted" | "uncertain" | "changed" {
  if (["REQUESTED", "READY_FOR_PROCESSING", "PROCESSING", "PAID"].includes(status)) return "submitted";
  if (["OUTCOME_UNKNOWN", "ACTION_REQUIRED"].includes(status)) return "uncertain";
  return "changed";
}

export function cashoutSuccessCopy(amountCents: number, status: string, locale: Locale, simulated: boolean) {
  const amount = formatCurrencyFromCents(amountCents, locale);
  if (locale === "it") {
    return {
      title: "Richiesta di prelievo inviata!",
      description: simulated
        ? `Il tuo prelievo di prova di ${amount} è stato completato nella simulazione.`
        : status === "PAID"
          ? `Il pagamento del tuo prelievo di ${amount} è stato confermato dal fornitore.`
          : `Abbiamo ricevuto la tua richiesta di prelievo di ${amount}. Il denaro è in arrivo!`,
      explanation: simulated
        ? "Puoi vedere il risultato nella pagina Guadagni. Nessun denaro è stato inviato e nessun conto bancario è stato accreditato."
        : status === "PAID"
          ? "Puoi vedere il risultato nella pagina Guadagni. L'accredito bancario potrebbe richiedere altro tempo."
          : "Il tuo prelievo è in elaborazione. Puoi seguirne lo stato nella pagina Guadagni.",
      view: "Visualizza prelievo",
      back: "Torna alla dashboard",
    };
  }
  return {
    title: "Cash Out request successful!",
    description: simulated
      ? `Your ${amount} test withdrawal was completed in the simulator.`
      : status === "PAID"
        ? `Your ${amount} withdrawal was confirmed by the payout provider.`
        : `Your ${amount} withdrawal has been requested. Your money is on its way!`,
    explanation: simulated
      ? "You can see the result on your Earnings page. No money was sent and no bank account was credited."
      : status === "PAID"
        ? "You can see the result on your Earnings page. Bank arrival may take more time."
        : "Your withdrawal is being processed. You can track its progress in your Earnings page.",
    view: "View withdrawal",
    back: "Back to dashboard",
  };
}
