import { refundCopy } from "@/lib/refund-copy";
import { getPartnerCommissionDisplay, type DashboardCommission } from "@/lib/partner-dashboard-display";
import type { Locale } from "@/lib/i18n";

type Entry = DashboardCommission & { business: { name: string } | null; businessSubmission: { businessName: string } | null };
export function PartnerCommissionStatusList({ entries, payableCommissionIds, locale, now }: { entries: Entry[]; payableCommissionIds: string[]; locale: Locale; now: string }) {
  const ids = new Set(payableCommissionIds);
  const visible = entries.filter((entry) => entry.type === "COMMISSION" && entry.amountCents > 0 && entry.payment && (entry.payment.refundRequestedAt || entry.payment.status === "REFUNDED" || (entry.payment.purpose === "INITIAL_MEMBERSHIP" && entry.payment.status === "PAID" && entry.payment.paidAt && new Date(entry.payment.paidAt).getTime() + 14 * 86_400_000 > new Date(now).getTime())));
  if (!visible.length) return null;
  return <section className="mx-auto mt-7 max-w-5xl"><h2 className="font-serif text-2xl">{locale === "it" ? "Stato delle commissioni" : "Commission status"}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{visible.map((entry) => {
    const display = getPartnerCommissionDisplay(entry, entries, ids, locale, new Date(now));
    return <article className={`refund-note ${display.tone === "red" ? "refund-note--red" : display.tone === "yellow" ? "refund-note--amber" : ""}`} key={entry.id}><p className="break-words font-semibold">{entry.business?.name || entry.businessSubmission?.businessName}</p><h3 className="mt-2 font-serif text-xl">{display.label}</h3>{display.detail ? <p className="mt-2">{display.detail}</p> : null}{entry.payment?.refundStatus === "support_closed" ? <p className="mt-2 text-xs">{refundCopy(locale).closed}</p> : null}</article>;
  })}</div></section>;
}
