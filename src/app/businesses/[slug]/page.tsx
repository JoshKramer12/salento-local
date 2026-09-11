import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BusinessContactCard } from "@/components/business/business-contact-card";
import { BusinessHero } from "@/components/business/business-hero";
import { BusinessOpeningHours } from "@/components/business/business-opening-hours";
import { BusinessReviews } from "@/components/business/business-reviews";
import { ReviewComposer } from "@/components/review-composer";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
} from "@/lib/address-selection";
import {
  getSocialDisplayLabel,
  getWebsiteDisplayLabel,
  normalizeFacebookUrl,
  normalizeInstagramUrl,
  normalizeUrlInput,
} from "@/lib/business-links";
import { getBusinessPhotoUrls } from "@/lib/business-photos";
import { getBusinessHoursStatus, getBusinessHoursStatusDetail, resolveBusinessHours } from "@/lib/business-hours";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getSafeInternalRedirect } from "@/lib/redirects";
import {
  buildBusinessImage,
  buildBusinessPhoto,
  buildTownImage,
  getCategoryLabel,
} from "@/lib/site";

type BusinessPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getDuplicateReviewReturnPath(value: string | string[] | undefined) {
  const returnTo = getSafeInternalRedirect(typeof value === "string" ? value : null);

  if (!returnTo) {
    return null;
  }

  const destination = new URL(returnTo, "https://salentolocal.invalid");

  return destination.pathname === "/publish" &&
    destination.searchParams.get("showPossibleMatches") === "1" &&
    destination.searchParams.get("submission")
    ? returnTo
    : null;
}

function isGenericBusinessCopy(value?: string | null) {
  if (!value) {
    return true;
  }

  return /imported from openstreetmap|structured listing sourced|located in /i.test(value);
}

function cleanSentence(value?: string | null) {
  return value
    ?.replace(/\s+/g, " ")
    .replace(/^[.:;\-]+/, "")
    .trim();
}

function extractMeaningfulPhrases(...values: Array<string | null | undefined>) {
  const phrases: string[] = [];

  for (const value of values) {
    if (!value || isGenericBusinessCopy(value)) {
      continue;
    }

    for (const rawPart of value.split(/\r?\n|•|;/)) {
      const phrase = cleanSentence(rawPart);

      if (!phrase) {
        continue;
      }

      if (/^notes collected on site:?$/i.test(phrase) || /^punti raccolti sul posto:?$/i.test(phrase)) {
        continue;
      }

      const cleaned = phrase.replace(/^[-*]\s*/, "");

      if (cleaned.length > 4) {
        phrases.push(cleaned);
      }
    }
  }

  return phrases;
}

function extractOfferingPhrases(...values: Array<string | null | undefined>) {
  const phrases: string[] = [];

  for (const value of values) {
    if (!value || isGenericBusinessCopy(value)) {
      continue;
    }

    for (const rawPart of value.split(/\r?\n|•|;|(?<=[.!?])\s+/)) {
      const phrase = cleanSentence(rawPart)?.replace(/^[-*]\s*/, "");

      if (!phrase) {
        continue;
      }

      if (/^notes collected on site:?$/i.test(phrase) || /^punti raccolti sul posto:?$/i.test(phrase)) {
        continue;
      }

      if (phrase.length > 2) {
        phrases.push(phrase);
      }
    }
  }

  return phrases;
}

function buildBusinessIntro(
  business: {
    category: { name: string; slug: string };
    description: string;
    shortDescription: string;
  },
  _locale: "en" | "it",
) {
  const shortDescription = cleanSentence(business.shortDescription);

  if (shortDescription && !isGenericBusinessCopy(shortDescription)) {
    return shortDescription;
  }

  const firstMeaningfulLine = extractMeaningfulPhrases(business.description)[0];

  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }

  return "";
}

function buildOfferingItems(
  business: {
    description: string;
    shortDescription: string;
  },
  _locale?: "en" | "it",
) {
  const collected = new Map<string, string>();

  for (const phrase of extractOfferingPhrases(
    business.shortDescription,
    business.description,
  )) {
    if (phrase.length > 42) {
      continue;
    }

    collected.set(phrase.toLowerCase(), phrase);
  }

  const items = Array.from(collected.values()).slice(0, 8);

  if (items.length) {
    return items;
  }

  return [];
}

