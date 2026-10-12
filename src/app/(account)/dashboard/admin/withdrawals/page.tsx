import Link from "next/link";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireAdminViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { decryptPayoutDestination } from "@/lib/partner-payout-methods";
import { withdrawalProcessingEnabled } from "@/lib/partner-withdrawal-dashboard";
import { maskWithdrawalDestination, payoutMethodLabel, withdrawalStatusLabel } from "@/lib/partner-withdrawal-view";
import { prisma } from "@/lib/prisma";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const filters = ["ALL", "REQUESTED", "PROCESSING", "ACTION_REQUIRED", "PAID", "FAILED", "CANCELED"] as const;

export default async function AdminWithdrawalsPage({ searchParams }: Props) {
  await requireAdminViewer();
  const [locale, params] = await Promise.all([getCurrentLocale(), searchParams]);
  const raw = typeof params.status === "string" ? params.status : "ALL";
  const selected = filters.includes(raw as (typeof filters)[number]) ? raw as (typeof filters)[number] : "ALL";
  const requests = await prisma.partnerWithdrawalRequest.findMany({
    where: selected === "ALL" ? {} : { status: selected }, orderBy: { createdAt: "desc" }, take: 200,
    include: { partnerUser: { select: { username: true } }, payout: { select: {
      stripeTransferId: true, stripePayoutId: true, providerBatchId: true, providerPayoutId: true,
    } } },
  });
  const it = locale === "it";
  const date = (value: Date) => new Intl.DateTimeFormat(it ? "it-IT" : "en-US", { dateStyle: "medium" }).format(value);
  return <main className="shell px-4 py-10 sm:px-6">
    <p className="section-kicker">Admin · {it ? "Gestione finanziaria" : "Financial operations"}</p>
    <h1 className="mt-2 font-serif text-4xl">{it ? "Richieste di prelievo" : "Withdrawal requests"}</h1>
    <p className="mt-3 max-w-3xl text-sm text-[var(--muted)]">{withdrawalProcessingEnabled()
      ? it ? "Controlla le richieste e apri i dettagli prima di avviare qualsiasi elaborazione." : "Review requests and open the details before starting any processing."
      : it ? "Elaborazione disattivata. Questa sezione è in sola lettura." : "Processing is disabled. This section is read only."}</p>
    <div className="dashboard-nav-shell my-7"><DashboardNav active="adminWithdrawals" isAdmin locale={locale} role="ADMIN" /></div>
    <nav aria-label={it ? "Filtri richieste" : "Request filters"} className="mb-5 flex flex-wrap gap-2">{filters.map((filter) => <Link key={filter} href={filter === "ALL" ? "/dashboard/admin/withdrawals" : `/dashboard/admin/withdrawals?status=${filter}`} aria-current={selected === filter ? "page" : undefined} className={`rounded-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${selected === filter ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)]"}`}>
      {filter === "ALL" ? it ? "Tutte" : "All" : withdrawalStatusLabel(filter, locale)}
    </Link>)}</nav>
    <section className="card p-4 sm:p-6" aria-label={it ? "Elenco richieste" : "Request list"}>
      {requests.length ? <div className="grid gap-3">{requests.map((row) => {
        let masked = "••••";
        try { masked = maskWithdrawalDestination(row.payoutMethod, decryptPayoutDestination(row.destinationSnapshotEncrypted)); } catch { /* Keep corrupt destinations private. */ }
        const reference = row.payout.stripePayoutId ?? row.payout.providerBatchId ?? row.manualTransferReference ?? row.payout.stripeTransferId;
        return <Link href={`/dashboard/admin/withdrawals/${row.id}`} key={row.id} className="grid min-w-0 gap-3 rounded-2xl border border-[var(--border)] p-4 transition hover:border-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] md:grid-cols-[1.2fr_0.8fr_1fr_0.8fr] md:items-center">
          <div className="min-w-0"><p className="truncate font-semibold">{row.partnerUser.username}</p><p className="text-sm text-[var(--muted)]">{date(row.createdAt)}</p></div>
          <div><p className="font-serif text-xl">{formatCurrencyFromCents(row.amountCents, locale)}</p><p className="text-sm text-[var(--muted)]">{payoutMethodLabel(row.payoutMethod)} · {masked}</p></div>
          <p className="break-all text-xs text-[var(--muted)]">{reference ? `${it ? "Rif." : "Ref."} ${reference}` : it ? "Nessun riferimento provider" : "No provider reference"}</p>
          <span className="text-sm font-semibold text-[var(--primary)]">{withdrawalStatusLabel(row.status, locale)} →</span>
        </Link>;
      })}</div> : <p className="text-sm text-[var(--muted)]">{it ? "Nessuna richiesta in questa categoria." : "No requests in this category."}</p>}
    </section>
  </main>;
}
