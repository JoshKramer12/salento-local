import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  IconArrowLeft,
  IconBuildingStore,
  IconMap2,
} from "@tabler/icons-react";

import { BusinessExplorer } from "@/components/business-explorer";
import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import { TownCategoryCard } from "@/components/town-category-card";
import {
  getBusinessOriginSlug,
  resolveBusinessBackLink,
} from "@/lib/business-listing-navigation";
import { getLocaleTag } from "@/lib/i18n";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import {
  buildTownImage,
  getCategoryLabel,
  getSingleParam,
  type BusinessSignal,
} from "@/lib/site";

type TownPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type TownCategorySummary = {
  category: {
    group: string;
    id: string;
    name: string;
    slug: string;
  };
  count: number;
  label: string;
};

const categoryPriority = [
  "restaurants",
  "cafes",
  "beaches",
  "hotels",
  "things-to-do",
  "local-services",
  "shops",
] as const;

const categoryScore = new Map(
  categoryPriority.map((slug, index) => [slug, categoryPriority.length - index]),
);

const localServicesPresetSlugs = [
  "bakeries",
  "grocery",
  "mechanics",
  "pharmacies",
  "plumbers",
  "services",
  "shops",
] as const;

function getRawTagRecord(rawTags: unknown) {
  if (!rawTags || typeof rawTags !== "object" || Array.isArray(rawTags)) {
    return {} as Record<string, unknown>;
  }

  return rawTags as Record<string, unknown>;
}

function buildBusinessSignals(
  business: {
    isFeatured: boolean;
    isOpenNow: boolean;
    rating: number;
    rawTags: unknown;
    reviewCount: number;
    tags: Array<{ tag: { name: string; slug: string } }>;
    verificationStatus: string;
  },
) {
  const signals: BusinessSignal[] = [];
  const rawTags = getRawTagRecord(business.rawTags);
  const signalText = [
    ...Object.entries(rawTags).flatMap(([key, value]) => [key, String(value)]),
    ...business.tags.map((entry) => entry.tag.slug),
    ...business.tags.map((entry) => entry.tag.name),
  ]
    .join(" ")
    .toLowerCase();

  if (business.isFeatured) {
    signals.push("featured");
  }

  if (
    business.verificationStatus === "OWNER_VERIFIED" ||
    business.verificationStatus === "COMMUNITY_VERIFIED"
  ) {
    signals.push("verified");
  }

  if (business.isOpenNow) {
    signals.push("openNow");
  }

  if (business.rating >= 4.5 && business.reviewCount >= 1) {
    signals.push("highlyRated");
  }

  if (/family|kid|children|child|baby/i.test(signalText)) {
    signals.push("familyFriendly");
  }

  if (
    rawTags.wheelchair === "yes" ||
    rawTags.wheelchair === "limited" ||
    /wheelchair accessible|accessible/i.test(signalText)
  ) {
    signals.push("accessible");
  }

  return signals;
}

function scoreCategory(slug: string) {
  return categoryScore.get(slug as (typeof categoryPriority)[number]) ?? 0;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  let town = await prisma.town.findUnique({
    where: { slug },
    select: { name: true, shortDescription: true },
  });

  if (!town) {
    const alias = await prisma.townAlias.findUnique({
      where: { slug },
      include: {
        town: {
          select: {
            name: true,
            shortDescription: true,
          },
        },
      },
    });

    town = alias?.town ?? null;
  }

  if (!town) {
    return {
      title: "Comune non trovato | Salento Local",
    };
  }

  return {
    title: `${town.name} | Salento Local`,
    description: town.shortDescription,
  };
}

