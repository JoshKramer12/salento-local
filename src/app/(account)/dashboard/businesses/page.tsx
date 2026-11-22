import { redirect } from "next/navigation";

import {
  BusinessOwnerAccountNav,
  BusinessOwnerWorkspaceNav,
} from "@/components/account/business-owner-account-nav";
import { DashboardNav, DraftCountBadge } from "@/components/account/dashboard-nav";
import { OwnedBusinessList } from "@/components/account/owned-business-list";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { PartnerSubmissions } from "@/components/account/partner-submissions";
import { SubmissionList } from "@/components/account/submission-list";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import { getPartnerNextRoute } from "@/lib/partner-onboarding";
import { payableCommissionWhere } from "@/lib/partner-ledger";
import { prisma } from "@/lib/prisma";
import { isPayLaterEnabled } from "@/lib/pay-later-invitations";
import { getSingleParam } from "@/lib/site";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

type DashboardBusinessesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const payLaterInvitationSelect = {
  id: true, recipientEmail: true, ownerPhone: true, tokenGeneration: true,
  emailAcceptedGeneration: true, emailAcceptedAt: true, emailAttemptedAt: true,
  emailFailureMessage: true, verifiedAt: true, completedAt: true,
  declinedAt: true, revokedAt: true, remindersStoppedAt: true,
  tokenExpiresAt: true, whatsappPreparedAt: true,
  reminders: { orderBy: { sequence: "desc" }, take: 1,
    select: { acceptedAt: true } },
} as const;

