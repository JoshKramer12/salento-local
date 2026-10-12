import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminWithdrawalActions } from "@/components/account/admin-withdrawal-actions";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireAdminViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getWithdrawalAdminReview } from "@/lib/partner-withdrawal-processing";
import { withdrawalProcessingEnabled } from "@/lib/partner-withdrawal-dashboard";
import { commissionRecordLabel, payoutMethodLabel, withdrawalAuditReason, withdrawalStatusLabel } from "@/lib/partner-withdrawal-view";
import { prisma } from "@/lib/prisma";

type Props = { params: Promise<{ id: string }> };

export default async function AdminWithdrawalDetailPage({ params }: Props) {
  const viewer = await requireAdminViewer();
  const [{ id }, locale] = await Promise.all([params, getCurrentLocale()]);
  const request = await prisma.partnerWithdrawalRequest.findUnique({ where: { id }, include: {
    partnerUser: { select: { username: true } },
    payout: { include: { commissions: { orderBy: { createdAt: "asc" }, select: {
      id: true, amountCents: true, type: true, status: true, createdAt: true, business: { select: { name: true } },
    } } } },
    auditEvents: { orderBy: { createdAt: "asc" }, select: {
      id: true, createdAt: true, fromStatus: true, toStatus: true, actorUserId: true, provider: true,
      providerReference: true, reason: true,
    } },
  } });
  if (!request) notFound();
  const review = await getWithdrawalAdminReview(viewer.id, id);
  const it = locale === "it";
  const date = (value: Date) => new Intl.DateTimeFormat(it ? "it-IT" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(value);
  const reference = request.payout.stripePayoutId ?? request.payout.providerBatchId ?? request.manualTransferReference ?? request.payout.stripeTransferId;
  return <main className="shell px-4 py-10 sm:px-6">
    <Link href="/dashboard/admin/withdrawals" className="text-sm font-semibold text-[var(--primary)] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">← {it ? "Tutte le richieste" : "All requests"}</Link>
    <p className="section-kicker mt-7">Admin · {it ? "Dettaglio prelievo" : "Withdrawal detail"}</p>
    <h1 className="mt-2 font-serif text-4xl">{request.partnerUser.username}</h1>
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <section className="card p-5 sm:p-7" aria-label={it ? "Riepilogo richiesta" : "Request summary"}>
        <div className="flex flex-wrap items-start justify-between gap-3"><p className="font-serif text-4xl">{formatCurrencyFromCents(request.amountCents, locale)}</p><span className="rounded-full bg-[color:rgba(39,124,92,0.12)] px-3 py-1 text-sm font-semibold text-[#1f6c51]">{withdrawalStatusLabel(request.status, locale)}</span></div>
        <dl className="mt-6 grid gap-3 text-sm">
          <div className="flex justify-between gap-3"><dt>{it ? "Metodo" : "Method"}</dt><dd>{payoutMethodLabel(request.payoutMethod)}</dd></div>
          <div className="flex justify-between gap-3"><dt>{it ? "Destinazione" : "Destination"}</dt><dd>{review.destinationMasked}</dd></div>
          <div className="flex justify-between gap-3"><dt>{it ? "Richiesto" : "Requested"}</dt><dd>{date(request.createdAt)}</dd></div>
          {request.settlementVerifiedAt ? <div className="flex justify-between gap-3"><dt>{it ? "Regolamento verificato" : "Settlement verified"}</dt><dd>{date(request.settlementVerifiedAt)}</dd></div> : null}
          {request.manualTransferInitiatedAt ? <div className="flex justify-between gap-3"><dt>{it ? "Bonifico registrato" : "Transfer recorded"}</dt><dd>{date(request.manualTransferInitiatedAt)}</dd></div> : null}
        </dl>
        {reference ? <p className="mt-5 break-all text-sm text-[var(--muted)]">{it ? "Riferimento provider" : "Provider reference"}: {reference}</p> : null}
        {request.payout.stripeTransferId && request.payout.stripePayoutId ? <p className="mt-2 break-all text-xs text-[var(--muted)]">Stripe transfer: {request.payout.stripeTransferId} · Stripe payout: {request.payout.stripePayoutId}</p> : null}
        {request.failureReason ? <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">{it ? "Questa richiesta richiede la verifica dell'esito esterno prima di ulteriori azioni." : "This request needs external outcome review before further action."}</p> : null}
      </section>
      <AdminWithdrawalActions id={id} locale={locale} method={request.payoutMethod} status={request.status} dispatchStarted={Boolean(request.dispatchStartedAt)} manualInitiated={Boolean(request.manualTransferInitiatedAt)} enabled={withdrawalProcessingEnabled()} />
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="card min-w-0 p-5 sm:p-7"><h2 className="font-serif text-2xl">{it ? "Commissioni associate" : "Associated commissions"}</h2><div className="mt-4 grid gap-3">{request.payout.commissions.map((row) => <div key={row.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm"><div><p className="font-medium">{row.business?.name ?? (it ? "Commissione partner" : "Partner commission")}</p><p className="text-xs text-[var(--muted)]">{commissionRecordLabel(row.type, row.status, locale)} · {date(row.createdAt)}</p></div><p className="font-semibold">{formatCurrencyFromCents(row.amountCents, locale)}</p></div>)}{!request.payout.commissions.length ? <p className="text-sm text-[var(--muted)]">{it ? "Nessuna commissione associata." : "No associated commissions."}</p> : null}</div></section>
      <section className="card min-w-0 p-5 sm:p-7"><h2 className="font-serif text-2xl">{it ? "Cronologia verifiche" : "Audit history"}</h2><ol className="mt-4 grid gap-3">{request.auditEvents.map((event) => <li key={event.id} className="rounded-xl border border-[var(--border)] p-3 text-sm"><p className="font-medium">{withdrawalStatusLabel(event.toStatus, locale)} · {date(event.createdAt)}</p><p className="mt-1 break-all text-xs text-[var(--muted)]">{event.provider ?? (event.actorUserId ? "Admin" : it ? "Sistema" : "System")}{event.providerReference ? ` · ${event.providerReference}` : ""}</p>{event.reason ? <p className="mt-1 text-xs text-[var(--muted)]">{it ? "Motivo registrato" : "Recorded reason"}: {withdrawalAuditReason(event.reason, locale)}</p> : null}</li>)}</ol></section>
    </div>
  </main>;
}
