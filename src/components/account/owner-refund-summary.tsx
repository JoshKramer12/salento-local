import { HardNavigationLink } from "@/components/hard-navigation-link";
import { getRefundDisplayState, refundAmount, refundDate, type RefundDisplayPayment } from "@/lib/refund-display";
import { refundCopy } from "@/lib/refund-copy";
import type { InitialRefundState } from "@/lib/self-service-refunds";
import type { Locale } from "@/lib/i18n";

export function OwnerRefundSummary({ businessId, state, payment, deadline, listingActive, locale }: {
  businessId: string; state: InitialRefundState; payment?: RefundDisplayPayment | null; deadline: Date | null;
  listingActive: boolean; locale: Locale;
}) {
  const c = refundCopy(locale);
  const display = getRefundDisplayState({ state, payment });
  if (display === "unavailable" || !payment || payment.amountCents === undefined) return null;
  const amount = refundAmount(locale, display === "completed" ? payment.refundedAmountCents ?? payment.amountCents : payment.amountCents, payment.currency);
  const heading = display === "eligible" ? c.moneyBack : display === "completed" ? c.completed(amount) : display === "closed_without_refund" ? c.closed : display === "needs_attention" ? c.attention : display === "support_pending" ? c.bankReceived : c.progress;
  const date = payment.refundedAt || payment.selfServiceRefundedAt;
  return <section className={`refund-note mt-5 ${display === "completed" ? "refund-note--red" : ["processing", "needs_attention", "support_pending"].includes(display) ? "refund-note--amber" : ""}`}>
    <h4 className="font-serif text-2xl">{heading}</h4>
    <p className="mt-3">{display === "eligible" && deadline ? c.eligible(amount, refundDate(locale, deadline)) : display === "completed" ? date ? c.completedOn(amount, refundDate(locale, date)) : c.completedBody : display === "closed_without_refund" ? c.closedBody : display === "needs_attention" ? payment.method === "BANK_TRANSFER" ? c.bankFailed : c.attentionBody : display === "support_pending" ? c.bankProtected : c.progressBody(amount)}</p>
    {display === "eligible" ? <><p className="mt-2 text-sm">{c.eligibleDetail}</p>{payment.method === "BANK_TRANSFER" ? <p className="mt-2 text-sm">{c.agreementMethods}</p> : null}{deadline ? <p className="mt-3 text-xs">{c.exactDeadline}: {refundDate(locale, deadline, true)}</p> : null}</> : <>
      {display === "support_pending" ? <p className="mt-2 font-semibold">{amount} · {c.awaiting}</p> : null}
      <dl className="refund-summary mt-3"><div><dt>{c.listing}</dt><dd>{listingActive ? c.active : c.inactive}</dd></div>{display === "completed" ? <div><dt>{c.information}</dt><dd>{c.saved}</dd></div> : null}</dl>
      <p className="mt-3 text-sm">{display === "completed" ? listingActive ? c.newerActive : c.inactiveBody : display === "closed_without_refund" ? c.closedHelp : display === "needs_attention" ? c.supportReview : c.progressDetail}</p>
      {payment.refundRequestedAt && display !== "completed" ? <p className="mt-3 text-xs">{c.received}: {refundDate(locale, payment.refundRequestedAt)}</p> : null}
    </>}
    <HardNavigationLink className={`btn-secondary mt-4 min-h-12 w-full justify-center sm:w-auto ${display === "eligible" ? "refund-destructive" : ""}`} href={`/dashboard/refund/${encodeURIComponent(businessId)}`}>{display === "eligible" ? c.request(amount) : ["processing", "support_pending"].includes(display) ? c.viewProgress : c.viewDetails}</HardNavigationLink>
  </section>;
}
