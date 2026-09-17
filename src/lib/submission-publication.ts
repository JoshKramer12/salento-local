import type { Prisma, PrismaClient, UserRole } from "@prisma/client";

import {
  buildAddressSelectionStorage,
  buildGoogleMapsSearchUrl,
  buildSelectedAddressFromStoredFields,
} from "@/lib/address-selection";
import {
  normalizeFacebookUrl,
  normalizeInstagramUrl,
} from "@/lib/business-links";
import type { Locale } from "@/lib/i18n";
import { getSubmissionOwnerUserIdForPublication } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildBusinessDescription(shortDescription: string, longDescription: string) {
  const cleanedLines = longDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(notes collected on site|punti raccolti sul posto):$/i.test(line))
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);

  if (!cleanedLines.length) {
    return shortDescription;
  }

  return cleanedLines.join(". ");
}

function buildOpeningHoursSummary(value: string, locale: Locale) {
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Array<{
      close1?: string;
      close2?: string;
      closed?: boolean;
      day?: string;
      open1?: string;
      open2?: string;
      split?: boolean;
    }>;

    if (!Array.isArray(parsed)) {
      return value;
    }

    const dayLabels = {
      monday: "Mo",
      tuesday: "Tu",
      wednesday: "We",
      thursday: "Th",
      friday: "Fr",
      saturday: "Sa",
      sunday: "Su",
    };

    return parsed
      .map((day) => {
        const label = dayLabels[day.day as keyof typeof dayLabels] ?? day.day ?? "";

        if (day.closed) {
          return `${label} ${locale === "it" ? "chiuso" : "closed"}`;
        }

        const firstWindow = day.open1 && day.close1 ? `${day.open1}-${day.close1}` : null;
        const secondWindow =
          day.split && day.open2 && day.close2 ? `${day.open2}-${day.close2}` : null;
        const windows = [firstWindow, secondWindow].filter(Boolean).join(",");

        return windows ? `${label} ${windows}` : null;
      })
      .filter(Boolean)
      .join("; ");
  } catch {
    return value;
  }
}

async function buildUniqueBusinessSlug(
  db: Prisma.TransactionClient | PrismaClient,
  baseValue: string,
  existingBusinessId?: string | null,
) {
  const baseSlug = slugify(baseValue) || "business";
  let attempt = baseSlug;
  let counter = 2;

  while (true) {
    const existingBusiness = await db.business.findUnique({
      where: {
        slug: attempt,
      },
      select: {
        id: true,
      },
    });

    if (!existingBusiness || existingBusiness.id === existingBusinessId) {
      return attempt;
    }

    attempt = `${baseSlug}-${counter}`;
    counter += 1;
  }
}

