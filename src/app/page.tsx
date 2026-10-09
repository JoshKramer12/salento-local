import Link from "next/link";
import type { Metadata } from "next";
import { IconArrowRight, IconBuildingStore, IconChevronRight, IconUsersGroup } from "@tabler/icons-react";

import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import { HardNavigationLink } from "@/components/hard-navigation-link";
import { SearchAutocomplete } from "@/components/search-autocomplete";
import { getCurrentLocale } from "@/lib/locale";
import { getHomePageData } from "@/lib/public-data";
import { buildBusinessImage, buildBusinessPhoto, buildLocalityImage, buildTownImage, getCategoryLabel, homeCategorySlugs } from "@/lib/site";
import { publicUrl } from "@/lib/seo";

export const metadata: Metadata = { alternates: { canonical: publicUrl("/") } };

export default async function HomePage() {
  const locale = await getCurrentLocale();
  const { categories, featuredBusinesses, featuredLocalities, featuredTowns } = await getHomePageData();
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const orderedCategories = homeCategorySlugs
    .map((slug) => categoryBySlug.get(slug))
    .filter((category): category is (typeof categories)[number] => Boolean(category));
  const heroTown = featuredTowns.find((town) => town.slug === "otranto") ?? featuredTowns[0] ?? null;
  const localities = Array.from(new Map(featuredLocalities.map((locality) => [locality.name, locality])).values()).slice(0, 6);
  const towns = featuredTowns.slice(0, 4);
  const copy = getCopy(locale);
  const heroOverlay = "linear-gradient(180deg,rgba(24,29,27,0.4),rgba(24,29,27,0.48) 54%,rgba(24,29,27,0.68))";

  return (
    <main className="homepage">
      <section className="homepage-hero relative overflow-visible bg-cover bg-center" style={{ backgroundImage: heroTown ? `${heroOverlay}, url("${buildTownImage(heroTown, 1800)}")` : heroOverlay }}>
        <div className="mx-auto flex min-h-[29rem] max-w-4xl flex-col items-center justify-center px-4 pb-24 pt-20 text-center sm:min-h-[32rem] sm:px-6 sm:pt-24">
          <h1 className="font-serif text-5xl leading-[0.94] tracking-[-0.035em] text-white sm:text-6xl lg:text-7xl">{copy.heroTitle}<span className="mt-1 block font-normal italic text-white/90">{copy.heroTitleAccent}</span></h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/85 sm:text-base">{copy.heroBody}</p>
          <div className="mt-7 w-full max-w-2xl"><SearchAutocomplete buttonLabel={copy.searchButton} locale={locale} placeholder={copy.searchPlaceholder} searchPath="/directory" variant="hero" /></div>
        </div>
      </section>

      <section className="shell homepage-category-row relative z-10 -mt-10 px-3 sm:px-6">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 sm:gap-3 lg:grid-cols-10">
          {orderedCategories.map((category) => <Link key={category.id} href={`/directory?category=${category.slug}`} className="homepage-category group flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-1.5 py-2.5 text-center shadow-[0_8px_18px_rgba(40,51,48,0.08)] sm:min-h-28 sm:px-2 sm:py-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(42,98,87,0.09)] text-[var(--primary)] sm:h-9 sm:w-9"><CategoryIconGlyph slug={category.slug} size={18} /></span><span className="text-[0.66rem] font-semibold leading-tight text-[var(--foreground)] sm:text-xs">{getCategoryLabel(category.slug, category.name, locale)}</span><span className="hidden text-[10px] text-[var(--muted)] lg:block">{category._count.businesses} {locale === "it" ? "risultati" : "results"}</span></Link>)}
        </div>
      </section>

      <section className="shell px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading action={copy.allTowns} href="/towns" title={copy.townsTitle} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {towns.map((town) => <Link key={town.id} href={`/towns/${town.slug}`} className="homepage-town-card group overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_6px_18px_rgba(40,51,48,0.06)]"><div className="relative h-36 overflow-hidden sm:h-44 lg:h-48"><img src={buildTownImage(town, 1000)} alt={town.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" decoding="async" /></div><div className="min-w-0 p-3.5 sm:p-4"><h3 className="font-serif text-xl text-[var(--foreground)]">{town.name}</h3>{town.shortDescription ? <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{town.shortDescription}</p> : null}<div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-[var(--muted)]">{town.businessCount} {copy.townPlaces}</span><span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[var(--primary)]">{copy.discover}<IconChevronRight size={14} /></span></div></div></Link>)}
        </div>
        <HardNavigationLink href="/towns" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] sm:hidden">{copy.viewAllTowns}<IconArrowRight size={15} /></HardNavigationLink>
      </section>

      <section className="shell px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading action={copy.allLocalities} href="/localities" title={copy.localityTitle} />
        <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6 lg:gap-3">
          {localities.map((locality) => <Link key={locality.id} href={`/localities/${locality.slug}`} className="homepage-locality-card group overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_5px_16px_rgba(40,51,48,0.05)]"><div className="h-20 shrink-0 overflow-hidden sm:h-28"><img src={buildLocalityImage(locality, 700)} alt={locality.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" loading="lazy" decoding="async" /></div><div className="min-w-0 p-2.5 sm:p-3"><h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{locality.name}</h3><p className="mt-0.5 truncate text-xs text-[var(--muted)]">{locality.town.name}</p></div></Link>)}
        </div>
        <HardNavigationLink href="/localities" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)] sm:hidden">{copy.viewAllLocalities}<IconArrowRight size={15} /></HardNavigationLink>
      </section>

      <section className="shell px-4 pb-14 sm:px-6 sm:pb-20">
        <SectionHeading action={copy.exploreMore} href="/directory" title={copy.placesTitle} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {featuredBusinesses.slice(0, 4).map((business) => {
            const primaryImage = business.images?.[0];
            const image = buildBusinessPhoto(primaryImage?.url, 900, { label: business.name, seed: business.heroImageSeed, type: business.category.slug === "beaches" ? "beach" : "business" }) ?? buildBusinessImage(business, business.category.slug, 900);
            const location = business.locality ? `${business.locality.name}, ${business.town.name}` : business.town.name;
            const description = getHomepageBusinessDescription(business.shortDescription);
            return <Link key={business.id} href={`/businesses/${business.slug}`} className="homepage-place-card group overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_6px_18px_rgba(40,51,48,0.06)]"><div className="relative h-36 overflow-hidden sm:h-44 lg:h-40"><img src={image} alt={primaryImage?.alt || business.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" decoding="async" /><div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" /><span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-2 py-1 text-[10px] font-semibold text-[var(--primary)]">{getCategoryLabel(business.category.slug, business.category.name, locale)}</span></div><div className="p-3.5 sm:p-4"><h3 className="truncate font-serif text-xl text-[var(--foreground)]">{business.name}</h3><p className="mt-1 truncate text-xs text-[var(--muted)]">{location}</p>{description ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{description}</p> : null}<span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]">{copy.viewPlace}<IconArrowRight size={13} /></span></div></Link>;
          })}
        </div>
      </section>

      <section className="shell px-4 pb-4 sm:px-6 sm:pb-8"><div className="text-center"><h2 className="font-serif text-3xl tracking-[-0.02em] text-[var(--foreground)] sm:text-4xl">{copy.joinTitle}</h2><p className="mt-2 text-sm text-[var(--muted)]">{copy.joinSubtitle}</p></div><div className="mx-auto mt-7 grid max-w-4xl gap-4 sm:grid-cols-2"><JoinCard body={copy.businessBody} cta={copy.businessCta} href="/signup/business" icon="business" title={copy.businessTitle} /><JoinCard body={copy.partnerBody} cta={copy.partnerCta} href="/earn" icon="partner" title={copy.partnerTitle} /></div></section>
    </main>
  );
}

