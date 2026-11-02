import Link from "next/link";
import type { Metadata } from "next";
import { IconArrowRight, IconBread, IconBuilding, IconCar, IconCoffee, IconCompass, IconMapPin, IconMedicalCross, IconShoppingBag, IconSparkles, IconTool, IconToolsKitchen2, IconUmbrella, IconWallet } from "@tabler/icons-react";

import { HardNavigationLink } from "@/components/hard-navigation-link";
import { SearchAutocomplete } from "@/components/search-autocomplete";
import { getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { getCurrentLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import { getDirectoryCatalog, getHomePageData } from "@/lib/public-data";
import { buildLocalityImage, buildTownImage, getCategoryLabel, homeCategorySlugs } from "@/lib/site";
import { publicUrl } from "@/lib/seo";

export const metadata: Metadata = { alternates: { canonical: publicUrl("/") } };

const categoryAccent: Record<string, "coral" | "blue"> = {
  restaurants: "coral", cafes: "blue", beaches: "coral", hotels: "blue", grocery: "coral",
  mechanics: "blue", pharmacies: "coral", plumbers: "blue", bakeries: "coral", "things-to-do": "blue",
};
const categoryVisualIcons = {
  restaurants: IconToolsKitchen2, cafes: IconCoffee, beaches: IconUmbrella, hotels: IconBuilding,
  grocery: IconShoppingBag, mechanics: IconCar, pharmacies: IconMedicalCross, plumbers: IconTool,
  bakeries: IconBread, "things-to-do": IconSparkles,
};
const preferredTownSlugs = ["otranto", "lecce", "porto-cesareo", "gallipoli"];
const preferredLocalitySlugs = ["santa-maria-di-leuca", "porto-badisco", "torre-lapillo", "santa-cesarea-terme", "punta-prosciutto"];
const categoryNames: Record<string, { en: string; it: string }> = {
  restaurants: { en: "Restaurants", it: "Ristoranti" }, cafes: { en: "Bars & Cafés", it: "Bar e caffè" },
  beaches: { en: "Beaches", it: "Spiagge" }, hotels: { en: "Hotels", it: "Hotel" },
  grocery: { en: "Groceries", it: "Alimentari" }, mechanics: { en: "Mechanics", it: "Meccanici" },
  pharmacies: { en: "Pharmacies", it: "Farmacie" }, plumbers: { en: "Plumbers", it: "Idraulici" },
  bakeries: { en: "Bakeries", it: "Panifici" }, "things-to-do": { en: "Things to Do", it: "Cose da fare" },
};

export default async function HomePage() {
  const [locale, home, catalog, selectedTowns, selectedLocalities] = await Promise.all([
    getCurrentLocale(), getHomePageData(), getDirectoryCatalog(),
    prisma.town.findMany({ where: { slug: { in: preferredTownSlugs } }, select: { id: true, slug: true, name: true, province: true, imageUrl: true, heroImageSeed: true } }),
    prisma.locality.findMany({ where: { slug: { in: preferredLocalitySlugs }, businesses: { some: getPublicBusinessMembershipWhere() } }, select: { id: true, slug: true, name: true, imageUrl: true, heroImageSeed: true, town: { select: { name: true, slug: true, imageUrl: true, heroImageSeed: true } } } }),
  ]);
  const { categories, featuredLocalities, featuredTowns } = home;
  const copy = getCopy(locale);
  const towns = [...new Map([...selectedTowns, ...featuredTowns].map((town) => [town.slug, town])).values()].sort((a, b) => {
    const ai = preferredTownSlugs.indexOf(a.slug), bi = preferredTownSlugs.indexOf(b.slug);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  }).slice(0, 4);
  const localities = [...new Map([...selectedLocalities, ...featuredLocalities].map((locality) => [locality.slug, locality])).values()].sort((a, b) => {
    const ai = preferredLocalitySlugs.indexOf(a.slug), bi = preferredLocalitySlugs.indexOf(b.slug);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  }).slice(0, 5);
  const townById = new Map(catalog.towns.map((town) => [town.id, town.name]));
  const locations = [
    ...catalog.towns.map((town) => ({ kind: "town" as const, label: town.name, slug: town.slug })),
    ...catalog.localities.map((locality) => ({ kind: "locality" as const, label: `${locality.name}, ${townById.get(locality.townId) ?? "Salento"}`, slug: locality.slug })),
  ];
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const businessHref = "/signup/business";

  return <div className="homepage">
    <section className="home-hero">
      <div className="home-hero-shade" />
      <div className="home-hero-inner">
        <div className="home-hero-copy">
          <p className="home-eyebrow home-eyebrow-light"><IconCompass size={20} />{copy.heroKicker}</p>
          <h1>{copy.heroTitle}<em>{copy.heroAccent}</em></h1>
          <p className="home-hero-description">{copy.heroBody}</p>
          <SearchAutocomplete buttonLabel={copy.search} locale={locale} locations={locations} locationPlaceholder={copy.nearPlaceholder} placeholder={copy.searchPlaceholder} searchPath="/directory" variant="home" />
          <div className="home-popular"><span>{copy.popular}</span>
            {["restaurants", "beaches", "pharmacies"].map((slug) => <Link key={slug} href={`/directory?category=${slug}`}>{getCategoryLabel(slug, slug, locale)}</Link>)}
          </div>
        </div>
        <aside className="home-partner-card">
          <p className="home-partner-kicker"><span><IconWallet size={24} /></span>{copy.partnerKicker}</p>
          <h2>{copy.partnerTitle}</h2>
          <p>{copy.partnerBody}</p>
          <div className="home-commission"><strong>{copy.commissionPrimary}</strong><span>{copy.commissionSecondary}</span><small>{copy.commissionTerms}</small></div>
          <HardNavigationLink href="/earn">{copy.partnerCta}<IconArrowRight size={20} /></HardNavigationLink>
        </aside>
      </div>
    </section>

    <section className="home-pathways home-container" id="discover">
      <header className="home-heading home-heading-center"><p className="home-eyebrow">{copy.pathsKicker}</p><h2>{copy.pathsTitle}</h2><p>{copy.pathsBody}</p></header>
      <div className="home-path-grid">
        <article className="home-path-card"><span className="home-path-icon"><IconCompass size={27} /></span><small>01</small><h3>{copy.pathExplore}</h3><p>{copy.pathExploreBody}</p><HardNavigationLink href="/explore">{copy.exploreCta}<IconArrowRight size={19} /></HardNavigationLink></article>
        <article className="home-path-card home-path-card-partner"><span className="home-path-icon"><IconWallet size={27} /></span><small>02</small><h3>{copy.pathPartner}</h3><p>{copy.pathPartnerBody}</p><HardNavigationLink href="/earn">{copy.learnCta}<IconArrowRight size={19} /></HardNavigationLink></article>
        <article className="home-path-card"><span className="home-path-icon home-path-icon-business"><IconBuilding size={27} /></span><small>03</small><h3>{copy.pathBusiness}</h3><p>{copy.pathBusinessBody}</p><HardNavigationLink href={businessHref}>{copy.listCta}<IconArrowRight size={19} /></HardNavigationLink></article>
      </div>
    </section>

    <section className="home-category-wave" id="categories"><div className="home-container home-category-inner">
      <header className="home-heading"><p className="home-eyebrow">{copy.categoryKicker}</p><h2>{copy.categoryTitle}</h2><p>{copy.categoryBody}</p></header>
      <div className="home-category-layout">
        <div className="home-category-grid">
          {homeCategorySlugs.map((slug) => {
            const category = categoryBySlug.get(slug);
            const label = categoryNames[slug]?.[locale] ?? getCategoryLabel(slug, category?.name ?? slug, locale);
            const Icon = categoryVisualIcons[slug];
            return <Link key={slug} className="home-category-card" href={`/directory?category=${slug}`} aria-label={label}>
              <span className={`home-category-icon home-category-icon-${categoryAccent[slug]}`}><Icon size={31} stroke={1.8} /></span>
              <strong>{label}</strong>
            </Link>;
          })}
        </div>
        <aside className="home-category-promo">
          <span className="home-promo-pin"><IconMapPin size={27} /></span>
          <h3>{copy.promoTitle}</h3><p>{copy.promoBody}</p>
          <HardNavigationLink href="/directory">{copy.allCategories}<IconArrowRight size={19} /></HardNavigationLink>
        </aside>
      </div>
    </div></section>

    <section className="home-places home-container" id="places">
      <header className="home-heading home-heading-split"><div><p className="home-eyebrow">{copy.placesKicker}</p><h2>{copy.placesTitle}</h2><p>{copy.placesBody}</p></div><HardNavigationLink href="/towns">{copy.allPlaces}<IconArrowRight size={20} /></HardNavigationLink></header>
      <div className="home-places-grid">{towns.map((town, index) => <Link className={`home-place-card ${index === 0 ? "home-place-large" : index === 3 ? "home-place-wide" : ""}`} key={town.id} href={`/towns/${town.slug}`}>
        <img src={buildTownImage(town, 1100)} alt={town.name} loading="lazy" /><span className="home-image-shade" /><span className="home-image-copy"><small>{getTownCaption(town.slug, locale, town.province ?? copy.townLabel)}</small><strong>{town.name}</strong><i>{copy.discover}<IconArrowRight size={17} /></i></span>
      </Link>)}</div>
    </section>

    <section className="home-localities" id="localities"><div className="home-container">
      <header className="home-heading home-heading-split"><div><p className="home-eyebrow">{copy.localitiesKicker}</p><h2>{copy.localitiesTitle}</h2><p>{copy.localitiesBody}</p></div><HardNavigationLink href="/localities">{copy.allLocalities}<IconArrowRight size={20} /></HardNavigationLink></header>
      <div className="home-locality-grid">{localities.map((locality, index) => <Link className={`home-locality-card ${index === 0 ? "home-locality-large" : ""}`} key={locality.id} href={`/localities/${locality.slug}`}>
        <img src={buildLocalityImage(locality, 1000)} alt={locality.name} loading="lazy" /><span className="home-image-shade" /><span className="home-image-copy"><small>{getLocalityCaption(locality.slug, locale, locality.town.name)}</small><strong>{locality.name}</strong><i>{copy.discover}<IconArrowRight size={17} /></i></span>
      </Link>)}</div>
    </div></section>

    <section className="home-business home-container" id="business">
      <div className="home-business-visual"><img src="/homepage/business.jpg" alt={copy.businessImageAlt} loading="lazy" /><div className="home-listing-card"><span><IconBuilding size={28} /></span><div><small>{copy.listingSmall}</small><strong>{copy.listingTitle}</strong></div><IconSparkles size={22} /></div></div>
      <div className="home-business-copy"><p className="home-eyebrow">{copy.businessKicker}</p><h2>{copy.businessTitle}</h2><p>{copy.businessBody}</p><ul>{copy.benefits.map((benefit) => <li key={benefit}><span>✓</span>{benefit}</li>)}</ul><HardNavigationLink href={businessHref}>{copy.businessCta}<IconArrowRight size={20} /></HardNavigationLink></div>
    </section>

    <footer className="home-footer"><div className="home-container home-footer-main"><div><HardNavigationLink className="home-footer-brand" href="/"><span><IconMapPin size={23} /></span>Salento<i>Local</i></HardNavigationLink><p>{copy.footerLine}</p></div><nav aria-label={copy.footerNav}><div><strong>{copy.footerExplore}</strong><HardNavigationLink href="/directory">Directory</HardNavigationLink><HardNavigationLink href="/towns">{copy.footerTowns}</HardNavigationLink><HardNavigationLink href="/localities">{copy.footerCoast}</HardNavigationLink></div><div><strong>{copy.footerJoin}</strong><HardNavigationLink href="/earn">{copy.footerPartners}</HardNavigationLink><HardNavigationLink href={businessHref}>{copy.footerBusiness}</HardNavigationLink><HardNavigationLink href="/login">{copy.login}</HardNavigationLink></div><div><strong>{copy.footerAbout}</strong><HardNavigationLink href="/explore">{copy.footerHow}</HardNavigationLink><HardNavigationLink href="/privacy">{copy.privacy}</HardNavigationLink><HardNavigationLink href="/terms">{copy.terms}</HardNavigationLink><HardNavigationLink href="/cookies">{copy.cookies}</HardNavigationLink></div></nav></div><div className="home-container home-footer-bottom"><span>© {new Date().getFullYear()} Salento Local</span><span>Salento, Puglia · Italia</span></div></footer>
  </div>;
}

function getTownCaption(slug: string, locale: "en" | "it", fallback: string) {
  const captions: Record<string, { en: string; it: string }> = {
    otranto: { en: "Adriatic coast", it: "Costa adriatica" }, lecce: { en: "Baroque city", it: "Città barocca" },
    "porto-cesareo": { en: "Ionian coast", it: "Costa ionica" }, gallipoli: { en: "Old town & sea", it: "Borgo antico e mare" },
  };
  return captions[slug]?.[locale] ?? fallback;
}

function getLocalityCaption(slug: string, locale: "en" | "it", fallback: string) {
  const captions: Record<string, { en: string; it: string }> = {
    "santa-maria-di-leuca": { en: "Finibus Terrae", it: "Finibus Terrae" },
    "porto-badisco": { en: "Adriatic coast", it: "Costa adriatica" },
    "torre-lapillo": { en: "Ionian coast", it: "Costa ionica" },
    "santa-cesarea-terme": { en: "Adriatic coast", it: "Costa adriatica" },
    "punta-prosciutto": { en: "Porto Cesareo", it: "Porto Cesareo" },
  };
  return captions[slug]?.[locale] ?? fallback;
}

function getCopy(locale: "en" | "it") {
  return locale === "it" ? {
    heroKicker: "La guida locale del Salento", heroTitle: "Tutto il Salento,", heroAccent: "più vicino a te.", heroBody: "Trova i luoghi che rendono migliore ogni giornata e ogni vacanza — dalle spiagge nascoste ai servizi di fiducia.", search: "Cerca", searchPlaceholder: "Cosa stai cercando?", nearPlaceholder: "Comune o località", popular: "Popolari:",
    partnerKicker: "Diventa Partner Locale", partnerTitle: "Conosci il territorio? Fallo contare.", partnerBody: "Aiuta le attività locali a entrare in Salento Local e guadagna per ogni iscrizione pagata idonea.", commissionPrimary: "Guadagna €50 per ogni nuovo abbonamento pagato idoneo", commissionSecondary: "Più €15 sui rinnovi annuali o sulle riattivazioni idonee.", commissionTerms: "La commissione matura solo dopo un pagamento idoneo andato a buon fine.", partnerCta: "Scopri come funziona",
    pathsKicker: "Per chiunque viva il Salento", pathsTitle: "Un solo luogo. Tre modi di viverlo.", pathsBody: "Per scoprire, guadagnare o far crescere la tua attività — inizia qui.", pathExplore: "Esplora il Salento", pathExploreBody: "Cerca attività, servizi essenziali, spiagge, borghi e luoghi del cuore.", pathPartner: "Guadagna come Partner", pathPartnerBody: "Un lavoro flessibile e locale che aiuta le attività a farsi conoscere.", pathBusiness: "Fai crescere la tua attività", pathBusinessBody: "Inserisci o rivendica la scheda e raggiungi turisti e residenti a €100/anno.", exploreCta: "Inizia a esplorare", learnCta: "Scopri di più", listCta: "Inserisci la tua attività",
    categoryKicker: "Trova ciò che ti serve", categoryTitle: "Lo trovi in Salento", categoryBody: "Ristoranti, spiagge, servizi e molto altro — tutto in un solo posto.", promoTitle: "Esplora tutte le categorie", promoBody: "Sfoglia la directory completa dei luoghi del Salento.", allCategories: "Tutte le categorie",
    placesKicker: "Dalla costa alla campagna", placesTitle: "Dove ti porterà il Salento?", placesBody: "Scopri città barocche, località sul mare e tutto ciò che c’è nel mezzo.", allPlaces: "Esplora tutti i luoghi", townLabel: "Salento", discover: "Scopri",
    localitiesKicker: "La vita vicino al mare", localitiesTitle: "Località e luoghi sul mare", localitiesBody: "Piccole baie, borghi costieri e luoghi estivi amati in tutto il Salento.", allLocalities: "Vedi tutte le località",
    businessKicker: "Pensato per le attività indipendenti", businessTitle: "Fatti trovare da chi ti sta già cercando.", businessBody: "Presenta la tua attività a turisti e residenti in cerca nel Salento. Aggiorna i dati, racconta chi sei e, se vuoi, fatti aiutare da un Partner Locale.", benefits: ["Raggiungi turisti e residenti", "Gestisci facilmente la scheda", "Abbonamento annuale: €100"], businessCta: "Inserisci o rivendica la tua attività", businessImageAlt: "Architettura tradizionale pugliese", listingSmall: "La tua attività locale", listingTitle: "Pronta per farsi scoprire",
    footerLine: "Scopri di più. Sostieni il territorio. Vivi il Salento.", footerNav: "Navigazione a piè di pagina", footerExplore: "Esplora", footerTowns: "Comuni", footerCoast: "Costa e località", footerJoin: "Partecipa", footerPartners: "Partner locali", footerBusiness: "Per le attività", footerAbout: "Informazioni", footerHow: "Esplora Salento Local", login: "Accedi", privacy: "Privacy", terms: "Termini", cookies: "Cookie",
  } : {
    heroKicker: "The local guide to southern Puglia", heroTitle: "All of Salento,", heroAccent: "closer to you.", heroBody: "Find the places that make everyday life and every holiday better — from hidden beaches to trusted local services.", search: "Search", searchPlaceholder: "What are you looking for?", nearPlaceholder: "Town or locality", popular: "Popular:",
    partnerKicker: "Become a Local Partner", partnerTitle: "Know your area? Make it count.", partnerBody: "Help local businesses join Salento Local and earn for every eligible paid membership.", commissionPrimary: "Earn €50 for each eligible new paid membership", commissionSecondary: "Plus €15 on eligible annual renewals or reactivations.", commissionTerms: "Commission is earned only after a successful qualifying payment.", partnerCta: "See how it works",
    pathsKicker: "Made for everyone in Salento", pathsTitle: "One place. Three ways to be local.", pathsBody: "Whether you are exploring, earning, or growing a business — start here.", pathExplore: "Explore Salento", pathExploreBody: "Search businesses, essential services, beaches, towns, and local favourites.", pathPartner: "Earn as a Partner", pathPartnerBody: "Flexible, local work that helps independent businesses get discovered.", pathBusiness: "Grow your business", pathBusinessBody: "Add or claim your listing and reach tourists and residents for €100/year.", exploreCta: "Start exploring", learnCta: "Learn more", listCta: "List your business",
    categoryKicker: "Find what you need", categoryTitle: "Find it in Salento", categoryBody: "Restaurants, beaches, services, and more — all in one place.", promoTitle: "Explore all categories", promoBody: "Browse the complete directory of places across Salento.", allCategories: "View all categories",
    placesKicker: "From coast to countryside", placesTitle: "Where will Salento take you?", placesBody: "Explore baroque towns, seaside localities, and the places in between.", allPlaces: "Explore all places", townLabel: "Salento", discover: "Discover",
    localitiesKicker: "Life by the water", localitiesTitle: "Localities & Seaside Places", localitiesBody: "Small coves, coastal villages, and beloved summer places across Salento.", allLocalities: "View all localities",
    businessKicker: "Built for independent businesses", businessTitle: "Be found by the people already looking.", businessBody: "Put your business in front of tourists and residents searching across Salento. Keep your details current, tell your story, and get support from a Local Partner if you need it.", benefits: ["Reach tourists and residents", "Manage your listing easily", "Annual membership: €100"], businessCta: "Add or claim your business", businessImageAlt: "Traditional architecture in Puglia", listingSmall: "Your local business", listingTitle: "Ready to be discovered",
    footerLine: "Discover more. Support local. Belong in Salento.", footerNav: "Footer navigation", footerExplore: "Explore", footerTowns: "Towns", footerCoast: "Coast & localities", footerJoin: "Join", footerPartners: "Local Partners", footerBusiness: "For businesses", footerAbout: "About", footerHow: "Explore Salento Local", login: "Log in", privacy: "Privacy", terms: "Terms", cookies: "Cookies",
  };
}