function buildSubmissionSocialLinks(submission: {
  facebook?: string | null;
  instagram?: string | null;
}) {
  return Object.fromEntries(
    [
      ["facebook", normalizeFacebookUrl(submission.facebook ?? "")],
      ["instagram", normalizeInstagramUrl(submission.instagram ?? "")],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function buildSubmissionPhotoRows(submission: {
  businessName: string;
  photoUrls?: unknown;
}) {
  const photoUrls = Array.isArray(submission.photoUrls)
    ? submission.photoUrls.filter((url): url is string => typeof url === "string" && Boolean(url.trim()))
    : [];

  return photoUrls.map((url, index) => ({
    alt: `${submission.businessName} photo ${index + 1}`,
    sortOrder: index,
    url,
  }));
}

export async function publishSubmissionAfterPayment(params: {
  db?: Prisma.TransactionClient | PrismaClient;
  locale?: Locale;
  submissionId: string;
}) {
  const db = params.db ?? prisma;
  const locale = params.locale ?? "it";

  const submission = await db.businessSubmission.findUnique({
    where: {
      id: params.submissionId,
    },
    select: {
      address: true,
      addressCountry: true,
      addressCountryCode: true,
      addressLatitude: true,
      addressLocality: true,
      addressLongitude: true,
      addressPlaceId: true,
      addressPostalCode: true,
      addressProvince: true,
      addressRegion: true,
      addressRoute: true,
      addressStreetNumber: true,
      businessName: true,
      categoryId: true,
      createdBusinessId: true,
      email: true,
      facebook: true,
      googleMapsUrl: true,
      id: true,
      instagram: true,
      longDescription: true,
      openingHours: true,
      phone: true,
      photoUrls: true,
      shortDescription: true,
      town: {
        select: {
          id: true,
          latitude: true,
          longitude: true,
          name: true,
          slug: true,
        },
      },
      user: {
        select: {
          id: true,
          role: true,
        },
      },
      website: true,
    },
  });

  if (!submission) {
    return null;
  }

  const socialLinks = buildSubmissionSocialLinks(submission);
  const businessSlug = await buildUniqueBusinessSlug(
    db,
    `${submission.businessName}-${submission.town.slug}`,
    submission.createdBusinessId,
  );
  const publicEmail = (submission.email ?? "").trim();
  const photoRows = buildSubmissionPhotoRows(submission);
  const ownerUserId = getSubmissionOwnerUserIdForPublication(submission.user as {
    id: string;
    role: UserRole;
  });
  const selectedAddress = buildSelectedAddressFromStoredFields({
    address: submission.address,
    addressCountry: submission.addressCountry,
    addressCountryCode: submission.addressCountryCode,
    addressLatitude: submission.addressLatitude,
    addressLocality: submission.addressLocality,
    addressLongitude: submission.addressLongitude,
    addressPlaceId: submission.addressPlaceId,
    addressPostalCode: submission.addressPostalCode,
    addressProvince: submission.addressProvince,
    addressRegion: submission.addressRegion,
    addressRoute: submission.addressRoute,
    addressStreetNumber: submission.addressStreetNumber,
  });
  const selectedAddressStorage = selectedAddress
    ? buildAddressSelectionStorage(selectedAddress)
    : null;
  const mapsUrl =
    selectedAddress
      ? buildGoogleMapsSearchUrl(selectedAddress)
      : submission.googleMapsUrl?.trim() || "";
  const businessData = {
    address: submission.address,
    addressCountry: selectedAddressStorage?.addressCountry,
    addressCountryCode: selectedAddressStorage?.addressCountryCode,
    addressLocality: selectedAddressStorage?.addressLocality,
    addressPlaceId: selectedAddressStorage?.addressPlaceId,
    addressPostalCode: selectedAddressStorage?.addressPostalCode,
    addressProvince: selectedAddressStorage?.addressProvince,
    addressRegion: selectedAddressStorage?.addressRegion,
    addressRoute: selectedAddressStorage?.addressRoute,
    addressStreetNumber: selectedAddressStorage?.addressStreetNumber,
    categoryId: submission.categoryId,
    description: buildBusinessDescription(
      submission.shortDescription,
      submission.longDescription,
    ),
    email: publicEmail || null,
    heroImageSeed: `${businessSlug}-manual`,
    latitude: selectedAddressStorage?.addressLatitude ?? submission.town.latitude,
    longitude: selectedAddressStorage?.addressLongitude ?? submission.town.longitude,
    mapsUrl,
    name: submission.businessName,
    openingHoursText: buildOpeningHoursSummary(submission.openingHours, locale),
    ownerUserId,
    phone: submission.phone?.trim() || null,
    shortDescription: submission.shortDescription,
    slug: businessSlug,
    socialLinks: Object.keys(socialLinks).length ? socialLinks : undefined,
    townId: submission.town.id,
    verificationStatus: "OWNER_VERIFIED" as const,
    website: submission.website?.trim() || null,
  };

  const business = submission.createdBusinessId
    ? await db.business.update({
        where: {
          id: submission.createdBusinessId,
        },
        data: {
          ...businessData,
          images: {
            create: photoRows,
            deleteMany: {},
          },
        },
        select: {
          id: true,
          slug: true,
          town: {
            select: {
              slug: true,
            },
          },
        },
      })
    : await db.business.create({
        data: {
          ...businessData,
          images: photoRows.length
            ? {
                create: photoRows,
              }
            : undefined,
        },
        select: {
          id: true,
          slug: true,
          town: {
            select: {
              slug: true,
            },
          },
        },
      });

  await db.businessSubmission.update({
    where: {
      id: submission.id,
    },
    data: {
      createdBusinessId: business.id,
      status: "PUBLISHED",
    },
  });

  await db.payment.updateMany({
    where: {
      businessSubmissionId: submission.id,
      // Publication may be retried after the finalizer has already linked a
      // payment. Preserve an existing association rather than reassociating
      // it silently.
      businessId: null,
    },
    data: {
      businessId: business.id,
    },
  });

  return business;
}