function SectionHeading({ action, href, title }: { action: string; href: string; title: string }) {
  return <div className="mb-6 flex items-end justify-between gap-4 sm:mb-7"><h2 className="font-serif text-3xl tracking-[-0.02em] text-[var(--foreground)] sm:text-4xl">{title}</h2><HardNavigationLink href={href} className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-[var(--primary)] sm:inline-flex">{action}<IconArrowRight size={15} /></HardNavigationLink></div>;
}

function JoinCard({ body, cta, href, icon, title }: { body: string; cta: string; href: string; icon: "business" | "partner"; title: string }) {
  const isBusiness = icon === "business";
  const Icon = isBusiness ? IconBuildingStore : IconUsersGroup;
  return <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[0_6px_18px_rgba(40,51,48,0.05)] sm:p-6"><div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isBusiness ? "bg-[rgba(42,98,87,0.1)] text-[var(--primary)]" : "bg-[rgba(191,91,42,0.12)] text-[var(--accent)]"}`}><Icon size={21} /></div><h3 className="mt-4 font-serif text-2xl text-[var(--foreground)]">{title}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p><HardNavigationLink href={href} className={`${isBusiness ? "btn-primary" : "btn-secondary"} mt-5`}>{cta}</HardNavigationLink></article>;
}

function getHomepageBusinessDescription(description: string) {
  return /(?:imported from|openstreetmap|listing imported)/i.test(description)
    ? ""
    : description;
}

