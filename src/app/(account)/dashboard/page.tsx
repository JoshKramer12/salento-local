import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { AdminPartnerPayoutButton } from "@/components/account/admin-partner-payout-button";
import { PartnerOutstandingCommissionCard } from "@/components/account/partner-outstanding-commission-card";
import { PartnerPayoutSummary } from "@/components/account/partner-payout-summary";
import { PartnerDashboard } from "@/components/account/partner-dashboard";
import { PartnerFirstBusinessDashboard } from "@/components/account/partner-first-business-dashboard";
import {
  BusinessOwnerDashboard,
} from "@/components/account/business-owner-dashboard";
import { BusinessOwnerWorkspaceNav } from "@/components/account/business-owner-account-nav";
import { OwnedBusinessList } from "@/components/account/owned-business-list";
import { SubmissionList } from "@/components/account/submission-list";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import {
  buildSubmissionTotals,
  formatCurrencyFromCents,
  getPaymentStatusLabel,
  getSubmissionStatusLabel,
  isDraftLikeSubmission,
} from "@/lib/account";
import { scheduleAccountRouteSync } from "@/lib/account-route-sync";
import {
  getAdminDashboardData,
  type AdminDashboardBreakdownItem,
} from "@/lib/admin-dashboard";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { shouldShowPartnerFirstBusinessDashboard } from "@/lib/partner-first-business-dashboard";
import { getPartnerPayoutSetupSummary } from "@/lib/partner-connect";
import {
  getPartnerBalanceSummary,
  getPartnerOutstandingCommissionItems,
  getPartnerPayoutHistory,
} from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

type DashboardLocale = "it" | "en";
type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function rendersBusinessOwnerDashboard(role: string): boolean {
  return role === "BUSINESS_OWNER";
}

function formatDashboardDate(locale: DashboardLocale, value: Date) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    dateStyle: "medium",
  }).format(value);
}

function getRoleLabel(role: string, locale: DashboardLocale) {
  if (role === "ADMIN") {
    return "Admin";
  }

  if (role === "GETTER") {
    return locale === "it" ? "Partner locale" : "Local partner";
  }

  if (role === "BUSINESS_OWNER") {
    return locale === "it" ? "Proprietario attività" : "Business owner";
  }

  return locale === "it" ? "Utente" : "User";
}

function getHeardAboutLabel(value: string, locale: DashboardLocale) {
  const labels: Record<string, { en: string; it: string }> = {
    "business-owner": {
      en: "Business owner",
      it: "Titolare attività",
    },
    "friend-family": {
      en: "Friend or family",
      it: "Amici o famiglia",
    },
    "local-event": {
      en: "Local event",
      it: "Evento locale",
    },
    "online-search": {
      en: "Online search",
      it: "Ricerca online",
    },
    other: {
      en: "Other",
      it: "Altro",
    },
    "social-media": {
      en: "Social media",
      it: "Social media",
    },
  };

  const normalized = value.trim().toLowerCase();
  const label = labels[normalized];

  return label ? label[locale] : value;
}

function getSubmissionStatusSummaryLabel(value: string, locale: DashboardLocale) {
  const labels: Record<string, { en: string; it: string }> = {
    APPROVED: { en: "Approved", it: "Approvate" },
    AWAITING_PAYMENT: { en: "Awaiting payment", it: "In attesa di pagamento" },
    AWAITING_VERIFICATION: { en: "Awaiting verification", it: "In attesa di verifica" },
    DRAFT: { en: "Drafts", it: "Bozze" },
    NEEDS_REVIEW: { en: "Needs review", it: "Da rivedere" },
    PAID: { en: "Paid", it: "Pagate" },
    PAYMENT_CONFIRMED: { en: "Payment confirmed", it: "Pagamento confermato" },
    PAYMENT_PENDING: { en: "Payment pending", it: "Pagamento in corso" },
    PENDING_REVIEW: { en: "Pending review", it: "In revisione" },
    PUBLISHED: { en: "Published", it: "Pubblicate" },
    READY_TO_PUBLISH: { en: "Ready to publish", it: "Pronte a pubblicare" },
    REJECTED: { en: "Rejected", it: "Rifiutate" },
    VERIFIED: { en: "Verified", it: "Verificate" },
  };

  return labels[value]?.[locale] ?? value;
}