function buildGalleryImages(
  business: {
    category: { slug: string };
    heroImageSeed: string;
    images: Array<{ alt: string; id: string; url: string }>;
    locality: { heroImageSeed: string; imageUrl: string | null; name: string } | null;
    name: string;
    town: { heroImageSeed: string; imageUrl: string | null; name: string; slug: string };
  },
  submissionPhotoUrls: unknown,
) {
  const fallbackImage = buildBusinessImage(business, business.category.slug, 1800);
  const seen = new Set<string>();
  const gallery = getBusinessPhotoUrls(business.images, submissionPhotoUrls)
    .map((url, index) => {
      const image = business.images.find((entry) => entry.url === url);

      return {
        alt: image?.alt || `${business.name} photo ${index + 1}`,
        id: image?.id || `submission-photo-${index}`,
        src:
          buildBusinessPhoto(url, index === 0 ? 1800 : 800, {
            label: business.name,
            seed: business.heroImageSeed,
            type: business.category.slug === "beaches" ? "beach" : "business",
          }) ?? fallbackImage,
      };
    })
    .filter((image) => {
      if (seen.has(image.src)) {
        return false;
      }

      seen.add(image.src);
      return true;
    });

  if (!gallery.length) {
    return [
      {
        alt: business.name,
        id: "fallback-image",
        src: fallbackImage,
      },
    ];
  }

  return gallery;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      name: true,
      shortDescription: true,
    },
  });

  if (!business) {
    return {
      title: "Luogo non trovato | Salento Local",
    };
  }

  return {
    title: `${business.name} | Salento Local`,
    description: business.shortDescription,
  };
}

