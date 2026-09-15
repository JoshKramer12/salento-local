import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBuildingCommunity,
} from "@tabler/icons-react";

import { BusinessExplorer } from "@/components/business-explorer";
import { BusinessCard } from "@/components/business-card";
import { getCurrentLocale } from "@/lib/locale";
import { getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { prisma } from "@/lib/prisma";
import {
  buildLocalityImage,
  buildTownImage,
  getCategoryHelperText,
  getCategoryLabel,
  getLocalityKindLabel,
  getSingleParam,
} from "@/lib/site";

type LocalityPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locality = await prisma.locality.findUnique({
    where: { slug },
    include: {
      town: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!locality) {
    return {
      title: "Localita non trovata | Salento Local",
    };
  }

  return {
    title: `${locality.name} | Salento Local`,
    description: `${locality.shortDescription} Comune di riferimento: ${locality.town.name}.`,
  };
}

export default async function LocalityPage({
  params,
  searchParams,
}: LocalityPageProps) {
  const locale = await getCurrentLocale();
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q).trim();
  const categoryFilter = getSingleParam(resolvedSearchParams.category);
  const sort = getSingleParam(resolvedSearchParams.sort);
  const view = getSingleParam(resolvedSearchParams.view);
  const copy =
    locale === "it"
      ? {
          about: "Panoramica area",
          allCategories: "Tutte le categorie",
          areasNearby: "Aree vicine",
          back: "Torna al comune",
          browseTown: "Vedi tutto nel comune",
          category: "Categoria",
          categoryIntro: "Categorie utili per capire rapidamente che tipo di luoghi trovi qui.",
          goToTown: "Vai al comune",
          information: "Informazioni area",
          insideTown: "Parte di",
          listings: "Luoghi in questa area",
          listingsCount: "luoghi",
          nearbyInTown: "Vicino in",
          nearbyIntro:
            "Se in questa area non trovi abbastanza scelta, questi posti nel comune vicino possono aiutarti.",
          nearbyPlaces: "Posti vicini",
          parentTown: "Comune di riferimento",
          practical: "Informazioni pratiche",
          search: "Cerca",
          searchPlaceholder: "Cerca luoghi o categorie in questa area",
          subtitle: "Guida di area",
          type: "Tipo",
          viewAllPlaces: "Esplora tutti i luoghi in",
          whatToFind: "Cosa trovi qui",
        }
      : {
          about: "About the area",
          allCategories: "All categories",
          areasNearby: "Nearby areas",
          back: "Back to town",
          browseTown: "See everything in town",
          category: "Category",
          categoryIntro: "Helpful categories for quickly understanding what kind of places are here.",
          goToTown: "Go to town",
          information: "Area information",
          insideTown: "Part of",
          listings: "Places in this area",
          listingsCount: "places",
          nearbyInTown: "Nearby in",
          nearbyIntro:
            "If this area feels limited, these places elsewhere in the parent town can help widen the search.",
          nearbyPlaces: "Nearby places",
          parentTown: "Parent town",
          practical: "Practical information",
          search: "Search",
          searchPlaceholder: "Search places or categories in this area",
          subtitle: "Area guide",
          type: "Type",
          viewAllPlaces: "Explore all places in",
          whatToFind: "What you can find here",
        };

  const locality = await prisma.locality.findUnique({
    where: { slug },
    include: {
      town: true,
      businesses: {
        where: getPublicBusinessMembershipWhere(),
        include: {
          town: true,
          locality: true,
          category: true,
          images: {
            take: 1,
            orderBy: {
              sortOrder: "asc",
            },
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

  if (!locality) {
    notFound();
  }

  const [nearbyBusinesses, siblingLocalities] = await Promise.all([
    prisma.business.findMany({
      where: {
        townId: locality.townId,
        localityId: {
          not: locality.id,
        },
        isLikelyClosed: false,
        ...getPublicBusinessMembershipWhere(),
      },
      include: {
        town: true,
        locality: true,
        category: true,
        images: {
          take: 1,
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
      orderBy: [{ isFeatured: "desc" }, { reviewCount: "desc" }, { name: "asc" }],
      take: 4,
    }),
    prisma.locality.findMany({
      where: {
        townId: locality.townId,
        id: {
          not: locality.id,
        },
      },
      include: {
          _count: {
            select: {
              businesses: { where: getPublicBusinessMembershipWhere() },
          },
        },
      },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 5,
    }),
  ]);

  const categories = Array.from(
    new Map(
      locality.businesses.map((business) => [business.category.slug, business.category]),
    ).values(),
  );

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="relative h-[23rem] sm:h-[28rem]">
          <img
            src={buildLocalityImage(locality, 1800)}
            alt={locality.name}
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,23,20,0.78)] via-[rgba(26,23,20,0.3)] to-transparent" />
          <div className="shell absolute inset-x-0 bottom-0 px-4 pb-8 sm:px-6 sm:pb-12">
            <Link
              href={`/towns/${locality.town.slug}`}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-white/72 transition-colors hover:text-white"
            >
              <IconArrowLeft size={14} />
              {copy.back}
            </Link>
            <p className="section-kicker mb-3 text-white/75">{copy.subtitle}</p>
            <p className="text-sm text-white/68">
              {copy.insideTown} {locality.town.name}
            </p>
            <h1 className="mt-2 font-serif text-4xl text-white sm:text-5xl">{locality.name}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/78">
              {locality.shortDescription}
            </p>
          </div>
        </div>
      </section>

      <section className="shell px-4 py-8 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: copy.listings,
              value: locality.businesses.length,
            },
            {
              label: copy.whatToFind,
              value: categories.length,
            },
            {
              label: copy.parentTown,
              value: locality.town.name,
            },
            {
              label: copy.nearbyPlaces,
              value: nearbyBusinesses.length,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]"
            >
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">
                {stat.label}
              </div>
              <div className="mt-2 font-serif text-3xl text-[var(--foreground)]">
                {typeof stat.value === "number" ? stat.value : stat.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="shell grid gap-10 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="space-y-8">
          <section className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
            <p className="section-kicker mb-2">{copy.about}</p>
            <h2 className="font-serif text-3xl text-[var(--foreground)]">{locality.name}</h2>
            <p className="mt-4 text-base leading-8 text-[var(--muted)]">{locality.intro}</p>
          </section>

          {categories.length ? (
            <section className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
              <div className="mb-5">
                <p className="section-kicker mb-2">{copy.whatToFind}</p>
                <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.whatToFind}</h2>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{copy.categoryIntro}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {categories.map((category) => {
                  const count = locality.businesses.filter(
                    (business) => business.category.slug === category.slug,
                  ).length;

                  return (
                    <Link
                      key={category.id}
                      href={`/directory?town=${locality.town.slug}&category=${category.slug}`}
                      className="rounded-3xl border border-[var(--border)] bg-[color:rgba(247,244,239,0.7)] p-5 transition-all hover:border-[color:rgba(42,98,87,0.24)] hover:shadow-[var(--shadow-card)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-medium text-[var(--foreground)]">
                          {getCategoryLabel(category.slug, category.name, locale)}
                        </h3>
                        <span className="pill-muted">{count}</span>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                        {getCategoryHelperText(category.slug, locale)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="section-kicker mb-2">{copy.listings}</p>
                <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.listings}</h2>
              </div>
              <Link href={`/directory?town=${locality.town.slug}`} className="btn-secondary">
                {copy.viewAllPlaces} {locality.town.name}
              </Link>
            </div>

            <BusinessExplorer
              businesses={locality.businesses.map((business) => ({
                address: business.address,
                category: business.category,
                id: business.id,
                images: business.images,
                isFeatured: business.isFeatured,
                locality: business.locality
                  ? {
                      id: business.locality.id,
                      name: business.locality.name,
                      slug: business.locality.slug,
                      townSlug: locality.town.slug,
                    }
                  : null,
                name: business.name,
                priceLevel: business.priceLevel,
                rating: business.rating,
                reviewCount: business.reviewCount,
                searchText: [
                  business.name,
                  business.shortDescription,
                  business.address,
                  business.category.name,
                  business.town.name,
                  business.locality?.name ?? "",
                ]
                  .join(" ")
                  .toLowerCase(),
                shortDescription: business.shortDescription,
                slug: business.slug,
                town: business.town,
              }))}
              categories={categories.map((category) => ({
                group: category.group,
                name: category.name,
                slug: category.slug,
              }))}
              emptyBody={
                locale === "it"
                  ? "Prova con parole chiave diverse oppure restringi per categoria."
                  : "Try different keywords or narrow things down by category."
              }
              emptyTitle={locale === "it" ? "Nessun luogo trovato" : "No places found"}
              initialState={{
                category: categoryFilter,
                q: query,
                sort,
                view,
              }}
              locale={locale}
              lockedLocalitySlug={locality.slug}
              localities={[
                {
                  name: locality.name,
                  slug: locality.slug,
                  townSlug: locality.town.slug,
                },
              ]}
              maxVisibleResults={12}
              resultLabel={copy.listingsCount}
              searchPlaceholder={copy.searchPlaceholder}
              showCategoryChips={false}
              showLocalityFilter={false}
              showTownFilter={false}
              showViewToggle
              towns={[
                {
                  name: locality.town.name,
                  slug: locality.town.slug,
                },
              ]}
            />
          </section>

          {nearbyBusinesses.length ? (
            <section className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
              <div className="mb-5">
                <p className="section-kicker mb-2">
                  {copy.nearbyInTown} {locality.town.name}
                </p>
                <h2 className="font-serif text-3xl text-[var(--foreground)]">
                  {copy.nearbyInTown} {locality.town.name}
                </h2>
                <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{copy.nearbyIntro}</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {nearbyBusinesses.map((business) => (
                  <BusinessCard key={business.id} business={business} locale={locale} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
            <h3 className="mb-4 font-medium text-[var(--foreground)]">{copy.information}</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-[var(--muted)]">{copy.parentTown}</span>
                <span className="font-medium text-[var(--foreground)]">{locality.town.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--muted)]">{copy.type}</span>
                <span className="font-medium text-[var(--foreground)]">
                  {getLocalityKindLabel(locality.placeType, locale)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[var(--muted)]">{copy.listings}</span>
                <span className="font-medium text-[var(--foreground)]">{locality.businesses.length}</span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
            <div
              className="h-36 bg-cover bg-center"
              style={{ backgroundImage: `url("${buildTownImage(locality.town, 1200)}")` }}
            />
            <div className="p-6">
              <p className="section-kicker mb-2">{copy.parentTown}</p>
              <h3 className="font-serif text-2xl text-[var(--foreground)]">{locality.town.name}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                {locality.name} {locale === "it" ? "fa parte di" : "belongs to"} {locality.town.name}
                .
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <Link href={`/towns/${locality.town.slug}`} className="btn-primary">
                  {copy.goToTown}
                </Link>
                <Link href={`/directory?town=${locality.town.slug}`} className="btn-secondary">
                  {copy.browseTown}
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
            <h3 className="mb-3 font-medium text-[var(--foreground)]">{copy.practical}</h3>
            <p className="text-sm leading-7 text-[var(--muted)]">{locality.practicalInfo}</p>
          </div>

          {siblingLocalities.length ? (
            <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
              <div className="mb-4 flex items-center gap-2">
                <IconBuildingCommunity size={16} className="text-[var(--primary)]" />
                <h3 className="font-medium text-[var(--foreground)]">{copy.areasNearby}</h3>
              </div>
              <div className="space-y-3">
                {siblingLocalities.map((item) => (
                  <Link
                    key={item.id}
                    href={`/localities/${item.slug}`}
                    className="flex items-start justify-between gap-3 rounded-2xl bg-[var(--secondary)] px-4 py-3 transition-colors hover:bg-[var(--secondary-strong)]"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">{item.name}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {getLocalityKindLabel(item.placeType, locale)}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
                      {item._count.businesses}
                      <IconArrowRight size={12} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
