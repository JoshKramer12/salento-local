import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminPartnerPayoutButton } from "@/components/account/admin-partner-payout-button";
import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { PartnerOutstandingCommissionCard } from "@/components/account/partner-outstanding-commission-card";
import { PartnerPayoutSummary } from "@/components/account/partner-payout-summary";
import { formatCurrencyFromCents } from "@/lib/account";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { getPartnerPayoutSetupSummary } from "@/lib/partner-connect";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";
import type { PartnerPayoutRunSummaryItem } from "@/lib/partner-ledger";
import {
  getPartnerBalanceSummary,
  getPartnerOutstandingCommissionItems,
  getPartnerPayoutAdminOverview,
  getPartnerPayoutHistory,
} from "@/lib/partner-ledger";

type DashboardEarningsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
type DashboardLocale = "en" | "it";
type AdminPayoutOverview = Awaited<ReturnType<typeof getPartnerPayoutAdminOverview>>;
type PartnerPayoutSummaryRow = AdminPayoutOverview["partnerSummaries"][number];
type PartnerPayoutSortKey = "owed-now" | "already-paid" | "last-payout" | "name" | "status";
type SortDirection = "asc" | "desc";

function formatDate(date: Date | null | undefined, locale: DashboardLocale) {
  if (!date) {
    return locale === "it" ? "Mai" : "Never";
  }

  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
  }).format(date);
}

function getPayoutBannerCopy(status: string, locale: DashboardLocale) {
  switch (status) {
    case "completed":
      return locale === "it"
        ? "Pagamento partner avviato in modalita test Stripe."
        : "Partner payout run started in Stripe test mode.";
    case "partial":
      return locale === "it"
        ? "Alcuni partner sono stati pagati, altri richiedono attenzione."
        : "Some partners were paid, while others still need attention.";
    case "failed":
      return locale === "it"
        ? "Il pagamento partner non e stato avviato. Controlla i log e riprova."
        : "The partner payout run did not start. Review the logs and try again.";
    default:
      return "";
  }
}

function getRunSummaryItems(summary: unknown) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return [] as PartnerPayoutRunSummaryItem[];
  }

  const partnerSummaries = (summary as { partnerSummaries?: unknown }).partnerSummaries;
  return Array.isArray(partnerSummaries)
    ? (partnerSummaries as PartnerPayoutRunSummaryItem[])
    : [];
}

function getRunSummaryStatusLabel(
  status: PartnerPayoutRunSummaryItem["status"],
  locale: DashboardLocale,
) {
  switch (status) {
    case "paid":
      return locale === "it" ? "Pagato" : "Paid";
    case "processing":
      return locale === "it" ? "In elaborazione" : "Processing";
    case "failed":
      return locale === "it" ? "Fallito" : "Failed";
    case "skipped-below-minimum":
      return locale === "it" ? "Sotto soglia" : "Below minimum";
    case "skipped-no-commissions":
      return locale === "it" ? "Nessuna commissione" : "No commissions";
    case "skipped-payouts-disabled":
      return locale === "it" ? "Pagamenti disattivati" : "Payouts disabled";
    case "skipped-setup-incomplete":
      return locale === "it" ? "Setup incompleto" : "Setup incomplete";
    default:
      return status;
  }
}

function getRunSummaryStatusClass(status: PartnerPayoutRunSummaryItem["status"]) {
  switch (status) {
    case "paid":
    case "processing":
      return "bg-[color:rgba(39,124,92,0.12)] text-[#1f6c51]";
    case "failed":
    case "skipped-payouts-disabled":
    case "skipped-setup-incomplete":
      return "bg-[color:rgba(154,52,18,0.12)] text-[#9a3412]";
    default:
      return "bg-[color:rgba(120,108,92,0.12)] text-[var(--muted)]";
  }
}

function getPartnerSetupLabel(
  status: string,
  payoutsEnabled: boolean,
  locale: DashboardLocale,
) {
  if (!payoutsEnabled) {
    return locale === "it" ? "Stripe pronto ma pagamenti non abilitati" : "Stripe ready but payouts disabled";
  }

  switch (status) {
    case "READY":
      return locale === "it" ? "Pronto per il pagamento" : "Ready for payout";
    case "ACTION_REQUIRED":
      return locale === "it" ? "Stripe richiede azione" : "Stripe action required";
    case "RESTRICTED":
      return locale === "it" ? "Stripe limitato" : "Stripe restricted";
    case "INCOMPLETE":
      return locale === "it" ? "Onboarding Stripe incompleto" : "Stripe onboarding incomplete";
    default:
      return locale === "it" ? "Stripe non collegato" : "Stripe not connected";
  }
}

