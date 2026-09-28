import { HardNavigationLink } from "@/components/hard-navigation-link";
import { FormSubmitButton } from "@/components/form-submit-button";
import { confirmInitialRefundAction, checkInitialRefundStatusAction } from "@/app/(account)/dashboard/refund/[businessId]/actions";
import { getRefundDisplayState, refundDate, type RefundDisplayPayment } from "@/lib/refund-display";
import { refundCopy } from "@/lib/refund-copy";
import type { InitialRefundState } from "@/lib/self-service-refunds";
import type { Locale } from "@/lib/i18n";

export type InitialRefundExperienceProps = {
  businessId: string; businessName: string; paymentId?: string; amount: string; locale: Locale;
  state: InitialRefundState; payment: RefundDisplayPayment | null; deadline?: Date | null;
  listingActive: boolean; canCheck?: boolean; ownerEmail?: string | null; error?: string;
};

export function InitialRefundExperience({ businessId, businessName, paymentId, amount, locale, state, payment, deadline, listingActive, canCheck = true, ownerEmail, error }: InitialRefundExperienceProps) {
  const c = refundCopy(locale);
  const display = getRefundDisplayState({ state, payment, attemptFailed: error === "start_failed" || error === "check" });
  const bank = payment?.method === "BANK_TRANSFER";
  const complete = display === "completed";
  const requested = ["processing", "support_pending", "needs_attention"].includes(display);
  const available = display === "eligible" || (display === "start_failed" && state === "AVAILABLE");
  const title = complete ? c.completed(amount) : display === "closed_without_refund" ? c.closed : display === "needs_attention" ? c.attention : display === "support_pending" ? c.bankReceivedTitle : display === "processing" ? c.progressTitle : display === "start_failed" ? c.startFailed : available ? bank ? c.request(amount) : c.cancel : c.unavailable;
  return <main className="shell px-4 py-10 sm:px-6"><section className="refund-experience mx-auto max-w-xl rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm sm:p-8">
    <p className="section-kicker">{c.membership}{bank ? ` · ${c.bank}` : ""}</p>
    <h1 className="mt-2 break-words font-serif text-3xl leading-tight text-[var(--foreground)] sm:text-4xl">{title}</h1>
    {available && !bank && display !== "start_failed" ? <h2 className="mt-4 font-serif text-2xl">{c.receive(amount)}</h2> : null}
    <p className="mt-4 break-words text-lg font-semibold text-[var(--foreground)]">{c.business}: {businessName}</p>
    {display === "start_failed" ? <div className="refund-note refund-note--amber mt-5" role="alert"><p>{c.startFailedBody}</p><p className="mt-2">{c.unchangedListing}</p></div> : null}
    {complete ? <><p className="mt-5 font-semibold">{listingActive ? c.membershipRefunded : c.membershipCancelled}</p><p className="mt-3 leading-7 text-[var(--muted-strong)]">{c.completedBody}</p><p className="mt-3 leading-7">{listingActive ? c.newerActive : c.inactiveBody}</p></> : display === "closed_without_refund" ? <div className="refund-note mt-5"><h2 className="font-semibold">{c.closedStatus}</h2><p className="mt-2">{c.closedBody}</p><p className="mt-3">{c.closedHelp}</p></div> : display === "needs_attention" ? <div className="refund-note refund-note--amber mt-5"><h2 className="font-semibold">{bank ? c.bankOpen : c.attention}</h2><p className="mt-2">{bank ? c.bankFailed : c.attentionBody}</p><p className="mt-3">{payment?.refundStatus === "requires_action" ? c.actionRequired : c.supportReview}</p>{bank ? <p className="mt-3">{c.bankProtected}</p> : null}</div> : display === "support_pending" ? <div className="refund-note refund-note--amber mt-5"><h2 className="font-semibold">{amount} · {c.awaiting}</h2><ul className="mt-3 space-y-2"><li>✓ {c.received}{payment?.refundRequestedAt ? ` — ${refundDate(locale, payment.refundRequestedAt)}` : ""}</li><li>✓ {c.protected}</li><li>{listingActive ? "✓" : "○"} {c.listing}: {listingActive ? c.active : c.inactive}</li><li>○ {c.notCompleted}</li></ul><p className="mt-3">{c.bankFollowup}</p></div> : display === "processing" ? <div className="refund-note refund-note--amber mt-5"><p>{c.progressBody(amount)}</p><p className="mt-3">{c.progressDetail}</p></div> : display === "eligible" ? <>
      {bank ? <><p className="mt-5 leading-7">{deadline ? c.bankBefore(refundDate(locale, deadline)) : c.agreementMethods}</p><div className="refund-note mt-4"><h2 className="font-semibold">{c.afterSubmit}</h2><p className="mt-2">{c.bankAfter(amount)}</p></div>{deadline ? <p className="mt-3 text-xs text-[var(--muted)]">{c.exactDeadline}: {refundDate(locale, deadline, true)}</p> : null}</> : <>
        <dl className="refund-summary mt-5"><div><dt>{c.amount}</dt><dd>{amount}</dd></div><div><dt>{c.method}</dt><dd>{c.originalMethod}</dd></div></dl>
        <div className="refund-note mt-5"><h2 className="font-semibold">{c.next}</h2><ul className="mt-3 space-y-3"><li>✓ {c.nextPayment(amount)}</li><li>✓ {c.nextListing}</li><li>✓ {c.savedBody}</li><li>✓ {c.reactivateLater}</li></ul></div><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{c.providerTiming}</p>
      </>}
    </> : display !== "start_failed" ? <p className="mt-5 leading-7">{deadline && new Date() >= deadline ? c.expired : c.unavailableBody}</p> : null}
    {complete || requested || display === "closed_without_refund" || display === "start_failed" ? <dl className="refund-summary mt-5"><div><dt>{c.amount}</dt><dd>{amount}</dd></div>{requested ? <div><dt>{c.status}</dt><dd>{display === "needs_attention" ? c.attention : bank ? c.awaiting : c.inProgress}</dd></div> : null}<div><dt>{c.listing}</dt><dd>{listingActive ? c.active : c.inactive}</dd></div><div><dt>{c.information}</dt><dd>{c.saved}</dd></div>{complete && (payment?.refundedAt || payment?.selfServiceRefundedAt) ? <div><dt>{c.refundedOn}</dt><dd>{refundDate(locale, (payment?.refundedAt || payment?.selfServiceRefundedAt)!)}</dd></div> : null}</dl> : null}
    {bank && payment?.refundRequestedAt && paymentId ? <p className="mt-4 break-all text-xs leading-5 text-[var(--muted)]">{c.reference}: bank-refund:{paymentId}</p> : null}
    {complete && !listingActive ? <p className="mt-4 text-sm leading-6">{c.reactivateLater}</p> : null}
    {available ? <form action={confirmInitialRefundAction} className="mt-7"><input type="hidden" name="businessId" value={businessId} />
      {bank && !ownerEmail ? <label className="mb-5 block text-sm font-semibold">{c.contactEmail}<input className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] bg-white p-3" type="email" name="instructionsEmail" required autoComplete="email" aria-describedby="refund-email-help" /><span id="refund-email-help" className="mt-2 block text-xs font-normal leading-5">{c.contactHelp}</span></label> : null}
      {error === "email_required" ? <p role="alert" className="mb-4 text-sm text-[#973f36]">{c.emailError}</p> : null}
      <div className="refund-actions"><HardNavigationLink className="btn-primary min-h-12 justify-center" href="/dashboard">{c.keep}</HardNavigationLink><FormSubmitButton className="btn-secondary refund-destructive min-h-12 w-full justify-center" pendingLabel={bank ? c.submitting : c.processing}>{display === "start_failed" ? c.retry : bank ? c.submit(amount) : c.cancelRefund(amount)}</FormSubmitButton></div>
    </form> : <div className="refund-actions mt-7">
      {requested && canCheck ? <form action={checkInitialRefundStatusAction}><input type="hidden" name="businessId" value={businessId} /><FormSubmitButton className="btn-secondary min-h-12 w-full justify-center" pendingLabel={c.checking}>{c.checkProgress}</FormSubmitButton></form> : null}
      {!complete || bank ? <HardNavigationLink className="btn-secondary min-h-12 justify-center" href="/dashboard/support">{c.support}</HardNavigationLink> : null}
      <HardNavigationLink className="btn-primary min-h-12 justify-center" href="/dashboard">{c.back}</HardNavigationLink>
    </div>}
    {requested && canCheck ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{c.checkHelp}</p> : null}
    {available ? <HardNavigationLink className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--primary)] underline" href="/dashboard/support">{c.support}</HardNavigationLink> : null}
  </section></main>;
}