function getPaymentMethodLabel(value: string, locale: DashboardLocale) {
  const labels: Record<string, { en: string; it: string }> = {
    BANK_TRANSFER: { en: "Bank transfer", it: "Bonifico" },
    CASH: { en: "Cash", it: "Contanti" },
    ONLINE: { en: "Online", it: "Online" },
    OTHER: { en: "Other", it: "Altro" },
  };

  return labels[value]?.[locale] ?? value;
}

function getPayoutBannerCopy(status: string | null, locale: DashboardLocale) {
  switch (status) {
    case "completed":
      return locale === "it"
        ? "Pagamento partner avviato. Questa pagina mostra ora chi e stato incluso nel run."
        : "Partner payout started. This page now shows who was included in the run.";
    case "partial":
      return locale === "it"
        ? "Alcuni partner sono stati avviati al pagamento, altri richiedono attenzione."
        : "Some partners were sent for payout, while others still need attention.";
    case "failed":
      return locale === "it"
        ? "Il pagamento partner non è partito. Controlla la configurazione Stripe e riprova."
        : "The partner payout did not start. Check the Stripe setup and try again.";
    default:
      return "";
  }
}

function MetricCard({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string | number;
}) {
  return (
    <article className="card p-5">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{value}</p>
      {detail ? <p className="mt-3 text-sm text-[var(--muted)]">{detail}</p> : null}
    </article>
  );
}