function getPartnerSortLabel(sort: PartnerPayoutSortKey, locale: DashboardLocale) {
  const labels: Record<PartnerPayoutSortKey, { en: string; it: string }> = {
    "already-paid": {
      en: "Already paid",
      it: "Gia pagato",
    },
    "last-payout": {
      en: "Last payout",
      it: "Ultimo payout",
    },
    name: {
      en: "Partner name",
      it: "Nome partner",
    },
    "owed-now": {
      en: "Money waiting now",
      it: "Soldi da inviare ora",
    },
    status: {
      en: "Payout status",
      it: "Stato payout",
    },
  };

  return labels[sort][locale];
}

function getPartnerStatusWeight(partner: PartnerPayoutSummaryRow) {
  if (partner.stripeAccountStatus === "READY" && partner.stripePayoutsEnabled) {
    return 3;
  }

  if (partner.stripeAccountStatus === "ACTION_REQUIRED") {
    return 2;
  }

  if (partner.stripeAccountStatus === "INCOMPLETE") {
    return 1;
  }

  return 0;
}

function sortPartnerSummaries(
  partners: PartnerPayoutSummaryRow[],
  sort: PartnerPayoutSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...partners].sort((left, right) => {
    let comparison = 0;

    switch (sort) {
      case "already-paid":
        comparison = left.paidAmountCents - right.paidAmountCents;
        break;
      case "last-payout":
        comparison =
          (left.lastPayoutDate?.getTime() ?? 0) - (right.lastPayoutDate?.getTime() ?? 0);
        break;
      case "name":
        comparison = left.fullName.localeCompare(right.fullName, undefined, {
          sensitivity: "base",
        });
        break;
      case "status":
        comparison = getPartnerStatusWeight(left) - getPartnerStatusWeight(right);
        break;
      case "owed-now":
      default:
        comparison = left.pendingAmountCents - right.pendingAmountCents;
        break;
    }

    if (comparison !== 0) {
      return comparison * multiplier;
    }

    return left.fullName.localeCompare(right.fullName, undefined, {
      sensitivity: "base",
    });
  });
}

