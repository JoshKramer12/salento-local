import type { Viewport } from "next";
import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/account/dashboard-nav";
import { PartnerWorkspaceNav } from "@/components/account/partner-workspace-nav";
import { PayoutSetupSkipCleanup } from "@/components/account/payout-setup-skip-cleanup";
import { PublishForm } from "@/components/account/publish-form";
import { isAdminViewer } from "@/lib/admin";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { getCurrentLocale } from "@/lib/locale";
import {
  getPartnerNextRoute,
  getPartnerPayoutSetupSkipDestination,
} from "@/lib/partner-onboarding";
import { getPartnerPayoutSetupSummary } from "@/lib/partner-connect";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { getPublishOwnerContactDefaults } from "@/lib/publish-owner-contact";
import { prisma } from "@/lib/prisma";
import { isPayLaterEnabled } from "@/lib/pay-later-invitations";
import { isPublicFinancialHold } from "@/lib/stripe";
import { getSingleParam } from "@/lib/site";
import { buildDraftLikeSubmissionWhere } from "@/lib/submission-drafts";

type PublishPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default async function PublishPage({ searchParams }: PublishPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const resolvedSearchParams = await searchParams;
  const adminMode = getSingleParam(resolvedSearchParams.mode) === "admin";
  const submissionId = getSingleParam(resolvedSearchParams.submission);
  const skipPayoutSetup = getSingleParam(resolvedSearchParams.skipPayoutSetup) === "1";

  if (adminMode && !isAdminViewer(viewer)) {
    redirect("/publish");
  }

  if (viewer.role === "GETTER") {
    const profile = await prisma.localPartnerProfile.findUnique({
      where: { userId: viewer.id },
      select: { completedAt: true, partnerOnboardingCompletedAt: true },
    });
    const nextRoute = getPartnerNextRoute(profile);

    if (nextRoute !== "/dashboard") {
      redirect(nextRoute);
    }

    if (!skipPayoutSetup) {
      const payoutSetup = await getPartnerPayoutSetupSummary(viewer.id);

      if (payoutSetup?.setupState !== "ready") {
        const publishParams = new URLSearchParams();

        if (submissionId) publishParams.set("submission", submissionId);
        const publishHref = `/publish${publishParams.size ? `?${publishParams.toString()}` : ""}`;
        const returnTo = getPartnerPayoutSetupSkipDestination(publishHref);

        redirect(`/partner/payout?returnTo=${encodeURIComponent(returnTo)}`);
      }
    }

  }

  const [
    towns,
    categories,
    submission,
    draftCount,
    successfulSubmissionCount,
    ownerContactDefaults,
  ] = await Promise.all([
    prisma.town.findMany({
      select: {
        id: true,
        latitude: true,
        longitude: true,
        name: true,
        province: true,
        region: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
      },
      orderBy: {
        name: "asc",
      },
    }),
    submissionId
      ? prisma.businessSubmission.findUnique({
          where: {
            id: submissionId,
          },
        })
      : Promise.resolve(null),
    prisma.businessSubmission.count({
      where: buildDraftLikeSubmissionWhere(viewer.id),
    }),
    prisma.businessSubmission.count({
      where: {
        userId: viewer.id,
        status: "PUBLISHED",
      },
    }),
    viewer.role === "BUSINESS_OWNER" && !adminMode
      ? getPublishOwnerContactDefaults(viewer.id)
      : Promise.resolve(undefined),
  ]);

  if (submission && submission.userId !== viewer.id) {
    redirect("/dashboard");
  }

  return (
    <>
    {viewer.role === "GETTER" ? <PartnerWorkspaceNav active="publish" locale={locale} /> : null}
    <main className="publish-page shell px-4 py-12 sm:px-6">
      {skipPayoutSetup ? <PayoutSetupSkipCleanup /> : null}
      <div className="dashboard-nav-shell publish-page-nav mb-8">
        <DashboardNav
          active="publish"
          draftCount={draftCount}
          isAdmin={viewer.role === "ADMIN"}
          locale={locale}
          role={viewer.role}
        />
      </div>

      <PublishForm
        adminMode={adminMode}
        payLaterEnabled={(viewer.role === "GETTER" || viewer.role === "BUSINESS_OWNER") && !adminMode && isPayLaterEnabled()}
        financialPaymentPaused={isPublicFinancialHold()}
        ownerContactDefaults={ownerContactDefaults}
        viewerId={viewer.id}
        submissionUpdatedAt={submission?.updatedAt.toISOString()}
        categories={categories}
        googlePlacesApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? ""}
        locale={locale}
        phoneCountryOptions={buildPhoneCountryOptions(locale)}
        previousSuccessfulSubmissionCount={successfulSubmissionCount}
        role={viewer.role}
        submission={{
          address: submission?.address ?? "",
          addressCountry: submission?.addressCountry ?? "",
          addressCountryCode: submission?.addressCountryCode ?? "",
          addressLatitude:
            typeof submission?.addressLatitude === "number"
              ? String(submission.addressLatitude)
              : "",
          addressLocality: submission?.addressLocality ?? "",
          addressLongitude:
            typeof submission?.addressLongitude === "number"
              ? String(submission.addressLongitude)
              : "",
          addressPlaceId: submission?.addressPlaceId ?? "",
          addressPostalCode: submission?.addressPostalCode ?? "",
          addressProvince: submission?.addressProvince ?? "",
          addressRegion: submission?.addressRegion ?? "",
          addressRoute: submission?.addressRoute ?? "",
          addressStreetNumber: submission?.addressStreetNumber ?? "",
          businessName: submission?.businessName ?? "",
          categoryId: submission?.categoryId ?? "",
          email: submission?.email ?? "",
          facebook: submission?.facebook ?? "",
          googleMapsUrl: submission?.googleMapsUrl ?? "",
          id: submission?.id,
          instagram: submission?.instagram ?? "",
          longDescription: submission?.longDescription ?? "",
          openingHours: submission?.openingHours ?? "",
          ownerEmail: submission?.ownerEmail ?? "",
          ownerHasNoEmail: submission?.ownerHasNoEmail ?? false,
          ownerName: submission?.ownerName ?? "",
          ownerPhone: submission?.ownerPhone ?? "",
          signerFullName: submission?.signerFullName ?? "",
          signerRole: submission?.signerRole ?? "",
          signerRoleOther: submission?.signerRoleOther ?? "",
          paymentMethod: submission?.paymentMethod,
          phone: submission?.phone ?? "",
          photoUrls: Array.isArray(submission?.photoUrls)
            ? submission.photoUrls.join("\n")
            : "",
          shortDescription: submission?.shortDescription ?? "",
          townId: submission?.townId ?? "",
          agreementSignature: submission?.agreementSignature ?? "",
          website: submission?.website ?? "",
          whatsapp: submission?.whatsapp ?? "",
        }}
        towns={towns}
      />
    </main>
    </>
  );
}