function BreakdownCard({
  empty,
  formatter,
  items,
  subtitle,
  title,
}: {
  empty: string;
  formatter?: (value: string) => string;
  items: AdminDashboardBreakdownItem[];
  subtitle?: string;
  title: string;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <article className="card p-6">
      <h2 className="font-serif text-3xl text-[var(--foreground)]">{title}</h2>
      {subtitle ? <p className="mt-3 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      {items.length ? (
        <div className="mt-6 grid gap-4">
          {items.map((item) => {
            const width = total > 0 ? Math.max((item.count / total) * 100, 8) : 0;

            return (
              <div key={item.key}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--foreground)]">
                    {formatter ? formatter(item.key) : item.key}
                  </span>
                  <span className="text-[var(--muted)]">{item.count}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--secondary)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),rgba(42,98,87,0.62))]"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--muted)]">{empty}</p>
      )}
    </article>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), requireCompletedViewer()]);

  if (viewer.role === "GETTER") {
    const profile = await prisma.localPartnerProfile.findUnique({
      where: { userId: viewer.id },
      select: { completedAt: true, partnerOnboardingCompletedAt: true },
    });
    const nextRoute = getPartnerNextRoute(profile);

    if (nextRoute !== "/dashboard") {
      redirect(nextRoute);
    }
  }

  scheduleAccountRouteSync(viewer.id, viewer.role);

  // Business owners have a dedicated control centre. Keeping this branch before
  // the shared partner/admin data work makes the role boundary explicit and
  // avoids changing either of those dashboards.
  if (rendersBusinessOwnerDashboard(viewer.role)) {
    const businesses = await prisma.business.findMany({
        where: {
          OR: [
            { ownerUserId: viewer.id },
            { ownerAccesses: { some: { userId: viewer.id } } },
          ],
        },
        select: {
          address: true,
          category: { select: { name: true, slug: true } },
          description: true,
          heroImageSeed: true,
          id: true,
          images: {
            orderBy: { sortOrder: "asc" },
            select: { alt: true, id: true, url: true },
          },
          locality: { select: { name: true } },
          membership: {
            select: {
              annualPriceCents: true,
              automaticRenewal: true,
              currentPeriodEnd: true,
              entitlementRevokedAt: true,
              graceEndsAt: true,
              recurringPaymentReady: true,
              stripeCancelAtPeriodEnd: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
              stripeSubscriptionStatus: true,
            },
          },
          name: true,
          payments: {
            where: { status: "PAID" },
            orderBy: { paidAt: "desc" },
            select: {
              createdAt: true,
              paidAt: true,
              status: true,
              purpose: true,
              businessSubmission: {
                select: { id: true, listingTermMonthsAtAcceptance: true },
              },
            },
            take: 1,
          },
          phone: true,
          rating: true,
          reviewCount: true,
          reviews: {
            orderBy: { createdAt: "desc" },
            select: {
              authorName: true,
              body: true,
              createdAt: true,
              id: true,
              rating: true,
              title: true,
            },
            take: 2,
          },
          submissions: {
            orderBy: { createdAt: "desc" },
            select: { photoUrls: true },
            take: 1,
          },
          shortDescription: true,
          slug: true,
          tags: { select: { tag: { select: { name: true } } } },
          town: { select: { name: true } },
          website: true,
        },
        orderBy: { updatedAt: "desc" },
      });
    const displayName = viewer.name?.trim() || viewer.username;
    const firstName = displayName.split(/\s+/)[0] || viewer.username;

    return (
      <>
        <BusinessOwnerWorkspaceNav active="businesses" locale={locale} />
        <BusinessOwnerDashboard
          businesses={businesses}
          firstName={firstName}
          locale={locale}
        />
      </>
    );
  }

  const resolvedSearchParams = await searchParams;
  const payoutStatus = getSingleParam(resolvedSearchParams.payoutStatus);

  const [
    submissions,
    partnerBalances,
    partnerOutstandingCommissions,
    partnerHistory,
    partnerSetup,
    partnerRecentCommissions,
    adminDashboard,
    ownedBusinesses,
  ] = await Promise.all([
    prisma.businessSubmission.findMany({
      where: {
        userId: viewer.id,
      },
      select: {
        amountOwedCents: true,
        amountPaidCents: true,
        bankTransferReference: true,
        businessName: true,
        category: {
          select: {
            name: true,
            slug: true,
          },
        },
        commissionCents: true,
        createdAt: true,
        createdBusiness: {
          select: {
            images: {
              orderBy: { sortOrder: "asc" },
              select: { alt: true, url: true },
              take: 1,
            },
            slug: true,
          },
        },
        id: true,
        paymentMethod: true,
        paymentStatus: true,
        photoUrls: true,
        payments: {
          orderBy: {
            createdAt: "desc",
          },
          select: {
            bankTransferReference: true,
          },
          take: 1,
        },
        status: true,
        town: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    viewer.role === "GETTER" ? getPartnerBalanceSummary(viewer.id) : Promise.resolve(null),
    viewer.role === "GETTER"
      ? getPartnerOutstandingCommissionItems(viewer.id)
      : Promise.resolve([]),
    viewer.role === "GETTER" ? getPartnerPayoutHistory(viewer.id) : Promise.resolve([]),
    viewer.role === "GETTER"
      ? getPartnerPayoutSetupSummary(viewer.id)
      : Promise.resolve(null),
    viewer.role === "GETTER"
      ? prisma.partnerCommission.findMany({
          where: {
            partnerUserId: viewer.id,
            type: "COMMISSION",
            status: { not: "REVERSED" },
          },
          orderBy: [{ earnedAt: "desc" }, { createdAt: "desc" }],
          take: 5,
          select: {
            amountCents: true,
            business: { select: { name: true } },
            businessSubmission: { select: { businessName: true } },
            createdAt: true,
            earnedAt: true,
            id: true,
            payment: { select: { purpose: true } },
            sourceKey: true,
          },
        })
      : Promise.resolve([]),
    viewer.role === "ADMIN" ? getAdminDashboardData() : Promise.resolve(null),
    viewer.role === "BUSINESS_OWNER"
      ? prisma.business.findMany({
          where: {
            OR: [
              { ownerUserId: viewer.id },
              { ownerAccesses: { some: { userId: viewer.id } } },
            ],
          },
          include: {
            category: { select: { name: true } },
            images: { orderBy: { sortOrder: "asc" }, select: { url: true }, take: 1 },
            town: { select: { name: true } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const totals = buildSubmissionTotals(submissions, viewer.role);
  const submittedCount = submissions.filter(
    (submission) => !isDraftLikeSubmission(submission),
  ).length;
  const visibleRecentSubmissions = submissions
    .slice(0, 6)
    .filter((submission) => !isDraftLikeSubmission(submission));
  const copy =
    locale === "it"
      ? {
          addBusiness: "Aggiungi attività",
          addBusinessAdmin: "Aggiungi attività: Admin",
          addOwnBusiness: "Aggiungi la tua attività",
          addPartnerBusiness: "Raccogli una scheda",
          adminAttention: "Attenzione operativa",
          adminAttentionBody:
            "Monitora subito cosa entra, da dove arrivano gli utenti, chi sta pubblicando di piu e quali schede richiedono un intervento.",
          adminClaims: "Claim recenti",
          adminContributors: "Chi pubblica di piu",
          adminOverview: "Panoramica admin",
          adminQuickActions: "Azioni rapide admin",
          adminQuickActionsBody:
            "Gestisci nuovi inserimenti e partner payout da un unico pannello ordinato.",
          adminRecentSubmissions: "Schede da monitorare",
          adminRecentUsers: "Nuovi utenti",
          adminSources: "Da dove arrivano",
          adminStatus: "Pipeline schede",
          adminTerritory: "Aree partner",
          body: "Controlla bozze, schede inviate e riepilogo economico senza uscire dal tuo spazio di lavoro.",
          ownerBody:
            "Da qui puoi aggiungere la tua attività, completare la scheda e arrivare al pagamento finale come nel flusso normale.",
          partnerBody:
            "Aiuta le attività del territorio a entrare nella directory, segui le schede inviate e controlla guadagni totali, commissioni da pagare e importi già liquidati.",
          partnerEmptyBody:
            "Aggiungi la prima attività locale per iniziare a seguire una scheda e il suo compenso.",
          partnerEmptyTitle: "Pronto a guadagnare?",
          eyebrow: "Area account",
          recent:
            viewer.role === "GETTER" ? "Le tue segnalazioni recenti" : "Le tue attività recenti",
          title: `Ciao ${viewer.username}`,
          viewAll: "Vedi tutte",
        }
      : {
          addBusiness: "Add a business",
          addBusinessAdmin: "Add business: Admin",
          addOwnBusiness: "Add your business",
          addPartnerBusiness: "Submit a listing",
          adminAttention: "Operations queue",
          adminAttentionBody:
            "See what is coming in, where users are coming from, who is publishing the most, and which listings need action right now.",
          adminClaims: "Recent claims",
          adminContributors: "Top contributors",
          adminOverview: "Admin overview",
          adminQuickActions: "Admin quick actions",
          adminQuickActionsBody:
            "Handle new listings and partner payouts from one tidy control panel.",
          adminRecentSubmissions: "Listings to watch",
          adminRecentUsers: "New users",
          adminSources: "Where users come from",
          adminStatus: "Listing pipeline",
          adminTerritory: "Partner base areas",
          body: "Review drafts, sent listings, and the money summary from one calm workspace.",
          ownerBody:
            "From here you can add your own business, complete the listing, and pay at the end through the normal flow.",
          partnerBody:
            "Help local businesses join the directory, keep track of submitted listings, and monitor total earnings, unpaid commissions, and amounts already paid out.",
          partnerEmptyBody:
            "Add your first local business to start tracking a listing and its earnings.",
          partnerEmptyTitle: "Ready to earn?",
          eyebrow: "Account area",
          recent:
            viewer.role === "GETTER" ? "Your recent submissions" : "Your recent businesses",
          title: `Welcome ${viewer.username}`,
          viewAll: "View all",
        };
  const primaryBusinessCta =
    viewer.role === "BUSINESS_OWNER"
      ? copy.addOwnBusiness
      : viewer.role === "GETTER"
        ? copy.addPartnerBusiness
        : copy.addBusiness;
  const bodyCopy =
    viewer.role === "BUSINESS_OWNER"
      ? copy.ownerBody
      : viewer.role === "GETTER"
        ? copy.partnerBody
        : viewer.role === "ADMIN"
          ? copy.adminAttentionBody
          : copy.body;
  const listingStats = [
    {
      label: locale === "it" ? "Attività inviate" : "Businesses submitted",
      value: submittedCount,
    },
    {
      label: locale === "it" ? "Bozze" : "Drafts",
      value: totals.drafts,
    },
    {
      label: locale === "it" ? "Pubblicate" : "Published",
      value: totals.published,
    },
  ];
  const ownerPaymentDueCents = submissions.reduce(
    (total, submission) =>
      submission.paymentStatus === "PAID"
        ? total
        : total + Math.max(submission.amountOwedCents - submission.amountPaidCents, 0),
    0,
  );
  const moneyStats =
    viewer.role === "GETTER" && partnerBalances
      ? [
          {
            label: locale === "it" ? "Guadagni totali" : "Total earnings",
            value: formatCurrencyFromCents(partnerBalances.totalEarned, locale),
          },
          {
            label: locale === "it" ? "Da pagare" : "To be paid",
            value: formatCurrencyFromCents(partnerBalances.available, locale),
          },
          {
            label: locale === "it" ? "Pagato" : "Paid",
            value: formatCurrencyFromCents(partnerBalances.paid, locale),
          },
        ]
      : viewer.role === "BUSINESS_OWNER"
        ? [
            {
              label: locale === "it" ? "Pagamento ancora dovuto" : "Payment still due",
              value: formatCurrencyFromCents(ownerPaymentDueCents, locale),
            },
            {
              label: locale === "it" ? "Totale pagato" : "Total paid",
              value: formatCurrencyFromCents(totals.paid, locale),
            },
          ]
        : [
          {
            label: locale === "it" ? "Guadagni totali" : "Total earnings",
            value: formatCurrencyFromCents(totals.earned, locale),
          },
          {
            label: locale === "it" ? "Importo ancora da ricevere" : "Money still to receive",
            value: formatCurrencyFromCents(totals.owed, locale),
          },
          {
            label: locale === "it" ? "Pagato" : "Paid",
            value: formatCurrencyFromCents(totals.paid, locale),
          },
        ];
  const partnerTopStats = [
    ...listingStats,
    {
      label: locale === "it" ? "In attesa di pagamento" : "Awaiting payment",
      value: totals.awaitingPayment,
    },
  ];
  const generalStats = [
    ...listingStats.slice(0, 2),
    {
      label: locale === "it" ? "In attesa di pagamento" : "Awaiting payment",
      value: totals.awaitingPayment,
    },
    ...moneyStats,
  ];
  const payoutBannerCopy = getPayoutBannerCopy(payoutStatus, locale);
  const totalProfitCents =
    viewer.role === "ADMIN" && adminDashboard
      ? adminDashboard.highlights.listingFeesPaid - adminDashboard.highlights.partnerCommissionsPaid
      : 0;

  if (viewer.role === "GETTER" && partnerBalances) {
    if (shouldShowPartnerFirstBusinessDashboard(submissions.length)) {
      return <PartnerFirstBusinessDashboard locale={locale} username={viewer.username} />;
    }

    return (
      <PartnerDashboard
        balances={partnerBalances}
        history={partnerHistory}
        locale={locale}
        recentCommissions={partnerRecentCommissions}
        setup={partnerSetup}
        submissions={submissions}
        totals={totals}
        username={viewer.username}
      />
    );
  }

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)] lg:items-start">
        <div className="min-w-0 lg:pt-2">
          <p className="section-kicker mb-2">
            {viewer.role === "ADMIN" ? copy.adminOverview : copy.eyebrow}
          </p>
          <h1 className="break-words font-serif text-4xl text-[var(--foreground)]">{copy.title}</h1>
          <p className="mt-4 max-w-3xl text-[var(--muted)]">{bodyCopy}</p>
        </div>
        {viewer.role === "ADMIN" ? (
          <section className="card p-6 sm:p-7">
            <p className="section-kicker mb-2">{copy.adminQuickActions}</p>
            <p className="mb-5 text-sm leading-7 text-[var(--muted)]">
              {copy.adminQuickActionsBody}
            </p>
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <HardNavigationLink
                  href="/publish"
                  className="btn-secondary w-full justify-center"
                >
                  {primaryBusinessCta}
                </HardNavigationLink>
                <HardNavigationLink
                  href="/publish?mode=admin"
                  className="btn-secondary w-full justify-center"
                >
                  {copy.addBusinessAdmin}
                </HardNavigationLink>
              </div>
              <AdminPartnerPayoutButton locale={locale} wide />
            </div>
          </section>
        ) : (
          <div className="flex w-full flex-wrap justify-end gap-3 lg:min-h-[12rem] lg:items-end">
            <HardNavigationLink href="/publish" className="btn-primary">
              {primaryBusinessCta}
            </HardNavigationLink>
          </div>
        )}
      </div>

      <div className="dashboard-nav-shell mb-8">
        <DashboardNav
          active="dashboard"
          draftCount={totals.drafts}
          isAdmin={viewer.role === "ADMIN"}
          locale={locale}
          role={viewer.role}
        />
      </div>

      {viewer.role === "BUSINESS_OWNER" ? (
        <section className="mb-10 rounded-[1.75rem] border border-[color:rgba(42,98,87,0.18)] bg-[color:rgba(42,98,87,0.05)] p-5 sm:p-6">
          <div className="mb-5">
            <p className="section-kicker mb-2">{locale === "it" ? "Attività collegata" : "Connected business"}</p>
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{locale === "it" ? "La tua attività" : "Your business"}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{locale === "it" ? "La tua attività pubblicata è pronta da gestire. Apri Modifica attività solo quando vuoi aggiornare la scheda." : "Your published business is ready to manage. Open Edit business only when you want to update the listing."}</p>
          </div>
          <OwnedBusinessList
            businesses={ownedBusinesses.map((business) => ({
              address: business.address,
              categoryName: business.category.name,
              imageUrl: business.images[0]?.url,
              name: business.name,
              shortDescription: business.shortDescription,
              slug: business.slug,
              townName: business.town.name,
              updatedAt: business.updatedAt,
            }))}
            locale={locale}
          />
        </section>
      ) : null}

      {viewer.role === "ADMIN" && adminDashboard ? (
        <>
          <div className="mb-6">
            <HardNavigationLink className="btn-secondary" href="/dashboard/admin/memberships">
              {locale === "it" ? "Visualizza membership" : "View memberships"}
            </HardNavigationLink>
          </div>
          {payoutBannerCopy ? (
            <section className="mb-8 rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-5 py-4 text-sm text-[var(--foreground)]">
              {payoutBannerCopy}
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={locale === "it" ? "Utenti totali" : "Total users"}
              value={adminDashboard.highlights.totalUsers}
              detail={`${adminDashboard.highlights.completedProfiles} ${
                locale === "it" ? "profili completi" : "completed profiles"
              }`}
            />
            <MetricCard
              label={locale === "it" ? "Attività live" : "Live businesses"}
              value={adminDashboard.highlights.liveBusinesses}
              detail={`${adminDashboard.highlights.published} ${
                locale === "it" ? "schede pubblicate" : "published listings"
              }`}
            />
            <MetricCard
              label={locale === "it" ? "Schede totali" : "Total submissions"}
              value={adminDashboard.highlights.submissions}
              detail={`${adminDashboard.highlights.drafts} ${
                locale === "it" ? "bozze" : "drafts"
              }`}
            />
            <MetricCard
              label={
                locale === "it"
                  ? "Attività che devono ancora pagare"
                  : "Businesses that still need to pay"
              }
              value={adminDashboard.highlights.awaitingPayment}
              detail={`${
                locale === "it" ? "Valore ancora da incassare" : "Money still to collect"
              }: ${formatCurrencyFromCents(
                adminDashboard.highlights.listingFeesOutstanding,
                locale,
              )}`}
            />
            <MetricCard
              label={
                locale === "it"
                  ? "Totale incassato dalle attività"
                  : "Total amount collected from businesses"
              }
              value={formatCurrencyFromCents(adminDashboard.highlights.listingFeesPaid, locale)}
              detail={`${adminDashboard.highlights.needsReview} ${
                locale === "it" ? "schede da rivedere" : "listings needing review"
              }`}
            />
            <MetricCard
              label={
                locale === "it"
                  ? "Soldi ancora dovuti ai partner"
                  : "Money still owed to partners"
              }
              value={formatCurrencyFromCents(
                adminDashboard.highlights.partnerCommissionsDue,
                locale,
              )}
              detail={`${
                locale === "it" ? "Già inviati ai partner" : "Already sent to partners"
              }: ${formatCurrencyFromCents(
                adminDashboard.highlights.partnerCommissionsPaid,
                locale,
              )}`}
            />
            <MetricCard
              label={locale === "it" ? "Profitto totale" : "Total profit"}
              value={formatCurrencyFromCents(totalProfitCents, locale)}
              detail={
                locale === "it"
                  ? "Totale incassato meno tutti i pagamenti partner."
                  : "Total collected minus all partner payouts."
              }
            />
            <MetricCard
              label={locale === "it" ? "Totale pagato ai partner" : "Total money paid to partners"}
              value={formatCurrencyFromCents(
                adminDashboard.highlights.partnerCommissionsPaid,
                locale,
              )}
              detail={`${adminDashboard.highlights.getters} ${
                locale === "it" ? "partner totali" : "total partners"
              }`}
            />
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-3">
            <BreakdownCard
              empty={locale === "it" ? "Nessun ruolo disponibile." : "No role data yet."}
              formatter={(value) => getRoleLabel(value, locale)}
              items={adminDashboard.roleBreakdown}
              subtitle={
                locale === "it"
                  ? "Capisci subito la composizione della base utenti."
                  : "See the user mix at a glance."
              }
              title={locale === "it" ? "Ruoli utenti" : "User roles"}
            />
            <BreakdownCard
              empty={locale === "it" ? "Nessuna fonte registrata." : "No source data yet."}
              formatter={(value) => getHeardAboutLabel(value, locale)}
              items={adminDashboard.sourceBreakdown}
              subtitle={
                locale === "it"
                  ? "Le fonti di acquisizione partner piu frequenti."
                  : "Top partner acquisition sources."
              }
              title={copy.adminSources}
            />
            <BreakdownCard
              empty={locale === "it" ? "Nessuna area disponibile." : "No area data yet."}
              items={adminDashboard.hometownBreakdown}
              subtitle={
                locale === "it"
                  ? "Dove si concentra la rete partner."
                  : "Where the partner network is concentrated."
              }
              title={copy.adminTerritory}
            />
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <BreakdownCard
              empty={locale === "it" ? "Nessuna scheda registrata." : "No listings recorded yet."}
              formatter={(value) => getSubmissionStatusSummaryLabel(value, locale)}
              items={adminDashboard.submissionStatusBreakdown}
              subtitle={
                locale === "it"
                  ? "Vedi subito dove si blocca il funnel."
                  : "See where the listing funnel is getting stuck."
              }
              title={copy.adminStatus}
            />
            <BreakdownCard
              empty={
                locale === "it" ? "Nessun metodo di pagamento registrato." : "No payment mix yet."
              }
              formatter={(value) => getPaymentMethodLabel(value, locale)}
              items={adminDashboard.paymentMethodBreakdown}
              subtitle={
                locale === "it"
                  ? "Come stanno scegliendo di pagare le attività."
                  : "How businesses are choosing to pay."
              }
              title={locale === "it" ? "Metodi di pagamento" : "Payment methods"}
            />
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <article className="card p-6">
              <h2 className="font-serif text-3xl text-[var(--foreground)]">
                {copy.adminContributors}
              </h2>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {locale === "it"
                  ? "Le persone che stanno inserendo più schede e producendo più attività."
                  : "The people posting the most listings and generating the most activity."}
              </p>
              <div className="mt-6 grid gap-4">
                {adminDashboard.topContributors.map((contributor) => (
                  <div
                    key={contributor.id}
                    className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {contributor.username}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {getRoleLabel(contributor.role, locale)}
                          {contributor.hometown ? ` · ${contributor.hometown}` : ""}
                        </p>
                      </div>
                      <HardNavigationLink
                        href={`/dashboard/admin/users/${contributor.id}`}
                        className="btn-secondary"
                      >
                        {locale === "it" ? "Apri" : "Open"}
                      </HardNavigationLink>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm text-[var(--foreground)] sm:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                          {locale === "it" ? "Schede" : "Listings"}
                        </p>
                        <p className="mt-1">{contributor.submissions}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                          {locale === "it" ? "Pubblicate" : "Published"}
                        </p>
                        <p className="mt-1">{contributor.published}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                          {locale === "it" ? "Live" : "Live"}
                        </p>
                        <p className="mt-1">{contributor.liveBusinesses}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent)]">
                          {locale === "it" ? "Incassato" : "Fees paid"}
                        </p>
                        <p className="mt-1">
                          {formatCurrencyFromCents(contributor.feesPaid, locale)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 text-xs text-[var(--muted)]">
                      {locale === "it" ? "Ultima attività" : "Latest activity"}:{" "}
                      {formatDashboardDate(locale, contributor.latestActivityAt)}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article className="card p-6">
              <h2 className="font-serif text-3xl text-[var(--foreground)]">
                {copy.adminRecentUsers}
              </h2>
              <p className="mt-3 text-sm text-[var(--muted)]">
                {locale === "it"
                  ? "Gli ingressi più recenti con ruolo, fonte e prime attività."
                  : "The most recent arrivals with role, source, and early activity."}
              </p>
              <div className="mt-6 grid gap-4">
                {adminDashboard.recentUsers.map((user) => (
                  <div
                    key={user.id}
                    className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{user.username}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {getRoleLabel(user.role, locale)}
                          {user.hometown ? ` · ${user.hometown}` : ""}
                        </p>
                      </div>
                      <HardNavigationLink
                        href={`/dashboard/admin/users/${user.id}`}
                        className="btn-secondary"
                      >
                        {locale === "it" ? "Apri" : "Open"}
                      </HardNavigationLink>
                    </div>
                    <div className="mt-4 grid gap-3 text-sm text-[var(--foreground)] sm:grid-cols-2">
                      <p>
                        {locale === "it" ? "Registrato" : "Joined"}:{" "}
                        {formatDashboardDate(locale, user.createdAt)}
                      </p>
                      <p>
                        {locale === "it" ? "Schede" : "Listings"}: {user.submissions}
                      </p>
                    </div>
                    {user.source ? (
                      <p className="mt-3 text-sm text-[var(--muted)]">
                        {locale === "it" ? "Fonte" : "Source"}:{" "}
                        {getHeardAboutLabel(user.source, locale)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <article className="card p-6">
              <h2 className="font-serif text-3xl text-[var(--foreground)]">
                {copy.adminRecentSubmissions}
              </h2>
              <div className="mt-6 grid gap-4">
                {adminDashboard.recentSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {submission.businessName}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {submission.townName} · {submission.username} ·{" "}
                          {getRoleLabel(submission.userRole, locale)}
                        </p>
                      </div>
                      <p className="text-sm text-[var(--primary)]">
                        {formatDashboardDate(locale, submission.createdAt)}
                      </p>
                    </div>
                    <div className="mt-4 grid gap-2 text-sm text-[var(--foreground)]">
                      <p>
                        {locale === "it" ? "Stato scheda" : "Listing status"}:{" "}
                        {getSubmissionStatusLabel(submission.status, locale)}
                      </p>
                      <p>
                        {locale === "it" ? "Stato pagamento" : "Payment status"}:{" "}
                        {getPaymentStatusLabel(submission.paymentStatus, locale)}
                      </p>
                      {submission.paymentStatus === "PAID" ? (
                        <HardNavigationLink
                          href={`/receipts/${encodeURIComponent(submission.id)}`}
                          className="mt-2 text-sm font-medium text-[var(--primary)]"
                        >
                          {locale === "it" ? "Apri ricevuta" : "Open receipt"}
                        </HardNavigationLink>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="card p-6">
              <h2 className="font-serif text-3xl text-[var(--foreground)]">
                {copy.adminClaims}
              </h2>
              <div className="mt-6 grid gap-4">
                {adminDashboard.recentClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded-[1.4rem] border border-[var(--border)] bg-[color:rgba(247,244,239,0.62)] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-[var(--foreground)]">
                          {claim.businessName}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">{claim.username}</p>
                      </div>
                      <p className="text-sm text-[var(--primary)]">{claim.status}</p>
                    </div>
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      {formatDashboardDate(locale, claim.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : viewer.role === "GETTER" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {partnerTopStats.map((stat) => (
              <article key={stat.label} className="card p-5">
                <p className="text-sm text-[var(--muted)]">{stat.label}</p>
                <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{stat.value}</p>
              </article>
            ))}
          </section>
          <section className="mx-auto mt-4 grid max-w-5xl gap-4 md:grid-cols-3">
            <article className="card p-5">
              <p className="text-sm text-[var(--muted)]">
                {locale === "it" ? "Guadagni totali" : "Total earnings"}
              </p>
              <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
                {formatCurrencyFromCents(partnerBalances?.totalEarned ?? 0, locale)}
              </p>
            </article>
            <PartnerOutstandingCommissionCard
              amountCents={partnerBalances?.available ?? 0}
              items={partnerOutstandingCommissions}
              locale={locale}
            />
            <article className="card p-5">
              <p className="text-sm text-[var(--muted)]">
                {locale === "it" ? "Pagato" : "Paid"}
              </p>
              <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">
                {formatCurrencyFromCents(partnerBalances?.paid ?? 0, locale)}
              </p>
            </article>
          </section>
        </>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {generalStats.map((stat) => (
            <article key={stat.label} className="card p-5">
              <p className="text-sm text-[var(--muted)]">{stat.label}</p>
              <p className="mt-3 font-serif text-3xl text-[var(--foreground)]">{stat.value}</p>
            </article>
          ))}
        </section>
      )}

      {viewer.role === "GETTER" && partnerBalances ? (
        <PartnerPayoutSummary
          balances={partnerBalances}
          history={partnerHistory}
          locale={locale}
          setup={partnerSetup}
        />
      ) : null}

      {viewer.role !== "ADMIN" ? (
        <section className="mt-10">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.recent}</h2>
            <HardNavigationLink
              href="/dashboard/businesses"
              className="text-sm font-medium text-[var(--primary)]"
            >
              {copy.viewAll}
            </HardNavigationLink>
          </div>
          {viewer.role === "GETTER" && !visibleRecentSubmissions.length ? (
            <div className="card border-[color:rgba(42,98,87,0.18)] bg-[color:rgba(42,98,87,0.05)] p-7">
              <h3 className="font-serif text-3xl text-[var(--foreground)]">{copy.partnerEmptyTitle}</h3>
              <p className="mt-3 max-w-xl text-[var(--muted)]">{copy.partnerEmptyBody}</p>
              <HardNavigationLink href="/publish" className="btn-primary mt-6">
                {copy.addPartnerBusiness}
              </HardNavigationLink>
            </div>
          ) : (
            <SubmissionList
              locale={locale}
              role={viewer.role}
              returnPath="/dashboard"
              submissions={visibleRecentSubmissions.map((submission) => ({
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
          )}
        </section>
      ) : null}
    </main>
  );
}
