import type { Locale } from "@/lib/i18n";

export function completedRefundEmail({ kind, locale, businessName, amount, commissionAmount, commissionCancelled, listingActive }: {
  kind: "owner" | "partner"; locale: Locale; businessName: string; amount: string;
  commissionAmount?: string; commissionCancelled: boolean; listingActive: boolean;
}) {
  const it = locale === "it";
  const listing = listingActive
    ? it ? "La scheda è attualmente attiva con la membership in corso; questo rimborso riguarda un pagamento precedente." : "The listing is currently active under its current membership; this refund belongs to an earlier payment."
    : it ? "La scheda è ora inattiva." : "The listing is now inactive.";
  if (kind === "owner") return {
    subject: it ? "Il tuo rimborso Salento Local è stato completato" : "Your Salento Local refund is complete",
    text: it
      ? `Il rimborso di ${amount} per ${businessName} è stato completato. La banca o il fornitore di pagamento potrebbero richiedere altro tempo per mostrare l’accredito. ${listing} I dati dell’attività, le foto e l’account restano salvati.${listingActive ? "" : " Potrai riattivare la scheda acquistando una nuova membership."}`
      : `Your ${amount} refund for ${businessName} has been completed. Your bank or payment provider may take additional time to show the returned funds. ${listing} Your business information, photos and account stay saved.${listingActive ? "" : " You can reactivate the listing by purchasing a new membership."}`,
  };
  const commission = commissionCancelled
    ? it ? `La commissione iniziale${commissionAmount ? ` di ${commissionAmount}` : ""} associata a questo pagamento è stata annullata e non verrà pagata.` : `The initial commission${commissionAmount ? ` of ${commissionAmount}` : ""} associated with this payment was cancelled and will not be paid.`
    : it ? "Lo stato della commissione associata è disponibile nella dashboard Partner." : "The associated commission's current status is available in your Partner dashboard.";
  return {
    subject: it ? `Rimborso del titolare completato per ${businessName}` : `Owner refund completed for ${businessName}`,
    text: it
      ? `Il rimborso della membership di ${amount} del titolare di ${businessName} è stato completato. ${listing} ${commission} L’attività resta nella dashboard Partner. Un successivo acquisto distinto potrà maturare una nuova commissione solo se soddisfa le regole previste.`
      : `The Owner's ${amount} membership refund for ${businessName} has been completed. ${listing} ${commission} The business remains in your Partner dashboard. A later distinct purchase may earn a new commission only if it qualifies under the existing rules.`,
  };
}
