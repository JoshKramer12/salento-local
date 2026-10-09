import type { Metadata } from "next";

import { BusinessExplorer } from "@/components/business-explorer";
import { getCurrentLocale } from "@/lib/locale";
import { getDirectoryCatalog, getDirectoryPage } from "@/lib/public-data";
import { getMultiParam, getSingleParam } from "@/lib/site";
import { discoveryMetadata } from "@/lib/seo";

export async function generateMetadata({ searchParams }: DirectoryPageProps): Promise<Metadata> {
  return {
    title: "Directory | Salento Local",
    description: "Cerca attivita, spiagge, servizi e luoghi utili in tutto il Salento.",
    ...discoveryMetadata("/directory", await searchParams),
  };
}

type DirectoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DirectoryPage({
  searchParams,
}: DirectoryPageProps) {
  const locale = await getCurrentLocale();
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q).trim();
  const townFilter = getSingleParam(resolvedSearchParams.town);
  const townFilters = getMultiParam(resolvedSearchParams.towns);
  const localityFilter = getSingleParam(resolvedSearchParams.locality);
  const categoryFilter = getSingleParam(resolvedSearchParams.category);
  const sort = getSingleParam(resolvedSearchParams.sort);
  const view = getSingleParam(resolvedSearchParams.view);
  const page = Math.max(1, Number.parseInt(getSingleParam(resolvedSearchParams.page), 10) || 1);
  const copy =
    locale === "it"
      ? {
          emptyBody:
            "Prova a cambiare la ricerca o a rimuovere un filtro.",
          emptyTitle: "Nessun luogo trovato",
          intro: "Trova ristoranti, spiagge, negozi, servizi e luoghi in tutto il Salento.",
          placeholder: "Cerca ristoranti, spiagge, farmacie...",
          results: "luoghi trovati",
          title: "Esplora il Salento",
        }
      : {
          emptyBody:
            "Try changing your search or removing a filter.",
          emptyTitle: "No places found",
          intro: "Find restaurants, beaches, shops, services and places across Salento.",
          placeholder: "Search restaurants, beaches, pharmacies...",
          results: "places found",
          title: "Explore Salento",
        };

  const [catalog, resultPage] = await Promise.all([
    getDirectoryCatalog(),
    getDirectoryPage({ category: categoryFilter, locality: localityFilter, page, query, sort, townSlugs: townFilters.length ? townFilters : townFilter ? [townFilter] : [] }),
  ]);
  const { towns, localities, categories } = catalog;

  const townSlugById = new Map(towns.map((town) => [town.id, town.slug]));
  return (
    <main className="directory-page overflow-x-clip pb-12 sm:pb-16">
      <BusinessExplorer
        key={`${query}:${townFilter}:${townFilters.join(",")}:${localityFilter}:${categoryFilter}:${sort}:${view}:${resultPage.page}`}
        businesses={resultPage.businesses}
        categories={categories}
        emptyBody={copy.emptyBody}
        emptyTitle={copy.emptyTitle}
        initialState={{
          category: categoryFilter,
          locality: localityFilter,
          q: query,
          sort,
          town: townFilter,
          towns: townFilters,
          view,
        }}
        heroImageUrl="/explore-hero/ports-of-call-otranto.webp"
        heroIntro={copy.intro}
        heroTitle={copy.title}
        locale={locale}
        localities={localities.map((locality) => ({
          name: locality.name,
          slug: locality.slug,
          townSlug: townSlugById.get(locality.townId) ?? "",
        }))}
        pageSize={24}
        resultLabel={copy.results}
        searchPlaceholder={copy.placeholder}
        showCategoryChips
        showExploreHero
        showLocalityFilter
        showTownFilter
        townFilterMode="multi"
        showViewToggle
        serverPagination={{ currentPage: resultPage.page, totalResults: resultPage.total }}
        towns={towns.map((town) => ({
          name: town.name,
          slug: town.slug,
        }))}
      />
    </main>
  );
}