export default async function TownPage({
  params,
  searchParams,
}: TownPageProps) {
  const locale = await getCurrentLocale();
  const numberLocale = getLocaleTag(locale);
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q).trim();
  const categoryFilter = getSingleParam(resolvedSearchParams.category);
  const localityFilter = getSingleParam(resolvedSearchParams.locality);
  const sort = getSingleParam(resolvedSearchParams.sort);
  const view = getSingleParam(resolvedSearchParams.view);
  const businessOriginSlug = getBusinessOriginSlug(
    getSingleParam(resolvedSearchParams.fromBusiness),
  );
  const copy =
    locale === "it"
      ? {
          area: "Superficie",
          areasButton: "Vedi tutte le aree",
          back: "Torna ai comuni",
          backToBusiness: "Torna a",
          browseAll: "Esplora tutti i luoghi",
          elevation: "Altitudine",
          exploreKicker: "Esplora tutto",
          exploreTitle: "Trova esattamente quello che ti serve",
          notAvailable: "n/d",
          officialWebsite: "Sito ufficiale",
          population: "Abitanti",
          province: "Provincia",
          region: "Regione",
          resultsLabel: "risultati",
          searchPlaceholder: "Cerca un luogo, una via o una categoria",
          startKicker: "Inizia a esplorare",
          startTitle: "Cosa puoi scoprire qui",
        }
      : {
          area: "Area",
          areasButton: "View all areas",
          back: "Back to towns",
          backToBusiness: "Back to",
          browseAll: "Explore All Places",
          elevation: "Elevation",
          exploreKicker: "Explore everything",
          exploreTitle: "Find exactly what you need",
          notAvailable: "N/A",
          officialWebsite: "Official website",
          population: "Population",
          province: "Province",
          region: "Region",
          resultsLabel: "results",
          searchPlaceholder: "Search a place, street, or category",
          startKicker: "Start exploring",
          startTitle: "What you can discover here",
        };

  const town = await prisma.town.findUnique({
    where: { slug },
    include: {
      localities: {
        include: {
          _count: {
            select: {
              businesses: true,
            },
          },
        },
        orderBy: [{ featured: "desc" }, { name: "asc" }],
      },
      businesses: {
        include: {
          category: true,
          locality: true,
          town: true,
          images: {
            take: 1,
            orderBy: {
              sortOrder: "asc",
            },
          },
          tags: {
            include: {
              tag: true,
            },
            take: 6,
          },
        },
        orderBy: [
          { isFeatured: "desc" },
          { reviewCount: "desc" },
          { rating: "desc" },
          { name: "asc" },
        ],
      },
    },
  });

  if (!town) {
    const alias = await prisma.townAlias.findUnique({
      where: { slug },
      include: {
        town: true,
      },
    });

    if (alias?.town) {
      redirect(`/towns/${alias.town.slug}`);
    }

    notFound();
  }

  const businessOrigin = businessOriginSlug
    ? await prisma.business.findUnique({
        where: { slug: businessOriginSlug },
        select: {
          name: true,
          slug: true,
          townId: true,
        },
      })
    : null;
  const businessBackLink = resolveBusinessBackLink(
    businessOriginSlug,
    businessOrigin,
    town.id,
  );
  const backHref = businessBackLink?.href ?? "/towns";
  const backLabel = businessBackLink
    ? `${copy.backToBusiness} ${businessBackLink.name}`
    : copy.back;

  const allCategoryCounts = town.businesses.reduce<Record<string, number>>((accumulator, business) => {
    accumulator[business.category.slug] = (accumulator[business.category.slug] ?? 0) + 1;
    return accumulator;
  }, {});

  const localServicesCount = localServicesPresetSlugs.reduce(
    (total, slug) => total + (allCategoryCounts[slug] ?? 0),
    0,
  );

  const sortedCategories = Object.entries(allCategoryCounts)
    .map(([categorySlug, count]) => ({
      category:
        town.businesses.find((business) => business.category.slug === categorySlug)?.category ?? null,
      count,
    }))
    .filter(
      (item): item is { category: NonNullable<typeof item.category>; count: number } =>
        Boolean(item.category),
    )
    .sort(
      (left, right) =>
        scoreCategory(right.category.slug) - scoreCategory(left.category.slug) ||
        right.count - left.count ||
        left.category.name.localeCompare(right.category.name, locale),
    );

  const categoryBySlug = new Map(sortedCategories.map((item) => [item.category.slug, item]));
  const localServicesCategory: TownCategorySummary = {
    count: localServicesCount,
    category: {
      group: "SERVICE",
      id: "local-services",
      name: locale === "it" ? "Servizi" : "Services",
      slug: "local-services",
    },
    label: getCategoryLabel(
      "local-services",
      locale === "it" ? "Servizi" : "Services",
      locale,
    ),
  };

  const badgeCategories: TownCategorySummary[] = [
    "restaurants",
    "cafes",
    "beaches",
    "hotels",
    "things-to-do",
    "local-services",
  ]
    .map((slug): TownCategorySummary | null => {
      if (slug === "local-services") {
        return localServicesCategory.count > 0 ? localServicesCategory : null;
      }

      const item = categoryBySlug.get(slug);

      return item
        ? {
            ...item,
            label: getCategoryLabel(item.category.slug, item.category.name, locale),
          }
        : null;
    })
    .filter((item): item is TownCategorySummary => Boolean(item));

  const displayCategories: TownCategorySummary[] = [
    ...badgeCategories,
    ...sortedCategories
      .filter(
        ({ category }) =>
          !badgeCategories.some((item) => item.category.slug === category.slug) &&
          !localServicesPresetSlugs.includes(category.slug as (typeof localServicesPresetSlugs)[number]),
      )
      .map(({ category, count }) => ({
        category,
        count,
        label: getCategoryLabel(category.slug, category.name, locale),
      })),
  ].slice(0, 8);

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="relative h-[26rem] sm:h-[32rem]">
          <img
            src={buildTownImage(town, 1800)}
            alt={town.name}
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,23,20,0.78)] via-[rgba(26,23,20,0.32)] to-transparent" />
          <div className="shell absolute inset-x-0 top-0 z-10 px-4 pt-5 sm:px-6 sm:pt-6">
            <Link
              href={backHref}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(255,255,255,0.62)] bg-[rgba(255,255,255,0.74)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] shadow-[0_16px_36px_rgba(0,0,0,0.18)] backdrop-blur-md transition-all hover:bg-[rgba(255,255,255,0.9)] hover:shadow-[0_20px_42px_rgba(0,0,0,0.24)]"
            >
              <IconArrowLeft size={16} className="shrink-0" />
              <span className="truncate">{backLabel}</span>
            </Link>
          </div>
          <div className="shell absolute inset-x-0 bottom-0 px-4 pb-8 sm:px-6 sm:pb-12">
            <p className="text-sm text-white/68">
              {town.province}, {town.region}
            </p>
            <h1 className="mt-2 max-w-3xl font-serif text-4xl text-white sm:text-5xl lg:text-6xl">
              {town.name}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 sm:text-lg">
              {town.shortDescription}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={`/directory?town=${town.slug}`} className="btn-primary">
                <IconBuildingStore size={16} />
                {copy.browseAll}
              </Link>
              {town.localities.length ? (
                <Link href={{ pathname: "/localities", query: { q: town.name } }} className="btn-secondary">
                  <IconMap2 size={16} />
                  {copy.areasButton}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {badgeCategories.length ? (
        <section className="shell relative z-10 -mt-6 px-4 sm:px-6">
          <div className="flex gap-3 overflow-x-auto rounded-[2rem] border border-[var(--border)] bg-[rgba(255,255,255,0.9)] p-4 shadow-[0_18px_40px_rgba(26,23,20,0.08)] backdrop-blur scrollbar-hide">
            {badgeCategories.map(({ category, count, label }) => (
              <Link
                key={category.id}
                href={`/towns/${town.slug}?category=${category.slug}#explore`}
                className="inline-flex shrink-0 items-center gap-3 whitespace-nowrap rounded-full bg-[var(--secondary)] px-4 py-2.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary-strong)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--card)] text-[var(--primary)]">
                  <CategoryIconGlyph slug={category.slug} size={16} />
                </span>
                <span className="font-medium">{label}</span>
                <span className="text-[var(--muted)]">{count.toLocaleString(numberLocale)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {displayCategories.length ? (
        <section className="shell px-4 py-10 sm:px-6 sm:py-12">
          <div className="mb-6">
            <p className="section-kicker mb-3">{copy.startKicker}</p>
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.startTitle}</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {displayCategories.map(({ category, count }) => (
              <TownCategoryCard
                key={category.id}
                category={category}
                count={count}
                locale={locale}
                townSlug={town.slug}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section id="explore" className="shell px-4 pb-16 sm:px-6">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-kicker mb-3">{copy.exploreKicker}</p>
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.exploreTitle}</h2>
          </div>
          <Link href={`/directory?town=${town.slug}`} className="btn-secondary">
            {copy.browseAll}
          </Link>
        </div>

        <BusinessExplorer
          businesses={town.businesses.map((business) => ({
            address: business.address,
            category: business.category,
            id: business.id,
            images: business.images,
            isFeatured: business.isFeatured,
            isOpenNow: business.isOpenNow,
            locality: business.locality
              ? {
                  id: business.locality.id,
                  name: business.locality.name,
                  slug: business.locality.slug,
                  townSlug: town.slug,
                }
              : null,
            name: business.name,
            priceLevel: business.priceLevel,
            rating: business.rating,
            reviewCount: business.reviewCount,
            searchText: [
              business.name,
              business.shortDescription,
              business.description,
              business.address,
              business.category.name,
              business.locality?.name ?? "",
            ]
              .join(" ")
              .toLowerCase(),
            shortDescription: business.shortDescription,
            signals: buildBusinessSignals(business),
            slug: business.slug,
            town: business.town,
          }))}
          categories={[
            ...(localServicesCount > 0
              ? [
                  {
                    group: "SERVICE" as const,
                    name: localServicesCategory.category.name,
                    slug: localServicesCategory.category.slug,
                  },
                ]
              : []),
            ...sortedCategories.map(({ category }) => ({
              group: category.group,
              name: category.name,
              slug: category.slug,
            })),
          ]}
          categoryPresets={{
            "local-services": [...localServicesPresetSlugs],
          }}
          emptyBody={
            locale === "it"
              ? "Prova con parole chiave diverse oppure restringi per area o categoria."
              : "Try different keywords or narrow things down by area or category."
          }
          emptyTitle={locale === "it" ? "Nessun luogo trovato" : "No places found"}
          initialState={{
            category: categoryFilter,
            locality: localityFilter,
            q: query,
            sort,
            view,
          }}
          locale={locale}
          lockedTownSlug={town.slug}
          localities={town.localities.map((locality) => ({
            name: locality.name,
            slug: locality.slug,
            townSlug: town.slug,
          }))}
          maxVisibleResults={12}
          resultLabel={copy.resultsLabel}
          searchPlaceholder={copy.searchPlaceholder}
          showCategoryChips={false}
          showLocalityFilter
          showTownFilter={false}
          showViewToggle
          towns={[
            {
              name: town.name,
              slug: town.slug,
            },
          ]}
        />
      </section>
    </main>
  );
}
