import type { Metadata } from "next";

import { TownsLiveSearch } from "@/components/towns-live-search";
import { getCurrentLocale } from "@/lib/locale";
import { getLocalitiesIndexData } from "@/lib/public-data";
import { getSingleParam } from "@/lib/site";
import { discoveryMetadata } from "@/lib/seo";

export async function generateMetadata({ searchParams }: LocalitiesPageProps): Promise<Metadata> {
  return {
    title: "Frazioni | Salento Local",
    description: "Esplora frazioni, marine e localita piu piccole in tutto il Salento.",
    ...discoveryMetadata("/localities", await searchParams),
  };
}

type LocalitiesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LocalitiesPage({
  searchParams,
}: LocalitiesPageProps) {
  const locale = await getCurrentLocale();
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q).trim().toLowerCase();
  const copy =
    locale === "it"
      ? {
          body:
            "Esplora frazioni, marine e posti piu piccoli senza perdere il collegamento con il comune di riferimento.",
          emptyBody: "Prova con un altro termine di ricerca",
          emptyTitle: "Nessuna localita trovata",
          kicker: "Frazioni e marine",
          placeholder: "Cerca una localita...",
          title: "Frazioni del Salento",
        }
      : {
          body:
            "Explore localities, seaside areas, and smaller places without losing the link to their main town.",
          emptyBody: "Try a different search term",
          emptyTitle: "No localities found",
          kicker: "Localities",
          placeholder: "Search for a locality...",
          title: "Localities of Salento",
        };

  const localities = await getLocalitiesIndexData();

  const localitySearchItems = localities.map((locality) => ({
    id: locality.id,
    slug: locality.slug,
    name: locality.name,
    shortDescription: locality.shortDescription,
    heroImageSeed: locality.heroImageSeed,
    imageUrl: locality.imageUrl,
    featured: locality.featured,
    placeType: locality.placeType,
    town: {
      heroImageSeed: locality.town.heroImageSeed,
      imageUrl: locality.town.imageUrl,
      name: locality.town.name,
      slug: locality.town.slug,
      region: locality.town.region,
    },
    _count: locality._count,
  }));

  return (
    <main className="shell px-4 py-12 sm:px-6">
      <div className="mb-10">
        <p className="section-kicker mb-2">{copy.kicker}</p>
        <h1 className="font-serif text-4xl text-[var(--foreground)]">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-xl text-[var(--muted)]">
          {copy.body}
        </p>
      </div>

      <TownsLiveSearch
        copy={copy}
        initialQuery={query}
        localities={localitySearchItems}
        locale={locale}
        towns={[]}
      />
    </main>
  );
}
