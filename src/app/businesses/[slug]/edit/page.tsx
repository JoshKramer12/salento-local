import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { OwnedBusinessEditForm } from "@/components/account/owned-business-edit-form";
import { PublishForm, type OwnerEditStep } from "@/components/account/publish-form";
import { requireCompletedViewer } from "@/lib/auth-guards";
import { canManageBusiness } from "@/lib/business-owner-access";
import { getStoredPhotoUrls, mergeBusinessPhotoUrls } from "@/lib/business-photos";
import { getCurrentLocale } from "@/lib/locale";
import { buildPhoneCountryOptions } from "@/lib/phone-country-options";
import { prisma } from "@/lib/prisma";
import { getSingleParam } from "@/lib/site";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type EditBusinessPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const editSteps = new Set(["business", "contact", "owner", "about", "hours", "photos"]);

function getSocialLink(value: unknown, key: "facebook" | "instagram" | "whatsapp") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function buildHoursDraft(hours: Array<{
  closed: boolean;
  dayOfWeek: number;
  endTime: string | null;
  startTime: string | null;
}>) {
  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  return JSON.stringify(
    dayKeys.map((day, dayOfWeek) => {
      const stored = hours.find((entry) => entry.dayOfWeek === dayOfWeek);

      return {
        close1: stored?.endTime ?? "",
        close2: "",
        closed: stored?.closed ?? false,
        day,
        open1: stored?.startTime ?? "",
        open2: "",
        split: false,
      };
    }),
  );
}

export default async function EditBusinessPage({ params, searchParams }: EditBusinessPageProps) {
  const locale = await getCurrentLocale();
  const viewer = await requireCompletedViewer();
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      hours: {
        orderBy: { dayOfWeek: "asc" },
        select: { closed: true, dayOfWeek: true, endTime: true, startTime: true },
      },
      images: {
        orderBy: { sortOrder: "asc" },
        select: { url: true },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      ownerAccesses: {
        where: { userId: viewer.id },
        select: { email: true },
        take: 1,
      },
    },
  });

  if (!business) {
    redirect("/dashboard/businesses");
  }

  if (
    viewer.role !== "ADMIN" &&
    !(await canManageBusiness({ businessId: business.id, userId: viewer.id }))
  ) {
    redirect(`/businesses/${slug}`);
  }

  const latestSubmission = business.submissions[0];
  const activeOwnerEmail = business.ownerAccesses[0]?.email ?? latestSubmission?.ownerEmail ?? "";

  // Preserve the existing admin-facing edit screen. The shared wizard below is
  // intentionally the Business Owner account experience only.
  if (viewer.role !== "BUSINESS_OWNER") {
    return (
      <main className="shell px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <p className="section-kicker mb-2">
              {locale === "it" ? "Gestione attività" : "Business management"}
            </p>
            <h1 className="font-serif text-4xl text-[var(--foreground)]">
              {locale === "it" ? "Modifica profilo attività" : "Edit business profile"}
            </h1>
          </div>

          <section className="card p-8">
            <OwnedBusinessEditForm
              business={{
                address: business.address,
                description: business.description,
                email: business.email ?? "",
                id: business.id,
                name: business.name,
                openingHoursText: business.openingHoursText ?? "",
                ownerEmail: latestSubmission?.ownerEmail ?? "",
                ownerName: latestSubmission?.ownerName ?? "",
                ownerPhone: latestSubmission?.ownerPhone ?? "",
                phone: business.phone ?? "",
                shortDescription: business.shortDescription,
                website: business.website ?? "",
              }}
              locale={locale}
            />
          </section>
        </div>
      </main>
    );
  }

  const [categories, towns] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
    prisma.town.findMany({
      select: {
        id: true,
        latitude: true,
        longitude: true,
        name: true,
        province: true,
        region: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const requestedStep = getSingleParam(resolvedSearchParams.step);
  const initialStep =
    requestedStep && editSteps.has(requestedStep)
      ? (requestedStep as OwnerEditStep)
      : undefined;
  const imageUrls = mergeBusinessPhotoUrls(
    business.images.map((image) => image.url),
    getStoredPhotoUrls(latestSubmission?.photoUrls),
  );
  const facebook = getSocialLink(business.socialLinks, "facebook") || latestSubmission?.facebook || "";
  const instagram = getSocialLink(business.socialLinks, "instagram") || latestSubmission?.instagram || "";

  return (
    <main className="publish-page shell px-4 py-8 sm:px-6 sm:py-12">
      <PublishForm
        categories={categories}
        editMode={{
          businessId: business.id,
          businessSlug: business.slug,
          initialStep,
          preservedPhotoUrls: imageUrls.slice(5),
        }}
        googlePlacesApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? ""}
        locale={locale}
        phoneCountryOptions={buildPhoneCountryOptions(locale)}
        role="BUSINESS_OWNER"
        submission={{
          address: business.address,
          addressCountry: business.addressCountry ?? "",
          addressCountryCode: business.addressCountryCode ?? "",
          addressLatitude: String(business.latitude),
          addressLocality: business.addressLocality ?? "",
          addressLongitude: String(business.longitude),
          addressPlaceId: business.addressPlaceId ?? "",
          addressPostalCode: business.addressPostalCode ?? "",
          addressProvince: business.addressProvince ?? "",
          addressRegion: business.addressRegion ?? "",
          addressRoute: business.addressRoute ?? "",
          addressStreetNumber: business.addressStreetNumber ?? "",
          agreementSignature: latestSubmission?.agreementSignature ?? "",
          businessName: business.name,
          categoryId: business.categoryId,
          email: business.email ?? "",
          facebook,
          googleMapsUrl: business.mapsUrl ?? latestSubmission?.googleMapsUrl ?? "",
          id: latestSubmission?.id,
          instagram,
          longDescription: latestSubmission?.longDescription || business.description,
          openingHours: latestSubmission?.openingHours || buildHoursDraft(business.hours),
          ownerEmail: activeOwnerEmail,
          ownerHasNoEmail: latestSubmission?.ownerHasNoEmail ?? false,
          ownerName: latestSubmission?.ownerName ?? "",
          ownerPhone: latestSubmission?.ownerPhone ?? "",
          paymentMethod: latestSubmission?.paymentMethod,
          phone: business.phone ?? "",
          photoUrls: imageUrls.slice(0, 5).join("\n"),
          shortDescription: business.shortDescription,
          signerFullName: latestSubmission?.signerFullName ?? "",
          signerRole: latestSubmission?.signerRole ?? "",
          signerRoleOther: latestSubmission?.signerRoleOther ?? "",
          townId: business.townId,
          website: business.website ?? "",
          whatsapp: getSocialLink(business.socialLinks, "whatsapp"),
        }}
        towns={towns}
      />
    </main>
  );
}
