import type { Metadata } from "next";

import { TownsLiveSearch } from "@/components/towns-live-search";
import { getCurrentLocale } from "@/lib/locale";
import { getTownsIndexData } from "@/lib/public-data";
import { getSingleParam } from "@/lib/site";

export const metadata: Metadata = {
  title: "Comuni | Salento Local",
  description: "Esplora il Salento comune per comune.",
};

type TownsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TownsPage({ searchParams }: TownsPageProps) {
  const locale = await getCurrentLocale();
  const resolvedSearchParams = await searchParams;
  const query = getSingleParam(resolvedSearchParams.q).trim().toLowerCase();
  const copy =
    locale === "it"
      ? {
          body:
            "Dalla vivace Lecce alle frazioni sul mare come Porto Badisco. Qui puoi cercare comuni, marine e posti piu piccoli in un unico elenco.",
          emptyBody: "Prova con un altro termine di ricerca",
          emptyTitle: "Nessun comune o frazione trovato",
          kicker: "Comuni e frazioni",
          placeholder: "Cerca un comune o una frazione...",
          title: "Comuni e frazioni del Salento",
        }
      : {
          body:
            "From lively Lecce to localities like Porto Badisco, you can search towns, seaside areas, and smaller places together in one list.",
          emptyBody: "Try a different search term",
          emptyTitle: "No towns or localities found",
          kicker: "Towns and localities",
          placeholder: "Search for a town or locality...",
          title: "Towns and localities of Salento",
        };

  const { towns, localities } = await getTownsIndexData();

  const townSearchItems = towns.map((town) => ({
    businessCount: town.businessCount,
    featured: town.featured,
    heroImageSeed: town.heroImageSeed,
    id: town.id,
    imageUrl: town.imageUrl,
    name: town.name,
    province: town.province,
    region: town.region,
    shortDescription: town.shortDescription,
    slug: town.slug,
    thingsToDoCount: town.thingsToDoCount,
  }));
  const localitySearchItems = localities.map((locality) => ({
    id: locality.id,
    slug: locality.slug,
    name: locality.name,
    shortDescription: locality.shortDescription,
    heroImageSeed: locality.heroImageSeed,
    imageUrl: locality.imageUrl,
    featured: locality.featured,
    placeType: locality.placeType,
    town: locality.town,
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
        towns={townSearchItems}
      />
    </main>
  );
}
