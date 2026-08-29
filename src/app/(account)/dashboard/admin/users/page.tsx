import Link from "next/link";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { formatCurrencyFromCents } from "@/lib/account";
import {
  buildAdminUserSummary,
  filterAdminUserRecords,
  getAdminUserOverviewRecords,
} from "@/lib/admin-dashboard";
import { requireAdminViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

type AdminUsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const roleFilters = ["ALL", "ADMIN", "GETTER", "BUSINESS_OWNER", "USER"] as const;
const userSortOptions = [
  "partner-owed",
  "business-owed",
  "partner-paid",
  "money-collected",
  "latest-activity",
  "listings",
  "username",
] as const;
const directionOptions = ["desc", "asc"] as const;

type DashboardLocale = "it" | "en";
type UserSortKey = (typeof userSortOptions)[number];
type SortDirection = (typeof directionOptions)[number];

function getRoleLabel(role: (typeof roleFilters)[number], locale: DashboardLocale) {
  if (role === "ALL") {
    return locale === "it" ? "Tutti i ruoli" : "All roles";
  }

  if (role === "ADMIN") {
    return "Admin";
  }

  if (role === "GETTER") {
    return locale === "it" ? "Partner locale" : "Local Partner";
  }

  if (role === "BUSINESS_OWNER") {
    return locale === "it" ? "Proprietario attivita" : "Business owner";
  }

  return locale === "it" ? "Utente" : "User";
}

function formatDate(value: Date, locale: DashboardLocale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
  }).format(value);
}

function getUserSortLabel(sort: UserSortKey, locale: DashboardLocale) {
  const labels: Record<UserSortKey, { en: string; it: string }> = {
    "business-owed": {
      en: "Businesses still need to pay",
      it: "Attivita che devono ancora pagare",
    },
    "latest-activity": {
      en: "Latest activity",
      it: "Ultima attivita",
    },
    listings: {
      en: "Most listings",
      it: "Piu schede",
    },
    "money-collected": {
      en: "Money collected",
      it: "Soldi gia incassati",
    },
    "partner-owed": {
      en: "Partner money waiting",
      it: "Soldi partner da inviare",
    },
    "partner-paid": {
      en: "Money already paid to partners",
      it: "Soldi gia inviati ai partner",
    },
    username: {
      en: "Username",
      it: "Username",
    },
  };

  return labels[sort][locale];
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
  });
}

function getOperationalStatus(
  row: Awaited<ReturnType<typeof buildAdminUserSummary>>,
  locale: DashboardLocale,
) {
  if (row.role === "GETTER" && row.commissionSummary.available > 0) {
    return {
      label: locale === "it" ? "Da pagare" : "Need payout",
      className: "bg-[color:rgba(186,110,48,0.14)] text-[#9a5d1a]",
    };
  }

  if (row.submissionSummary.awaitingPayment > 0) {
    return {
      label: locale === "it" ? "Attende pagamento" : "Waiting for payment",
      className: "bg-[color:rgba(186,110,48,0.14)] text-[#9a5d1a]",
    };
  }

  if (row.submissionSummary.published > 0 || row.submissionSummary.liveBusinesses > 0) {
    return {
      label: locale === "it" ? "Attivo" : "Active",
      className: "bg-[color:rgba(39,124,92,0.12)] text-[#1f6c51]",
    };
  }

  if (row.submissionSummary.drafts > 0) {
    return {
      label: locale === "it" ? "Solo bozze" : "Draft only",
      className: "bg-[color:rgba(120,108,92,0.12)] text-[var(--muted)]",
    };
  }

  return {
    label: locale === "it" ? "Nessun movimento recente" : "Quiet",
    className: "bg-[color:rgba(120,108,92,0.12)] text-[var(--muted)]",
  };
}