function getCopy(locale: "en" | "it") {
  return locale === "it" ? {
    allLocalities: "Tutte le località", allTowns: "Tutti i comuni", businessCta: "Inserisci la tua attività", businessBody: "Hai un'attività locale? Crea un account e rendila più facile da trovare per chi vive qui e chi visita il Salento.", businessTitle: "Aggiungi la tua attività", discover: "Scopri", exploreMore: "Esplora di più", heroBody: "Ristoranti, spiagge, servizi, attrazioni e luoghi quotidiani. Tutto ciò di cui hai bisogno, in vacanza o a casa.", heroTitle: "Trova qualsiasi cosa", heroTitleAccent: "nel Salento", joinSubtitle: "Unisciti a Salento Local e fai parte di una comunità in crescita.", joinTitle: "Fai parte del Salento?", partnerCta: "Guadagna con noi", partnerBody: "Aiuta le attività locali a entrare in Salento Local e guadagna una commissione per ogni scheda idonea completata.", partnerTitle: "Diventa Partner locale", placesTitle: "Luoghi da scoprire", searchButton: "Cerca", searchPlaceholder: "Cerca ristoranti, farmacie, spiagge...", townPlaces: "luoghi da scoprire", townsTitle: "I comuni del Salento", viewAllLocalities: "Vedi tutte le località", viewAllTowns: "Vedi tutti i comuni", viewPlace: "Vedi luogo", localityTitle: "Località e marine",
  } : {
    allLocalities: "All localities", allTowns: "All towns", businessCta: "List your business", businessBody: "Own a local business? Create an account and make it easier for residents and visitors to find you.", businessTitle: "Add your business", discover: "Discover", exploreMore: "Explore more", heroBody: "Restaurants, beaches, services, attractions, and everyday places. Everything you need, whether you are visiting or living here.", heroTitle: "Find anything", heroTitleAccent: "in Salento", joinSubtitle: "Join Salento Local and be part of a growing community.", joinTitle: "Are you part of Salento?", partnerCta: "Earn with us", partnerBody: "Help local businesses join Salento Local and earn commission for every eligible successful listing.", partnerTitle: "Become a Local Partner", placesTitle: "Places worth discovering", searchButton: "Search", searchPlaceholder: "Search restaurants, pharmacies, beaches...", townPlaces: "places to discover", townsTitle: "The towns of Salento", viewAllLocalities: "View all localities", viewAllTowns: "View all towns", viewPlace: "View place", localityTitle: "Localities & seaside places",
  };
}