export default async function DashboardBusinessesPage({
  searchParams,
}: DashboardBusinessesPageProps) {
  const [locale, viewer] = await Promise.all([getCurrentLocale(), requireCompletedViewer()]);

  if (viewer.role === "GETTER") {
    const profile = await prisma.localPartnerProfile.findUnique({
      where: { userId: viewer.id },
      select: { completedAt: true, partnerOnboardingCompletedAt: true },
    });
    const nextRoute = getPartnerNextRoute(profile);

    if (nextRoute !== "/dashboard") redirect(nextRoute);
  }

  const resolvedSearchParams = await searchParams;
  const showAll = viewer.role === "ADMIN" && getSingleParam(resolvedSearchParams.scope) === "all";
  const warning = getSingleParam(resolvedSearchParams.warning);
  const now = new Date();

  const [ownedBusinesses, submissions, ownDraftCount, persistedDrafts, payableCommissions] = await Promise.all([
    prisma.business.findMany({
      where: showAll
        ? undefined
        : {
            OR: [
              { ownerUserId: viewer.id },
              { ownerAccesses: { some: { userId: viewer.id } } },
            ],
          },
      include: {
        category: {
          select: {
            name: true,
          },
        },
        town: {
          select: {
            name: true,
          },
        },
        ownerUser: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    prisma.businessSubmission.findMany({
      where: showAll
        ? undefined
        : {
            userId: viewer.id,
          },
      include: {
        payLaterInvitation: { select: payLaterInvitationSelect },
        category: {
          select: {
            name: true,
          },
        },
        createdBusiness: {
          select: {
            membership: { select: { entitlementRevokedAt: true, graceEndsAt: true } },
            images: {
              orderBy: {
                sortOrder: "asc",
              },
              select: {
                alt: true,
                url: true,
              },
            },
            slug: true,
          },
        },
        payments: {
          orderBy: {
            createdAt: "desc",
          },
          select: {
            bankTransferReference: true,
          },
          take: 1,
        },
        town: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            username: true,
          },
        },
        partnerCommissions: {
          where: { partnerUserId: viewer.id },
          select: {
            id: true,
            amountCents: true,
            eligibleAt: true,
            payment: { select: { purpose: true, status: true, refundRequestedAt: true, refundStatus: true, stripeLivemode: true } },
            sourceKey: true,
            status: true,
            type: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
    prisma.businessSubmission.findMany({
      where: buildDraftLikeSubmissionWhere(viewer.id),
      include: {
        payLaterInvitation: { select: payLaterInvitationSelect },
        category: {
          select: {
            name: true,
          },
        },
        createdBusiness: {
          select: {
            membership: { select: { entitlementRevokedAt: true, graceEndsAt: true } },
            images: {
              orderBy: {
                sortOrder: "asc",
              },
              select: {
                alt: true,
                url: true,
              },
            },
            slug: true,
          },
        },
        payments: {
          orderBy: {
            createdAt: "desc",
          },
          select: {
            bankTransferReference: true,
          },
          take: 1,
        },
        town: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            username: true,
          },
        },
        partnerCommissions: {
          where: { partnerUserId: viewer.id },
          select: {
            id: true,
            amountCents: true,
            eligibleAt: true,
            payment: { select: { purpose: true, status: true, refundRequestedAt: true, refundStatus: true, stripeLivemode: true } },
            sourceKey: true,
            status: true,
            type: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    viewer.role === "GETTER" && !showAll
      ? prisma.partnerCommission.findMany({
          where: { ...payableCommissionWhere(now), partnerUserId: viewer.id },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const personalView = !showAll;
  const draftSubmissions = personalView
    ? persistedDrafts
    : [];
  const draftSubmissionIds = new Set(draftSubmissions.map((submission) => submission.id));
  const activeSubmissions = personalView
    ? submissions.filter((submission) => !draftSubmissionIds.has(submission.id))
    : submissions;

  if (viewer.role === "GETTER" && !showAll) {
    return (
      <>
        <PartnerWorkspaceNav active="businesses" locale={locale} />
        <div className="dashboard-nav-shell shell px-4 pt-5 sm:px-6">
          <DashboardNav
            active="businesses"
            draftCount={draftSubmissions.length}
            locale={locale}
            role="GETTER"
          />
        </div>
        <PartnerSubmissions
          payLaterEnabled={isPayLaterEnabled()}
          now={now.toISOString()}
          locale={locale}
          drafts={draftSubmissions}
          submissions={activeSubmissions}
          payableCommissionIds={payableCommissions.map((commission) => commission.id)}
        />
      </>
    );
  }

  return (
    <>
      {viewer.role === "GETTER" ? (
        <PartnerWorkspaceNav active="businesses" locale={locale} />
      ) : null}
      {viewer.role === "BUSINESS_OWNER" ? (
        <BusinessOwnerWorkspaceNav active="drafts" locale={locale} />
      ) : null}
      <main className="shell px-4 py-12 sm:px-6">
      {viewer.role === "BUSINESS_OWNER" ? (
        <BusinessOwnerAccountNav active="drafts" draftCount={draftSubmissions.length} locale={locale} />
      ) : (
        <div className="dashboard-nav-shell mb-8">
          <DashboardNav
            active={showAll ? "adminBusinesses" : "businesses"}
            draftCount={showAll ? ownDraftCount : draftSubmissions.length}
            isAdmin={viewer.role === "ADMIN"}
            locale={locale}
            role={viewer.role}
          />
        </div>
      )}

      <div className="mb-8">
        <p className="section-kicker mb-2">
          {locale === "it" ? "Attivita inviate" : "Submitted businesses"}
        </p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">
          {showAll
            ? locale === "it"
              ? "Tutte le segnalazioni"
              : "All submissions"
            : viewer.role === "GETTER"
              ? locale === "it"
                ? "Le mie segnalazioni"
                : "My submissions"
            : locale === "it"
              ? "Le mie attivita"
              : "My businesses"}
        </h1>
      </div>

      {showAll ? (
        <div className="mb-8 rounded-2xl border border-[color:rgba(42,98,87,0.14)] bg-[color:rgba(42,98,87,0.06)] px-4 py-3 text-sm text-[var(--foreground)]">
          {locale === "it"
            ? "Vista admin: qui vedi tutte le attivita inviate da tutti gli utenti."
            : "Admin view: here you can see all submitted businesses from all users."}
        </div>
      ) : null}

      {showAll && warning === "payment-required" ? (
        <div className="mb-8 rounded-2xl border border-[color:rgba(191,91,42,0.18)] bg-[color:rgba(191,91,42,0.08)] px-4 py-3 text-sm text-[var(--foreground)]">
          {locale === "it"
            ? "Non puoi pubblicare una scheda finche il pagamento non e confermato."
            : "You cannot publish a listing until payment has been confirmed."}
        </div>
      ) : null}

      {personalView && viewer.role !== "GETTER" && (draftSubmissions.length > 0 || viewer.role === "BUSINESS_OWNER") ? (
        <section id="drafts" className="mb-10 scroll-mt-6">
          <div className="mb-5">
            <h2 className="flex items-center gap-2 font-serif text-3xl text-[var(--foreground)]">
              {locale === "it" ? "Bozze" : "Drafts"}
              <DraftCountBadge count={draftSubmissions.length} />
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {locale === "it"
                ? "Le bozze salvate compaiono qui per prime, cosi puoi riprendere subito il lavoro."
                : "Saved drafts appear here first so you can jump back in quickly."}
            </p>
          </div>
          <SubmissionList
            emptyMessage={locale === "it" ? "Al momento non hai bozze." : "You currently have no drafts."}
            locale={locale}
            role={viewer.role}
            returnPath="/dashboard/businesses"
            submissions={draftSubmissions.map((submission) => ({
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
      ) : null}

      {!showAll && viewer.role !== "GETTER" ? (
        <section className="mb-10">
          <div className="mb-5">
            <h2 className="font-serif text-3xl text-[var(--foreground)]">
              {showAll
                ? locale === "it"
                  ? "Attivita con proprietario collegato"
                  : "Businesses with an owner"
                : locale === "it"
                  ? "Attivita registrate a te"
                  : "Businesses registered to you"}
            </h2>
          </div>
          <OwnedBusinessList
            businesses={ownedBusinesses.map((business) => ({
              address: business.address,
              categoryName: business.category.name,
              name: business.name,
              shortDescription: business.shortDescription,
              slug: business.slug,
              townName: showAll && business.ownerUser
                ? `${business.town.name} · ${business.ownerUser.username}`
                : business.town.name,
              updatedAt: business.updatedAt,
            }))}
            locale={locale}
          />
        </section>
      ) : null}

      <section>
        <div className="mb-5">
          <h2 className="font-serif text-3xl text-[var(--foreground)]">
            {showAll
              ? locale === "it"
                ? "Segnalazioni inviate"
                : "Submitted listings"
              : viewer.role === "GETTER"
                ? locale === "it"
                  ? "Segnalazioni inviate"
                  : "Submitted listings"
              : locale === "it"
                ? "Le tue segnalazioni"
                : "Your submissions"}
          </h2>
        </div>
        <SubmissionList
          isAdmin={showAll}
          locale={locale}
          role={viewer.role}
          returnPath={showAll ? "/dashboard/businesses?scope=all" : "/dashboard/businesses"}
          showOwner={showAll}
          submissions={activeSubmissions.map((submission) => ({
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
            userName: submission.user.username,
          }))}
          />
      </section>
      </main>
    </>
  );
}
