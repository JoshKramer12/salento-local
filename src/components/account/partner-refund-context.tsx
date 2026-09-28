import { getRefundDisplayState, type RefundDisplayPayment } from "@/lib/refund-display";
import { refundCopy } from "@/lib/refund-copy";
import type { Locale } from "@/lib/i18n";

export function PartnerRefundContext({ payment, listingActive, locale }: { payment: RefundDisplayPayment | null; listingActive: boolean; locale: Locale }) {
  const display = getRefundDisplayState({ payment });
  if (!["processing", "support_pending", "needs_attention", "completed", "closed_without_refund"].includes(display)) return null;
  const c = refundCopy(locale);
  return <div className="mt-3 text-xs leading-5"><dl><div><dt className="inline font-semibold">{c.ownerMembership}: </dt><dd className="inline">{display === "completed" ? c.refunded : display === "closed_without_refund" ? c.paidClosed : c.requested}</dd></div><div><dt className="inline font-semibold">{c.listing}: </dt><dd className="inline">{listingActive ? c.active : c.inactive}</dd></div></dl>{display === "completed" && listingActive ? <p className="mt-2">{c.newerActive}</p> : null}</div>;
}