export default async function DashboardEarningsPage({
  searchParams,
}: DashboardEarningsPageProps) {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), requireCompletedViewer()]);

  if (viewer.role === "BUSINESS_OWNER") {
    redirect("/dashboard");
  }

  if (viewer.role === "GETTER") {
    const profile = await prisma.localPartnerProfile.findUnique({
      where: { userId: viewer.id },
      select: { completedAt: true, partnerOnboardingCompletedAt: true },
    });
    const nextRoute = getPartnerNextRoute(profile);

    if (nextRoute !== "/dashboard") redirect(nextRoute);

    const [balances, history, outstandingCommissions, setup, draftCount] =
      await Promise.all([
        getPartnerBalanceSummary(viewer.id),
        getPartnerPayoutHistory(viewer.id),
        getPartnerOutstandingCommissionItems(viewer.id),
        getPartnerPayoutSetupSummary(viewer.id),
        prisma.businessSubmission.count({
          where: buildDraftLikeSubmissionWhere(viewer.id),
        }),
      ]);

    return (
      <>
        <PartnerWorkspaceNav active="earnings" locale={locale} />
        <main className="shell px-4 py-12 sm:px-6">
        <div className="dashboard-nav-shell mb-8">
          <DashboardNav
            active="earnings"
            draftCount={draftCount}
            isAdmin={false}
            locale={locale}
            role={viewer.role}
          />
        </div>

        <div className="mb-8">
          <p className="section-kicker mb-2">
            {locale === "it" ? "Riepilogo economico" : "Money overview"}
          </p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">
            {locale === "it" ? "Guadagni e pagamenti" : "Earnings and payouts"}
          </h1>
        </div>

        <section className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          <article className="card p-5">
            <p className="text-sm text-[var(--muted)]">
              {locale === "it" ? "Guadagni totali" : "Total earnings"}
            </p>
            <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
              {formatCurrencyFromCents(balances.totalEarned, locale)}
            </p>
          </article>
          <PartnerOutstandingCommissionCard
            amountCents={balances.available}
            items={outstandingCommissions}
            locale={locale}
          />
          <article className="card p-5">
            <p className="text-sm text-[var(--muted)]">
              {locale === "it" ? "Pagato" : "Paid"}
            </p>
            <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
              {formatCurrencyFromCents(balances.paid, locale)}
            </p>
          </article>
        </section>

        <PartnerPayoutSummary
          balances={balances}
          history={history}
          locale={locale}
          setup={setup}
        />
        </main>
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const selectedRunKey = getSingleParam(resolvedSearchParams.payoutRun);
  const payoutStatus = getSingleParam(resolvedSearchParams.payoutStatus);
  const sort = getSingleParam(resolvedSearchParams.sort) ?? "owed-now";
  const direction = getSingleParam(resolvedSearchParams.dir) ?? "desc";
  const safeSort = (["owed-now", "already-paid", "last-payout", "name", "status"] as const).includes(
    sort as PartnerPayoutSortKey,
  )
    ? (sort as PartnerPayoutSortKey)
    : "owed-now";
  const safeDirection = (["asc", "desc"] as const).includes(direction as SortDirection)
    ? (direction as SortDirection)
    : "desc";
  const [overview, draftCount] = await Promise.all([
    getPartnerPayoutAdminOverview(selectedRunKey || null),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
  ]);

  const pendingPartners = overview.partnerSummaries.filter(
    (partner) => partner.pendingCommissionCount > 0,
  );
  const totalPendingCents = pendingPartners.reduce(
    (sum, partner) => sum + partner.pendingAmountCents,
    0,
  );
  const totalPaidCents = overview.partnerSummaries.reduce(
    (sum, partner) => sum + partner.paidAmountCents,
    0,
  );
  const readyToPayCount = pendingPartners.filter(
    (partner) => partner.stripeAccountStatus === "READY" && partner.stripePayoutsEnabled,
  ).length;
  const actionRequiredCount = pendingPartners.filter(
    (partner) => partner.stripeAccountStatus !== "READY" || !partner.stripePayoutsEnabled,
  ).length;
  const selectedRunSummary = getRunSummaryItems(overview.selectedRun?.summary);
  const payoutBannerCopy = getPayoutBannerCopy(payoutStatus, locale);
  const sortedPartners = sortPartnerSummaries(overview.partnerSummaries, safeSort, safeDirection);

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8">
        <p className="section-kicker mb-2">
          {locale === "it" ? "Controlli interni" : "Internal visibility"}
        </p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">
          {locale === "it" ? "Pagamenti partner" : "Partner payouts"}
        </h1>
      </div>

      <div className="dashboard-nav-shell mb-8">
        <DashboardNav
          active="earnings"
          draftCount={draftCount}
          isAdmin
          locale={locale}
          role={viewer.role}
        />
      </div>

      <section className="card p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h2 className="font-serif text-3xl text-[var(--foreground)]">
              {locale === "it" ? "Esegui payout manuale" : "Run manual payout"}
            </h2>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {locale === "it"
                ? "Questa azione usa Stripe Test Mode: Salento Local riceve sempre l'intero pagamento della scheda, poi questo pannello invia in seguito le commissioni partner tramite Stripe Connect."
                : "This action stays in Stripe Test Mode: Salento Local always receives the full listing payment first, and this panel sends partner commissions later through Stripe Connect."}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {locale === "it"
                ? "La futura automazione resta prevista ogni giovedi, ma per ora il pagamento parte solo da questo pulsante admin."
                : "The future automation is still designed for Thursdays, but for now payouts only start from this admin button."}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <AdminPartnerPayoutButton locale={locale} />
          </div>
        </div>

        {payoutBannerCopy ? (
          <div className="mt-5 rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4 text-sm text-[var(--foreground)]">
            {payoutBannerCopy}
          </div>
        ) : null}
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">
            {locale === "it" ? "Partner con saldo in attesa" : "Partners with pending balance"}
          </p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {pendingPartners.length}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">
            {locale === "it" ? "Totale da pagare" : "Total pending payout"}
          </p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {formatCurrencyFromCents(totalPendingCents, locale)}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">
            {locale === "it" ? "Pronti per il payout" : "Ready for payout"}
          </p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{readyToPayCount}</p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">
            {locale === "it" ? "Richiedono attenzione" : "Need attention"}
          </p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {actionRequiredCount}
          </p>
        </article>
      </section>

      <section className="mt-10 card p-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-serif text-3xl text-[var(--foreground)]">
              {locale === "it" ? "Prossimo payout per partner" : "Next payout by partner"}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {locale === "it"
                ? "Questa vista mostra esattamente chi verra pagato, quanto, e quali attivita entrano nel prossimo trasferimento."
                : "This view shows exactly who will be paid next, how much, and which businesses are included in the next transfer."}
            </p>
          </div>
          <p className="text-sm text-[var(--muted)]">
            {locale === "it" ? "Totale gia pagato" : "Total paid to date"}:{" "}
            <span className="font-medium text-[var(--foreground)]">
              {formatCurrencyFromCents(totalPaidCents, locale)}
            </span>
          </p>
        </div>

        <form className="mt-6 grid gap-3 lg:grid-cols-[14rem_10rem_auto]">
          <label className="field-label">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {locale === "it" ? "Ordina per" : "Sort by"}
            </span>
            <select name="sort" className="input-field" defaultValue={safeSort}>
              {(["owed-now", "already-paid", "last-payout", "name", "status"] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {getPartnerSortLabel(value, locale)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field-label">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {locale === "it" ? "Direzione" : "Direction"}
            </span>
            <select name="dir" className="input-field" defaultValue={safeDirection}>
              <option value="desc">{locale === "it" ? "Decrescente" : "Descending"}</option>
              <option value="asc">{locale === "it" ? "Crescente" : "Ascending"}</option>
            </select>
          </label>
          <div className="flex items-end gap-3">
            <button type="submit" className="btn-primary">
              {locale === "it" ? "Applica" : "Apply"}
            </button>
            <Link href="/dashboard/earnings" className="btn-secondary">
              {locale === "it" ? "Resetta" : "Reset"}
            </Link>
          </div>
        </form>

        <div className="mt-6 overflow-hidden rounded-[1.6rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-left text-sm text-[var(--foreground)]">
              <thead className="bg-[rgba(255,255,255,0.74)] text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                <tr>
                  <th className="px-4 py-4">{locale === "it" ? "Partner" : "Partner"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Metodo" : "Method"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Stato payout" : "Payout status"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Da inviare ora" : "Send now"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Commissioni" : "Commissions"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Gia pagato" : "Already paid"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Ultimo payout" : "Last payout"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Attivita incluse" : "Included businesses"}</th>
                  <th className="px-4 py-4">{locale === "it" ? "Apri" : "Open"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(42,98,87,0.08)] bg-white/80">
                {sortedPartners.map((partner) => (
                  <tr key={partner.username} className="align-top hover:bg-[rgba(247,244,239,0.74)]">
                    <td className="px-4 py-4">
                      <p className="font-medium">{partner.fullName}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        @{partner.username} · {partner.email}
                      </p>
                    </td>
                    <td className="px-4 py-4"><span className="pill-muted">{partner.payoutMethod}</span></td>
                    <td className="px-4 py-4">
                      <span className="pill-muted">
                        {getPartnerSetupLabel(
                          partner.stripeAccountStatus,
                          partner.stripePayoutsEnabled,
                          locale,
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium">
                        {formatCurrencyFromCents(partner.pendingAmountCents, locale)}
                      </p>
                    </td>
                    <td className="px-4 py-4">{partner.pendingCommissionCount}</td>
                    <td className="px-4 py-4">
                      {formatCurrencyFromCents(partner.paidAmountCents, locale)}
                    </td>
                    <td className="px-4 py-4">{formatDate(partner.lastPayoutDate, locale)}</td>
                    <td className="px-4 py-4">
                      {partner.nextPayoutBusinesses.length ? (
                        <p className="max-w-[26rem] text-sm text-[var(--foreground)]">
                          {partner.nextPayoutBusinesses.join(", ")}
                        </p>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/dashboard/admin/users?q=${encodeURIComponent(partner.username)}`}
                        className="btn-secondary"
                      >
                        {locale === "it" ? "Utente" : "User"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {selectedRunSummary.length ? (
        <section className="mt-10 card p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-serif text-3xl text-[var(--foreground)]">
                {locale === "it" ? "Risultato ultimo run" : "Latest payout run"}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {overview.selectedRun?.runKey}
              </p>
            </div>
            <p className="text-sm text-[var(--muted)]">
              {locale === "it" ? "Esecuzione pianificata" : "Scheduled for"}:{" "}
              {formatDate(overview.selectedRun?.scheduledFor, locale)}
            </p>
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.6rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-left text-sm text-[var(--foreground)]">
                <thead className="bg-[rgba(255,255,255,0.74)] text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  <tr>
                    <th className="px-4 py-4">{locale === "it" ? "Partner" : "Partner"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Risultato" : "Result"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Attivita" : "Businesses"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Totale" : "Total"}</th>
                    <th className="px-4 py-4">Stripe transfer</th>
                    <th className="px-4 py-4">{locale === "it" ? "Note" : "Notes"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(42,98,87,0.08)] bg-white/80">
                  {selectedRunSummary.map((item) => (
                    <tr
                      key={`${item.partnerUserId}-${item.status}`}
                      className="align-top hover:bg-[rgba(247,244,239,0.74)]"
                    >
                      <td className="px-4 py-4">{item.partnerName}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getRunSummaryStatusClass(item.status)}`}
                        >
                          {getRunSummaryStatusLabel(item.status, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <p>{item.businessCount}</p>
                        {item.businessNames.length ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {item.businessNames.join(", ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        {formatCurrencyFromCents(item.totalPaidCents, locale)}
                      </td>
                      <td className="px-4 py-4 break-all">{item.stripeTransferId ?? "—"}</td>
                      <td className="px-4 py-4">{item.failureMessage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-10 grid gap-6 xl:grid-cols-2">
        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">
            {locale === "it" ? "Pagamenti recenti" : "Recent payouts"}
          </h2>
          <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-[var(--foreground)]">
                <thead className="bg-[rgba(255,255,255,0.74)] text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  <tr>
                    <th className="px-4 py-4">{locale === "it" ? "Partner" : "Partner"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Metodo" : "Method"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Stato" : "Status"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Importo" : "Amount"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Data" : "Date"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Messaggio" : "Message"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(42,98,87,0.08)] bg-white/80">
                  {overview.payouts.map((payout) => (
                    <tr
                      key={`${payout.partnerUser.username}-${payout.initiatedAt.toISOString()}`}
                      className="align-top hover:bg-[rgba(247,244,239,0.74)]"
                    >
                      <td className="px-4 py-4">{payout.partnerUser.username}</td>
                      <td className="px-4 py-4">{payout.payoutMethod}</td>
                      <td className="px-4 py-4">{payout.status}</td>
                      <td className="px-4 py-4">
                        {formatCurrencyFromCents(payout.amountCents, locale)}
                      </td>
                      <td className="px-4 py-4">
                        {formatDate(payout.paidAt ?? payout.initiatedAt, locale)}
                      </td>
                      <td className="px-4 py-4">{payout.providerReference ?? payout.providerBatchId ?? payout.failureMessage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">
            {locale === "it" ? "Run e webhook" : "Runs and webhooks"}
          </h2>
          <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-[var(--foreground)]">
                <thead className="bg-[rgba(255,255,255,0.74)] text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  <tr>
                    <th className="px-4 py-4">{locale === "it" ? "Tipo" : "Type"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Stato" : "Status"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Data" : "Date"}</th>
                    <th className="px-4 py-4">{locale === "it" ? "Dettagli" : "Details"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(42,98,87,0.08)] bg-white/80">
                  {overview.runs.map((run) => (
                    <tr key={run.id} className="align-top hover:bg-[rgba(247,244,239,0.74)]">
                      <td className="px-4 py-4">{run.runKey}</td>
                      <td className="px-4 py-4">{run.status}</td>
                      <td className="px-4 py-4">{formatDate(run.scheduledFor, locale)}</td>
                      <td className="px-4 py-4">{run.lastError ?? "—"}</td>
                    </tr>
                  ))}
                  {overview.webhooks.slice(0, 4).map((webhook) => (
                    <tr key={webhook.id} className="align-top hover:bg-[rgba(247,244,239,0.74)]">
                      <td className="px-4 py-4">
                        <p>{webhook.eventType}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{webhook.endpointType}</p>
                      </td>
                      <td className="px-4 py-4">{webhook.status}</td>
                      <td className="px-4 py-4">
                        {formatDate(webhook.createdAt ?? null, locale)}
                      </td>
                      <td className="px-4 py-4">{webhook.errorMessage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