function sortUserRows(
  rows: ReturnType<typeof buildAdminUserSummary>[],
  sort: UserSortKey,
  direction: SortDirection,
) {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    let comparison = 0;

    switch (sort) {
      case "business-owed":
        comparison =
          left.submissionSummary.listingFeesOutstanding -
          right.submissionSummary.listingFeesOutstanding;
        break;
      case "latest-activity":
        comparison = left.latestActivityAt.getTime() - right.latestActivityAt.getTime();
        break;
      case "listings":
        comparison = left.submissionSummary.submissions - right.submissionSummary.submissions;
        break;
      case "money-collected":
        comparison = left.submissionSummary.listingFeesPaid - right.submissionSummary.listingFeesPaid;
        break;
      case "partner-paid":
        comparison = left.commissionSummary.paid - right.commissionSummary.paid;
        break;
      case "username":
        comparison = compareText(left.username, right.username);
        break;
      case "partner-owed":
      default:
        comparison = left.commissionSummary.available - right.commissionSummary.available;
        break;
    }

    if (comparison !== 0) {
      return comparison * multiplier;
    }

    return compareText(left.username, right.username);
  });
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireAdminViewer();
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q) ?? "";
  const role = getSingleParam(resolvedSearchParams.role)?.toUpperCase() ?? "ALL";
  const sort = getSingleParam(resolvedSearchParams.sort) ?? "partner-owed";
  const direction = getSingleParam(resolvedSearchParams.dir) ?? "desc";
  const safeRole = roleFilters.includes(role as (typeof roleFilters)[number])
    ? (role as (typeof roleFilters)[number])
    : "ALL";
  const safeSort = userSortOptions.includes(sort as UserSortKey)
    ? (sort as UserSortKey)
    : "partner-owed";
  const safeDirection = directionOptions.includes(direction as SortDirection)
    ? (direction as SortDirection)
    : "desc";
  const [records, draftCount] = await Promise.all([
    getAdminUserOverviewRecords(),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
  ]);
  const filtered = filterAdminUserRecords(records, {
    query,
    role: safeRole,
  });
  const rows = sortUserRows(filtered.map(buildAdminUserSummary), safeSort, safeDirection);
  const totals = rows.reduce(
    (summary, row) => {
      summary.listingFeesOutstanding += row.submissionSummary.listingFeesOutstanding;
      summary.listingFeesPaid += row.submissionSummary.listingFeesPaid;
      summary.partnerAvailable += row.commissionSummary.available;
      summary.partnerPaid += row.commissionSummary.paid;
      summary.submissions += row.submissionSummary.submissions;
      return summary;
    },
    {
      listingFeesOutstanding: 0,
      listingFeesPaid: 0,
      partnerAvailable: 0,
      partnerPaid: 0,
      submissions: 0,
    },
  );
  const roleSummary = roleFilters
    .filter((value) => value !== "ALL")
    .map((value) => ({
      count: rows.filter((row) => row.roleLabel === value).length,
      value,
    }))
    .filter((entry) => entry.count > 0);

  const copy =
    locale === "it"
      ? {
          activeUsers: "Utenti trovati",
          allInfo:
            "Apri ogni utente per vedere il profilo completo, le schede inviate, le attivita collegate, i pagamenti e i guadagni partner.",
          clear: "Pulisci",
          detail: "Apri",
          email: "Email",
          feesOutstanding: "Soldi che le attivita devono ancora pagare",
          feesPaid: "Soldi gia incassati dalle attivita",
          filters: "Filtri admin",
          hometown: "Citta / area",
          latestActivity: "Ultima attivita",
          listings: "Schede",
          pageTitle: "Utenti e operazioni",
          partnerAvailable: "Soldi che dobbiamo ancora inviare ai partner",
          partnerPaid: "Soldi gia inviati ai partner",
          phone: "Telefono",
          profile: "Profilo",
          role: "Ruolo",
          search: "Cerca per username, email, nome o citta",
          section: "Vista admin",
          sort: "Ordina per",
          sortDirection: "Direzione",
          status: "Stato",
          subtitle:
            "Questa vista riunisce account, contatti, pagamenti, commissioni e stato operativo di ogni utente in un unico posto.",
          summary: "Ruoli nel filtro attivo",
          tableHint:
            "Vista tabellare per leggere velocemente soldi, attivita e stato di ogni account.",
          totalSubmissions: "Schede totali",
          unverified: "Non verificata",
          username: "Username",
          verified: "Verificata",
          viewUser: "Apri utente",
        }
      : {
          activeUsers: "Users found",
          allInfo:
            "Open any user to review the full profile, submitted listings, owned businesses, payments, and partner earnings.",
          clear: "Clear",
          detail: "Open",
          email: "Email",
          feesOutstanding: "Money businesses still need to pay",
          feesPaid: "Money already collected from businesses",
          filters: "Admin filters",
          hometown: "Home town / area",
          latestActivity: "Latest activity",
          listings: "Listings",
          pageTitle: "Users and operations",
          partnerAvailable: "Money we still need to send to partners",
          partnerPaid: "Money already sent to partners",
          phone: "Phone",
          profile: "Profile",
          role: "Role",
          search: "Search by username, email, name, or town",
          section: "Admin view",
          sort: "Sort by",
          sortDirection: "Direction",
          status: "Status",
          subtitle:
            "This view brings together accounts, contact data, payments, commissions, and operational status for every user in one place.",
          summary: "Role mix in current filter",
          tableHint:
            "Spreadsheet view for reading money, listings, and user status at a glance.",
          totalSubmissions: "Total submissions",
          unverified: "Unverified",
          username: "Username",
          verified: "Verified",
          viewUser: "Open user",
        };

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8">
        <div>
          <p className="section-kicker mb-2">{copy.section}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.pageTitle}</h1>
          <p className="mt-4 max-w-3xl text-[var(--muted)]">{copy.subtitle}</p>
        </div>
      </div>

      <div className="dashboard-nav-shell mb-8">
        <DashboardNav
          active="adminUsers"
          draftCount={draftCount}
          isAdmin
          locale={locale}
          role={viewer.role}
        />
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.activeUsers}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{rows.length}</p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.totalSubmissions}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{totals.submissions}</p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.feesPaid}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {formatCurrencyFromCents(totals.listingFeesPaid, locale)}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.feesOutstanding}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {formatCurrencyFromCents(totals.listingFeesOutstanding, locale)}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.partnerAvailable}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {formatCurrencyFromCents(totals.partnerAvailable, locale)}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.partnerPaid}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {formatCurrencyFromCents(totals.partnerPaid, locale)}
          </p>
        </article>
      </section>

      <section className="card mt-10 p-6 lg:p-8">
        <div className="grid gap-6">
          <div className="max-w-3xl">
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.filters}</h2>
            <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">{copy.allInfo}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{copy.tableHint}</p>
          </div>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1.4fr)_12rem_14rem_12rem]">
            <label className="field-label">
              <span className="text-sm font-medium text-[var(--foreground)]">{copy.search}</span>
              <input
                defaultValue={query}
                name="q"
                className="input-field"
                placeholder={copy.search}
              />
            </label>
            <label className="field-label">
              <span className="text-sm font-medium text-[var(--foreground)]">{copy.role}</span>
              <select name="role" className="input-field" defaultValue={safeRole}>
                {roleFilters.map((filterValue) => (
                  <option key={filterValue} value={filterValue}>
                    {getRoleLabel(filterValue, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span className="text-sm font-medium text-[var(--foreground)]">{copy.sort}</span>
              <select name="sort" className="input-field" defaultValue={safeSort}>
                {userSortOptions.map((value) => (
                  <option key={value} value={value}>
                    {getUserSortLabel(value, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span className="text-sm font-medium text-[var(--foreground)]">
                {copy.sortDirection}
              </span>
              <select name="dir" className="input-field" defaultValue={safeDirection}>
                <option value="desc">{locale === "it" ? "Decrescente" : "Descending"}</option>
                <option value="asc">{locale === "it" ? "Crescente" : "Ascending"}</option>
              </select>
            </label>
            <div className="md:col-span-2 xl:col-span-4">
              <div className="flex flex-col gap-3 rounded-[1.5rem] border border-[var(--border)] bg-[rgba(247,244,239,0.6)] p-4 sm:flex-row sm:items-center sm:justify-end">
                <button type="submit" className="btn-primary w-full sm:w-auto">
                  {locale === "it" ? "Applica" : "Apply"}
                </button>
                <Link
                  href="/dashboard/admin/users"
                  className="btn-secondary w-full justify-center sm:w-auto"
                >
                  {copy.clear}
                </Link>
              </div>
            </div>
          </form>
        </div>

        {roleSummary.length ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {roleSummary.map((entry) => (
              <span key={entry.value} className="pill-muted">
                {getRoleLabel(entry.value, locale)}: {entry.count}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-6 overflow-hidden rounded-[1.6rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)]">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full text-left text-sm text-[var(--foreground)]">
              <thead className="bg-[rgba(255,255,255,0.74)] text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                <tr>
                  <th className="px-4 py-4">{copy.username}</th>
                  <th className="px-4 py-4">{copy.role}</th>
                  <th className="px-4 py-4">{copy.email}</th>
                  <th className="px-4 py-4">{copy.phone}</th>
                  <th className="px-4 py-4">{copy.hometown}</th>
                  <th className="px-4 py-4">{copy.listings}</th>
                  <th className="px-4 py-4">{copy.feesOutstanding}</th>
                  <th className="px-4 py-4">{copy.partnerAvailable}</th>
                  <th className="px-4 py-4">{copy.partnerPaid}</th>
                  <th className="px-4 py-4">{copy.latestActivity}</th>
                  <th className="px-4 py-4">{copy.status}</th>
                  <th className="px-4 py-4">{copy.detail}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(42,98,87,0.08)] bg-white/80">
                {rows.map((row) => {
                  const status = getOperationalStatus(row, locale);

                  return (
                    <tr key={row.id} className="align-top hover:bg-[rgba(247,244,239,0.74)]">
                      <td className="px-4 py-4">
                        <Link
                          href={`/dashboard/admin/users/${row.id}`}
                          className="font-medium text-[var(--foreground)]"
                        >
                          {row.username}
                        </Link>
                        <p className="mt-1 text-sm text-[var(--muted)]">{row.displayName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {copy.profile}:{" "}
                          {row.profileCompleted
                            ? locale === "it"
                              ? "Completo"
                              : "Complete"
                            : locale === "it"
                              ? "Incompleto"
                              : "Incomplete"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className="pill">{getRoleLabel(row.roleLabel, locale)}</span>
                      </td>
                      <td className="px-4 py-4">
                        <p>{row.email}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {row.emailVerified ? copy.verified : copy.unverified}
                        </p>
                      </td>
                      <td className="px-4 py-4">{row.phone || "—"}</td>
                      <td className="px-4 py-4">{row.hometown || "—"}</td>
                      <td className="px-4 py-4">
                        <p className="font-medium">{row.submissionSummary.submissions}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {locale === "it" ? "Pubblicate" : "Published"}: {row.submissionSummary.published}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-medium">
                          {formatCurrencyFromCents(row.submissionSummary.listingFeesOutstanding, locale)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {locale === "it" ? "Schede in attesa" : "Listings waiting"}:{" "}
                          {row.submissionSummary.awaitingPayment}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        {formatCurrencyFromCents(row.commissionSummary.available, locale)}
                      </td>
                      <td className="px-4 py-4">
                        {formatCurrencyFromCents(row.commissionSummary.paid, locale)}
                      </td>
                      <td className="px-4 py-4">{formatDate(row.latestActivityAt, locale)}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Link href={`/dashboard/admin/users/${row.id}`} className="btn-secondary">
                          {copy.viewUser}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