export default async function BusinessPage({ params, searchParams }: BusinessPageProps) {
  const locale = await getCurrentLocale();
  const { slug } = await params;
  const returnTo = getDuplicateReviewReturnPath((await searchParams).returnTo);
  const copy =
    locale === "it"
      ? {
          openNow: "Aperto ora",
          closedNow: "Chiuso ora",
          closesAt: "Chiude alle",
          opensAt: "Apre alle",
          opensTomorrow: "Apre domani alle",
          about: "Informazioni",
          townExplore: "Esplora questo comune",
          backToBusinessForm: "Torna al modulo attività",
        }
      : {
          openNow: "Open now",
          closedNow: "Closed now",
          closesAt: "Closes at",
          opensAt: "Opens at",
          opensTomorrow: "Opens tomorrow at",
          about: "About",
          townExplore: "Explore this town",
          backToBusinessForm: "Back to business form",
        };

  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      category: true,
      hours: {
        orderBy: {
          dayOfWeek: "asc",
        },
      },
      images: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { photoUrls: true },
      },
      locality: true,
      reviews: {
        orderBy: {
          createdAt: "desc",
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      town: true,
    },
  });

  if (!business) {
    notFound();
  }

  const businessWebsite = normalizeUrlInput(business.website);
  const businessWebsiteLabel = getWebsiteDisplayLabel(business.website);
  const socialLinks = (() => {
    if (!business.socialLinks || typeof business.socialLinks !== "object" || Array.isArray(business.socialLinks)) {
      return [];
    }

    const record = business.socialLinks as Record<string, unknown>;
    const links = [
      {
        href:
          typeof record.instagram === "string" ? normalizeInstagramUrl(record.instagram) : undefined,
        label:
          typeof record.instagram === "string"
            ? getSocialDisplayLabel(record.instagram, "instagram")
            : null,
        network: "instagram" as const,
      },
      {
        href:
          typeof record.facebook === "string" ? normalizeFacebookUrl(record.facebook) : undefined,
        label:
          typeof record.facebook === "string"
            ? getSocialDisplayLabel(record.facebook, "facebook")
            : null,
        network: "facebook" as const,
      },
    ];

    return links.filter(
      (link): link is { href: string; label: string; network: "facebook" | "instagram" } =>
        Boolean(link.href && link.label),
    );
  })();
  const directionsUrl =
    buildGoogleMapsDirectionsUrl({
      latitude: business.latitude,
      longitude: business.longitude,
      placeId: business.addressPlaceId ?? "",
    }) ??
    business.mapsUrl ??
    buildGoogleMapsSearchUrl({
      formattedAddress: business.address,
      placeId: business.addressPlaceId ?? "",
    });
  const categoryLabel = getCategoryLabel(business.category.slug, business.category.name, locale);
  const localityLabel = business.locality
    ? `${business.locality.name}, ${business.town.name}`
    : business.town.name;
  const heroLocalityLabel = business.address.toLocaleLowerCase().includes(business.town.name.toLocaleLowerCase())
    ? ""
    : localityLabel;
  const townLine = business.locality
    ? `${business.locality.name}, ${business.town.name}, ${business.town.region}`
    : `${business.town.name}, ${business.town.region}`;
  const schedule = resolveBusinessHours(business.hours, business.openingHoursText);
  const hoursStatus = getBusinessHoursStatus(schedule);
  const hoursDetail = getBusinessHoursStatusDetail(schedule);
  const heroGallery = buildGalleryImages(business, business.submissions[0]?.photoUrls);
  const offerings = buildOfferingItems(business, locale);
  const intro = buildBusinessIntro(business, locale);
  const hasAnyHoursSignal = Boolean(schedule?.length || business.openingHoursText || business.isOpenNow);
  const heroOpenLabel = hasAnyHoursSignal
    ? hoursStatus
      ? hoursStatus.isOpen
        ? locale === "it"
          ? "Aperto ora"
          : "Open now"
        : locale === "it"
          ? "Chiuso ora"
          : "Closed now"
      : business.isOpenNow
        ? copy.openNow
        : locale === "it"
          ? "Chiuso ora"
          : "Closed now"
    : null;
  const heroOpenDetail = hoursDetail?.closesAt
    ? `${copy.closesAt} ${hoursDetail.closesAt}`
    : hoursDetail?.opensAt
      ? `${hoursDetail.opensDayOffset === 1 ? copy.opensTomorrow : copy.opensAt} ${hoursDetail.opensAt}`
      : null;
  const aboutDescription = cleanSentence(business.description);
  const hasDistinctAbout = Boolean(
    aboutDescription &&
      !isGenericBusinessCopy(aboutDescription) &&
      aboutDescription.toLocaleLowerCase() !== intro.toLocaleLowerCase(),
  );

  return (
    <main className="shell px-2 py-4 sm:px-6 sm:py-8">
      {returnTo ? (
        <div className="mb-4 px-2 sm:px-0">
          <Link href={returnTo} className="btn-secondary min-h-11 px-4">
            <span aria-hidden="true">←</span>
            {copy.backToBusinessForm}
          </Link>
        </div>
      ) : null}
      <BusinessHero address={business.address} businessName={business.name} callHref={business.phone ? `tel:${business.phone}` : null} categoryLabel={categoryLabel} description={intro} directionsHref={directionsUrl} highlights={offerings} imageAlt={business.name} images={heroGallery} locale={locale} localityLabel={heroLocalityLabel} openDetail={heroOpenDetail} openLabel={heroOpenLabel} openTone={hoursStatus?.isOpen ? "open" : "closed"} phone={business.phone} townHref={`/towns/${business.town.slug}`} websiteHref={businessWebsite} websiteLabel={businessWebsiteLabel} />

      <div className="mt-4 space-y-4 sm:mt-6 sm:space-y-5">
        <Link href={`/towns/${business.town.slug}`} className="flex items-center gap-3 rounded-[1.5rem] border border-[var(--border)] bg-[var(--card)] p-3 shadow-[0_8px_20px_rgba(66,51,31,0.04)] transition hover:border-[rgba(42,98,87,0.28)]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--secondary)] text-xl text-[var(--primary)]">⌂</span>
          <span className="min-w-0 flex-1"><span className="block font-serif text-2xl text-[var(--primary)]">{business.town.name} →</span><span className="mt-0.5 block text-sm text-[var(--muted)]">{copy.townExplore}</span></span>
          <span className="h-14 w-20 shrink-0 rounded-2xl bg-cover bg-center" style={{ backgroundImage: `url("${buildTownImage(business.town, 500)}")` }} />
        </Link>

        {hasDistinctAbout ? <section className="rounded-[1.7rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-6"><h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.about}</h2><p className="mt-3 text-[0.98rem] leading-7 text-[var(--muted-strong)]">{aboutDescription}</p></section> : null}
        <BusinessOpeningHours locale={locale} openingHoursText={business.openingHoursText} schedule={schedule} />
        <BusinessContactCard address={business.address} callHref={business.phone ? `tel:${business.phone}` : null} directionsHref={directionsUrl} email={business.email} locale={locale} phone={business.phone} socialLinks={socialLinks} townLine={townLine} websiteHref={businessWebsite} websiteLabel={businessWebsiteLabel} />
        <BusinessReviews locale={locale} rating={business.rating} reviewCount={business.reviewCount} reviews={business.reviews.map((review) => ({ ...review, createdAt: new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", { dateStyle: "medium" }).format(review.createdAt) }))} />
        <ReviewComposer businessId={business.id} businessName={business.name} locale={locale} />
      </div>
    </main>
  );
}
