import Link from "next/link";
import { notFound } from "next/navigation";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { OwnedBusinessList } from "@/components/account/owned-business-list";
import { SubmissionList } from "@/components/account/submission-list";
import {
  formatCurrencyFromCents,
  getPaymentStatusLabel,
  getSubmissionStatusLabel,
} from "@/lib/account";
import {
  buildAdminUserSummary,
  getAdminUserDetailRecord,
} from "@/lib/admin-dashboard";
import { requireAdminViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

type AdminUserDetailPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

function getRoleLabel(role: string, locale: "it" | "en") {
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

function getBooleanLabel(value: boolean, locale: "it" | "en") {
  return value ? (locale === "it" ? "Si" : "Yes") : locale === "it" ? "No" : "No";
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireAdminViewer();
  const { userId } = await params;
  const [user, draftCount] = await Promise.all([
    getAdminUserDetailRecord(userId),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
  ]);

  if (!user) {
    notFound();
  }

  const summary = buildAdminUserSummary(user);
  const copy =
    locale === "it"
      ? {
          accountInfo: "Informazioni account",
          accountUse: "Accesso",
          back: "Torna a tutti gli utenti",
          claims: "Richieste di rivendica",
          connectedBusinesses: "Attivita collegate",
          detail: "Dettaglio utente admin",
          earningsAvailable: "Soldi da inviare",
          earningsPaid: "Soldi gia inviati",
          earningsTotal: "Guadagni totali",
          feesOutstanding: "Soldi che le attivita devono ancora pagare",
          feesPaid: "Soldi gia incassati dalle attivita",
          hometown: "Citta / area",
          listingFees: "Pagamenti schede",
          liveBusinesses: "Attivita live",
          noClaims: "Nessuna richiesta di rivendica registrata.",
          noPayouts: "Nessun payout registrato per questo utente.",
          noPartnerCommissions: "Nessuna commissione partner registrata.",
          partnerCommissions: "Commissioni partner",
          partnerPayouts: "Storico payout",
          profileData: "Dati profilo",
          recentListings: "Schede inviate",
          subtitle:
            "Qui puoi vedere tutte le informazioni utili per gestire l'account, monitorare i soldi e controllare le attivita inserite da questo utente.",
          summaryClaims: "Claim",
          summaryDrafts: "Bozze",
          summaryListings: "Schede",
          summaryOwed: "In attesa di pagamento",
          title: `Utente: ${user.username}`,
          userStatus: "Stato utente",
          verified: "Email verificata",
        }
      : {
          accountInfo: "Account information",
          accountUse: "Access",
          back: "Back to all users",
          claims: "Business claims",
          connectedBusinesses: "Connected businesses",
          detail: "Admin user detail",
          earningsAvailable: "Money still to send",
          earningsPaid: "Money already sent",
          earningsTotal: "Total earnings",
          feesOutstanding: "Money businesses still need to pay",
          feesPaid: "Money already collected from businesses",
          hometown: "Home town / area",
          listingFees: "Listing payments",
          liveBusinesses: "Live businesses",
          noClaims: "No business claims have been recorded for this user.",
          noPayouts: "No payout history has been recorded for this user.",
          noPartnerCommissions: "No partner commissions have been recorded.",
          partnerCommissions: "Partner commissions",
          partnerPayouts: "Payout history",
          profileData: "Profile data",
          recentListings: "Submitted listings",
          subtitle:
            "This view shows the account details, money flow, and business activity you would want on hand to manage this user.",
          summaryClaims: "Claims",
          summaryDrafts: "Drafts",
          summaryListings: "Listings",
          summaryOwed: "Awaiting payment",
          title: `User: ${user.username}`,
          userStatus: "User status",
          verified: "Email verified",
        };

  const accountRows = [
    ["Username", user.username],
    ["Email", user.email],
    [locale === "it" ? "Ruolo" : "Role", getRoleLabel(user.role, locale)],
    [copy.verified, getBooleanLabel(Boolean(user.emailVerified), locale)],
    [locale === "it" ? "Password impostata" : "Password set", getBooleanLabel(summary.hasPassword, locale)],
    [locale === "it" ? "Provider collegati" : "Linked providers", summary.linkedProviders.join(", ") || "credentials"],
    [locale === "it" ? "Profilo completo" : "Profile completed", getBooleanLabel(user.profileCompleted, locale)],
    [
      locale === "it" ? "Creato il" : "Created",
      new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
        dateStyle: "medium",
      }).format(user.createdAt),
    ],
    [
      locale === "it" ? "Ultimo aggiornamento" : "Last updated",
      new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
        dateStyle: "medium",
      }).format(user.updatedAt),
    ],
  ];
  const partnerRows = user.localPartnerProfile
    ? [
        [locale === "it" ? "Nome completo" : "Full name", user.localPartnerProfile.fullName],
        [locale === "it" ? "Nome legale" : "Legal full name", user.localPartnerProfile.legalFullName],
        [locale === "it" ? "Telefono" : "Phone", user.localPartnerProfile.phone],
        ["WhatsApp", user.localPartnerProfile.whatsapp || " - "],
        [copy.hometown, user.localPartnerProfile.baseTownOrArea],
        [
          locale === "it" ? "Lingua preferita" : "Preferred language",
          user.localPartnerProfile.preferredLanguage,
        ],
        [
          locale === "it" ? "Come ci ha trovati" : "How they heard about us",
          user.localPartnerProfile.heardAbout || " - ",
        ],
        [
          locale === "it" ? "Data di nascita" : "Birth date",
          user.localPartnerProfile.birthDate
            ? new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                dateStyle: "medium",
              }).format(user.localPartnerProfile.birthDate)
            : " - ",
        ],
        [
          locale === "it" ? "Indirizzo fatturazione" : "Billing address",
          user.localPartnerProfile.billingAddress,
        ],
        [
          locale === "it" ? "Codice fiscale / Partita IVA" : "Tax ID / VAT number",
          user.localPartnerProfile.taxIdOrVatNumber,
        ],
        [
          locale === "it" ? "Stato Stripe" : "Stripe status",
          user.localPartnerProfile.stripeAccountStatus,
        ],
        [
          locale === "it" ? "Payout abilitati" : "Payouts enabled",
          getBooleanLabel(user.localPartnerProfile.stripePayoutsEnabled, locale),
        ],
        [
          locale === "it" ? "Addebiti abilitati" : "Charges enabled",
          getBooleanLabel(user.localPartnerProfile.stripeChargesEnabled, locale),
        ],
        [
          locale === "it" ? "Conto payout" : "Payout account",
          user.localPartnerProfile.stripePayoutBankName
            ? `${user.localPartnerProfile.stripePayoutBankName} · ${user.localPartnerProfile.stripePayoutAccountLast4 ?? "----"}`
            : " - ",
        ],
        [
          locale === "it" ? "Account Stripe collegato" : "Connected Stripe account",
          user.localPartnerProfile.stripeConnectedAccountId || " - ",
        ],
      ]
    : [];

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8 flex flex-col gap-4">
        <Link href="/dashboard/admin/users" className="text-sm font-medium text-[var(--primary)]">
          {copy.back}
        </Link>
        <div>
          <p className="section-kicker mb-2">{copy.detail}</p>
          <h1 className="font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.summaryListings}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {summary.submissionSummary.submissions}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.summaryDrafts}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {summary.submissionSummary.drafts}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.summaryOwed}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {summary.submissionSummary.awaitingPayment}
          </p>
        </article>
        <article className="card p-5">
          <p className="text-sm text-[var(--muted)]">{copy.liveBusinesses}</p>
          <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
            {summary.submissionSummary.liveBusinesses}
          </p>
        </article>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.accountInfo}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {accountRows.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {label}
                </p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{value}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.userStatus}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {copy.listingFees}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {copy.feesPaid}: {formatCurrencyFromCents(summary.submissionSummary.listingFeesPaid, locale)}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {copy.feesOutstanding}:{" "}
                {formatCurrencyFromCents(summary.submissionSummary.listingFeesOutstanding, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {copy.partnerCommissions}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {copy.earningsTotal}: {formatCurrencyFromCents(summary.commissionSummary.totalEarned, locale)}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {copy.earningsAvailable}:{" "}
                {formatCurrencyFromCents(summary.commissionSummary.available, locale)}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {copy.earningsPaid}: {formatCurrencyFromCents(summary.commissionSummary.paid, locale)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {copy.connectedBusinesses}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {summary.submissionSummary.liveBusinesses}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                {copy.summaryClaims}
              </p>
              <p className="mt-2 text-base font-medium text-[var(--foreground)]">
                {summary.claimCount}
              </p>
            </div>
          </div>
        </article>
      </section>

      {partnerRows.length ? (
        <section className="card mt-6 p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.profileData}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {partnerRows.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  {label}
                </p>
                <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <div className="mb-5">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.recentListings}</h2>
        </div>
        <SubmissionList
          isAdmin
          locale={locale}
          role={viewer.role}
          returnPath={`/dashboard/admin/users/${user.id}`}
          submissions={user.submissions.map((submission) => ({
            amountOwedCents: submission.amountOwedCents,
            amountPaidCents: submission.amountPaidCents,
            bankTransferReference:
              submission.payments[0]?.bankTransferReference ?? submission.bankTransferReference,
            businessName: submission.businessName,
            categoryName: submission.category.name,
            createdAt: submission.createdAt,
            createdBusinessSlug: submission.createdBusiness?.slug,
            id: submission.id,
            paymentMethod: submission.paymentMethod,
            paymentStatus: submission.paymentStatus,
            status: submission.status,
            townName: submission.town.name,
          }))}
        />
      </section>

      <section className="mt-10">
        <div className="mb-5">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">
            {copy.connectedBusinesses}
          </h2>
        </div>
        <OwnedBusinessList
          businesses={user.ownedBusinesses.map((business) => ({
            address: business.address,
            categoryName: business.category.name,
            name: business.name,
            shortDescription: business.shortDescription,
            slug: business.slug,
            townName: business.town.name,
            updatedAt: business.updatedAt,
          }))}
          locale={locale}
        />
      </section>

      <section className="mt-10 grid gap-6 xl:grid-cols-2">
        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.partnerCommissions}</h2>
          {user.partnerCommissions.length ? (
            <div className="mt-5 grid gap-4">
              {user.partnerCommissions.map((commission, index) => (
                <div
                  key={`${commission.createdAt.toISOString()}-${index}`}
                  className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[var(--foreground)]">
                      {commission.business?.name ||
                        commission.businessSubmission?.businessName ||
                        (locale === "it" ? "Scheda partner" : "Partner submission")}
                    </p>
                    <p className="text-sm text-[var(--primary)]">{commission.status}</p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--foreground)]">
                    {formatCurrencyFromCents(commission.amountCents, locale)} · {commission.type}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                      dateStyle: "medium",
                    }).format(commission.earnedAt ?? commission.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 text-sm text-[var(--muted)]">{copy.noPartnerCommissions}</div>
          )}
        </article>

        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.partnerPayouts}</h2>
          {user.partnerPayouts.length ? (
            <div className="mt-5 grid gap-4">
              {user.partnerPayouts.map((payout) => (
                <div
                  key={payout.id}
                  className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[var(--foreground)]">{payout.status}</p>
                    <p className="text-sm text-[var(--primary)]">
                      {formatCurrencyFromCents(payout.amountCents, locale)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                      dateStyle: "medium",
                    }).format(payout.initiatedAt)}
                  </p>
                  {payout.bankName ? (
                    <p className="mt-2 text-sm text-[var(--foreground)]">
                      {payout.bankName} · {payout.bankAccountLast4 ?? "----"}
                    </p>
                  ) : null}
                  {payout.failureMessage ? (
                    <p className="mt-2 text-sm text-[var(--foreground)]">{payout.failureMessage}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 text-sm text-[var(--muted)]">{copy.noPayouts}</div>
          )}
        </article>
      </section>

      <section className="mt-10 grid gap-6 xl:grid-cols-2">
        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.claims}</h2>
          {user.claims.length ? (
            <div className="mt-5 grid gap-4">
              {user.claims.map((claim) => (
                <div
                  key={claim.id}
                  className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-[var(--foreground)]">
                      {claim.business.name}
                    </p>
                    <p className="text-sm text-[var(--primary)]">{claim.status}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-[var(--muted)]">
                    <span>
                      {new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
                        dateStyle: "medium",
                      }).format(claim.createdAt)}
                    </span>
                    <Link href={`/businesses/${claim.business.slug}`} className="text-[var(--primary)]">
                      {locale === "it" ? "Apri attivita" : "Open business"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 text-sm text-[var(--muted)]">{copy.noClaims}</div>
          )}
        </article>

        <article className="card p-6">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">
            {locale === "it" ? "Stato schede" : "Listing state snapshot"}
          </h2>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                  <th className="px-4 pb-2">{locale === "it" ? "Scheda" : "Listing"}</th>
                  <th className="px-4 pb-2">{locale === "it" ? "Stato" : "Status"}</th>
                  <th className="px-4 pb-2">{locale === "it" ? "Pagamento" : "Payment"}</th>
                  <th className="px-4 pb-2">{copy.feesPaid}</th>
                  <th className="px-4 pb-2">{copy.feesOutstanding}</th>
                </tr>
              </thead>
              <tbody>
                {user.submissions.map((submission) => (
                  <tr
                    key={submission.id}
                    className="rounded-[1.4rem] bg-[color:rgba(247,244,239,0.62)] text-sm text-[var(--foreground)]"
                  >
                    <td className="rounded-l-[1.4rem] px-4 py-4">
                      <p className="font-medium">{submission.businessName}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{submission.town.name}</p>
                    </td>
                    <td className="px-4 py-4">
                      {getSubmissionStatusLabel(submission.status, locale)}
                    </td>
                    <td className="px-4 py-4">
                      {getPaymentStatusLabel(
                        submission.paymentStatus,
                        locale,
                        submission.payments[0]?.bankTransferReference ??
                          submission.bankTransferReference,
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {formatCurrencyFromCents(submission.amountPaidCents, locale)}
                    </td>
                    <td className="rounded-r-[1.4rem] px-4 py-4">
                      {formatCurrencyFromCents(
                        submission.paymentMethod && submission.paymentStatus !== "PAID"
                          ? Math.max(submission.amountOwedCents - submission.amountPaidCents, 0)
                          : 0,
                        locale,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
