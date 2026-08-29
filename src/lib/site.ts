import type {
  Business,
  Category,
  CategoryGroup,
  LocalityKind,
  Locality,
  Town,
  VerificationStatus,
} from "@prisma/client";
import {
  IconBeach,
  IconBed,
  IconBriefcase,
  IconBread,
  IconCoffee,
  IconDroplet,
  IconMap2,
  IconMedicalCross,
  IconShoppingBag,
  IconSparkles,
  IconTool,
  IconToolsKitchen2,
  type Icon,
} from "@tabler/icons-react";

import {
  decorativeTownImagePattern,
  normalizeWikimediaImage,
  townImageOverrides,
} from "@/lib/image-overrides";
import type { Locale } from "@/lib/i18n";

export const navigation = [
  { href: "/", label: "Home" },
  { href: "/towns", label: "Towns" },
  { href: "/explore", label: "Explore" },
] as const;

export const homeCategorySlugs = [
  "restaurants",
  "cafes",
  "beaches",
  "hotels",
  "grocery",
  "mechanics",
  "pharmacies",
  "plumbers",
  "bakeries",
  "things-to-do",
] as const;

export const townTabs = [
  { slug: "overview", label: "Overview" },
  { slug: "food-drink", label: "Food & Drink" },
  { slug: "services", label: "Services" },
  { slug: "shopping", label: "Shopping" },
  { slug: "tourism", label: "Tourism" },
  { slug: "reviews", label: "Reviews" },
] as const;

export const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const categoryIcons: Record<string, Icon> = {
  restaurants: IconToolsKitchen2,
  cafes: IconCoffee,
  beaches: IconBeach,
  hotels: IconBed,
  "local-services": IconBriefcase,
  grocery: IconShoppingBag,
  mechanics: IconTool,
  pharmacies: IconMedicalCross,
  plumbers: IconDroplet,
  bakeries: IconBread,
  "things-to-do": IconSparkles,
  shops: IconShoppingBag,
  services: IconBriefcase,
};

export const fallbackCategoryIcon = IconMap2;

export const categoryLabels: Record<string, Record<Locale, string>> = {
  restaurants: {
    it: "Ristoranti",
    en: "Restaurants",
  },
  cafes: {
    it: "Bar & Caffe",
    en: "Bars & Cafes",
  },
  beaches: {
    it: "Spiagge",
    en: "Beaches",
  },
  hotels: {
    it: "Hotel & B&B",
    en: "Hotels & B&Bs",
  },
  "local-services": {
    it: "Servizi",
    en: "Services",
  },
  grocery: {
    it: "Supermercati",
    en: "Groceries",
  },
  mechanics: {
    it: "Meccanici",
    en: "Mechanics",
  },
  pharmacies: {
    it: "Farmacie",
    en: "Pharmacies",
  },
  plumbers: {
    it: "Idraulici",
    en: "Plumbers",
  },
  bakeries: {
    it: "Panifici",
    en: "Bakeries",
  },
  "things-to-do": {
    it: "Cose da fare",
    en: "Things to do",
  },
  shops: {
    it: "Negozi",
    en: "Shops",
  },
  services: {
    it: "Servizi",
    en: "Services",
  },
};

export const categoryHelperText: Record<string, Record<Locale, string>> = {
  restaurants: {
    it: "Trattorie, cucine locali e posti dove fermarsi a pranzo o cena.",
    en: "Trattorias, local dining rooms, and places to stop for lunch or dinner.",
  },
  cafes: {
    it: "Bar, caffe, colazioni, aperitivi e pause veloci durante la giornata.",
    en: "Coffee bars, breakfasts, aperitivo stops, and easy daytime breaks.",
  },
  bakeries: {
    it: "Pane fresco, rustici, dolci e indirizzi utili per la mattina.",
    en: "Fresh bread, pastries, savory bites, and useful morning stops.",
  },
  beaches: {
    it: "Lidi, spiagge libere e luoghi vista mare per vivere la costa.",
    en: "Beach clubs, public beaches, and sea-view places along the coast.",
  },
  hotels: {
    it: "Hotel, B&B e soggiorni comodi per mare, borghi e gite nel territorio.",
    en: "Hotels, B&Bs, and comfortable stays for coasts, towns, and day trips.",
  },
  "local-services": {
    it: "Spesa, botteghe, artigiani, riparazioni e servizi pratici utili ogni giorno.",
    en: "Groceries, practical shops, trades, repairs, and everyday local services.",
  },
  grocery: {
    it: "Spesa quotidiana, minimarket e negozi utili per ogni giorno.",
    en: "Groceries, minimarkets, and practical food stops for everyday needs.",
  },
  shops: {
    it: "Shopping locale, boutique e negozi pratici da esplorare a piedi.",
    en: "Local shopping, boutiques, and useful stores to browse on foot.",
  },
  mechanics: {
    it: "Officine, riparazioni e supporto per auto, scooter e piccoli imprevisti.",
    en: "Garages, repairs, and support for cars, scooters, and travel hiccups.",
  },
  pharmacies: {
    it: "Farmacie e servizi essenziali per salute, benessere e urgenze leggere.",
    en: "Pharmacies and essential health support for daily needs and light urgencies.",
  },
  plumbers: {
    it: "Aiuto tecnico per case, appartamenti, strutture ricettive e immobili.",
    en: "Technical plumbing help for homes, rentals, hospitality, and property needs.",
  },
  services: {
    it: "Servizi locali utili, pratiche quotidiane e supporti che fanno comodo.",
    en: "Useful local services and practical support for everyday life.",
  },
  "things-to-do": {
    it: "Attrazioni, esperienze, escursioni e idee per riempire la giornata.",
    en: "Attractions, experiences, excursions, and ideas to fill the day.",
  },
};

export const categoryGroupLabels: Record<CategoryGroup, Record<Locale, string>> = {
  FOOD: {
    it: "Cibo e bevande",
    en: "Food & drink",
  },
  SERVICE: {
    it: "Servizi",
    en: "Services",
  },
  SHOPPING: {
    it: "Shopping",
    en: "Shopping",
  },
  TOURISM: {
    it: "Cose da fare",
    en: "Things to do",
  },
  STAY: {
    it: "Dove dormire",
    en: "Stay",
  },
  BEACH: {
    it: "Spiagge e natura",
    en: "Beaches & nature",
  },
  ESSENTIAL: {
    it: "Essenziali",
    en: "Essentials",
  },
};

export const localityKindLabels: Record<LocalityKind, Record<Locale, string>> = {
  LOCALITY: {
    it: "Localita",
    en: "Locality",
  },
  MARINA: {
    it: "Marina",
    en: "Seaside area",
  },
  FRAZIONE: {
    it: "Frazione",
    en: "Locality",
  },
  HAMLET: {
    it: "Borgo",
    en: "Locality",
  },
  VILLAGE: {
    it: "Villaggio",
    en: "Village",
  },
  SUBURB: {
    it: "Zona",
    en: "Suburb",
  },
  QUARTER: {
    it: "Quartiere",
    en: "Quarter",
  },
  NEIGHBOURHOOD: {
    it: "Quartiere",
    en: "Neighborhood",
  },
};

export function getCategoryIcon(slug: string) {
  return categoryIcons[slug] ?? fallbackCategoryIcon;
}

export function getCategoryLabel(
  slug: string,
  fallbackName: string,
  locale: Locale = "it",
) {
  return categoryLabels[slug]?.[locale] ?? fallbackName;
}

export function getCategoryHelperText(slug: string, locale: Locale = "it") {
  return categoryHelperText[slug]?.[locale] ?? "";
}

export function getCategoryGroupLabel(group: CategoryGroup, locale: Locale = "it") {
  return categoryGroupLabels[group]?.[locale] ?? formatGroupLabel(group);
}

export function getLocalityKindLabel(kind: LocalityKind, locale: Locale = "it") {
  return localityKindLabels[kind]?.[locale] ?? kind.toLowerCase();
}

export function getSingleParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function getMultiParam(value?: string | string[]) {
  const values = Array.isArray(value) ? value : [value ?? ""];

  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatPriceLevel(level?: number | null, locale: Locale = "it") {
  if (!level) {
    return locale === "it" ? "Prezzo da verificare" : "Price to confirm";
  }

  return `${"EUR ".repeat(level).trim()}`;
}

export function formatGroupLabel(group: CategoryGroup) {
  return group
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildPlaceholderImage(
  seed: string,
  label: string,
  type: "beach" | "business" | "town" = "business",
) {
  const params = new URLSearchParams({
    seed,
    label,
    type,
  });

  return `/api/placeholder?${params.toString()}`;
}

type PlaceholderType = "beach" | "business" | "town";

type ProxyFallbackOptions = {
  label: string;
  seed: string;
  type?: PlaceholderType;
};

export function proxyImageUrl(
  url: string,
  width = 1600,
  fallback?: ProxyFallbackOptions,
) {
  if (url.startsWith("/")) {
    return url;
  }

  const params = new URLSearchParams({
    url,
    w: String(width),
  });

  if (fallback) {
    params.set("seed", fallback.seed);
    params.set("label", fallback.label);
    params.set("type", fallback.type ?? "business");
  }

  return `/api/image?${params.toString()}`;
}

export function buildTownImage(
  town: Pick<Town, "heroImageSeed" | "imageUrl" | "name" | "slug">,
  width = 1600,
) {
  const override = townImageOverrides[town.slug];

  if (override) {
    return normalizeWikimediaImage(override, width);
  }

  if (
    town.imageUrl &&
    !decorativeTownImagePattern.test(town.imageUrl)
  ) {
    return town.imageUrl;
  }

  return buildPlaceholderImage(town.heroImageSeed, town.name, "town");
}

export function buildLocalityImage(
  locality: Pick<Locality, "heroImageSeed" | "imageUrl" | "name"> & {
    town?: Pick<Town, "heroImageSeed" | "imageUrl" | "name" | "slug"> | null;
  },
  width = 1600,
) {
  return (
    (locality.imageUrl
      ? locality.imageUrl
      : null) ??
    (locality.town ? buildTownImage(locality.town, width) : null) ??
    buildPlaceholderImage(locality.heroImageSeed, locality.name, "town")
  );
}

export function buildBusinessImage(
  business: Pick<Business, "heroImageSeed" | "name"> & {
    locality?: Pick<Locality, "heroImageSeed" | "imageUrl" | "name"> | null;
    town?: Pick<Town, "heroImageSeed" | "imageUrl" | "name" | "slug"> | null;
  },
  categorySlug?: string,
  width = 1600,
) {
  return (
    (business.locality ? buildLocalityImage(business.locality, width) : null) ??
    (business.town ? buildTownImage(business.town, width) : null) ??
    buildPlaceholderImage(
      business.heroImageSeed,
      business.name,
      categorySlug === "beaches" ? "beach" : "business",
    )
  );
}

export function buildBusinessPhoto(
  url?: string | null,
  width = 1600,
  fallback?: ProxyFallbackOptions,
) {
  if (!url) {
    return null;
  }

  return proxyImageUrl(normalizeWikimediaImage(url), width, fallback);
}

export function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

type VerificationTone = "info" | "muted" | "success" | "warning";

export function getVerificationMeta(
  status: VerificationStatus,
  sourceConfidence: number,
  isLikelyClosed = false,
  locale: Locale = "en",
) {
  if (isLikelyClosed || status === "REPORTED_STALE") {
    return {
      label: locale === "it" ? "Da confermare" : "Needs confirmation",
      summary:
        locale === "it"
          ? "Un utente o una fonte indica che questa scheda potrebbe essere chiusa o non aggiornata."
          : "A user or source signal suggests this listing may be closed or outdated.",
      tone: "warning" as VerificationTone,
      confidenceLabel:
        locale === "it"
          ? `Copertura ${sourceConfidence}/99`
          : `Coverage ${sourceConfidence}/99`,
    };
  }

  if (status === "OWNER_VERIFIED") {
    return {
      label: locale === "it" ? "Verificata dal titolare" : "Owner verified",
      summary:
        locale === "it"
          ? "La scheda e stata confermata direttamente dal proprietario dell'attivita."
          : "The listing has been confirmed directly by the business owner.",
      tone: "success" as VerificationTone,
      confidenceLabel:
        locale === "it"
          ? `Copertura ${sourceConfidence}/99`
          : `Coverage ${sourceConfidence}/99`,
    };
  }

  if (status === "COMMUNITY_VERIFIED") {
    return {
      label: locale === "it" ? "Verificata dalla comunita" : "Community verified",
      summary:
        locale === "it"
          ? "I dettagli della scheda sono stati confermati da segnalazioni della comunita."
          : "The listing details have been confirmed by local user input.",
      tone: "success" as VerificationTone,
      confidenceLabel:
        locale === "it"
          ? `Copertura ${sourceConfidence}/99`
          : `Coverage ${sourceConfidence}/99`,
    };
  }

  if (status === "OPEN_DATA") {
    return {
      label: locale === "it" ? "Scheda open data" : "Open data listing",
      summary:
        locale === "it"
          ? "Importata da dati cartografici aperti e valutata per completezza."
          : "Imported from structured open-source map data and scored for completeness.",
      tone: "info" as VerificationTone,
      confidenceLabel:
        locale === "it"
          ? `Copertura ${sourceConfidence}/99`
          : `Coverage ${sourceConfidence}/99`,
    };
  }

  return {
    label: locale === "it" ? "Non verificata" : "Unverified",
    summary:
      locale === "it"
        ? "La scheda di base e presente, ma alcuni dettagli sono ancora incompleti o poco verificati."
        : "Basic listing present, but some business details are still missing or lightly sourced.",
    tone: "muted" as VerificationTone,
    confidenceLabel:
      locale === "it"
        ? `Copertura ${sourceConfidence}/99`
        : `Coverage ${sourceConfidence}/99`,
  };
}

export function getVerificationPillClass(tone: VerificationTone) {
  switch (tone) {
    case "success":
      return "pill-success";
    case "warning":
      return "pill-warning";
    case "info":
      return "pill";
    default:
      return "pill-muted";
  }
}

export function formatVerificationDate(value?: Date | null, locale: Locale = "en") {
  if (!value) {
    return locale === "it" ? "Data non disponibile" : "Import date unavailable";
  }

  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    dateStyle: "medium",
  }).format(value);
}

export type BusinessSignal =
  | "accessible"
  | "familyFriendly"
  | "featured"
  | "highlyRated"
  | "openNow"
  | "verified";

export function getBusinessSignalMeta(signal: BusinessSignal, locale: Locale = "it") {
  switch (signal) {
    case "featured":
      return {
        label: locale === "it" ? "In evidenza" : "Featured",
        tone: "accent" as const,
      };
    case "verified":
      return {
        label: locale === "it" ? "Verificata" : "Verified",
        tone: "success" as const,
      };
    case "openNow":
      return {
        label: locale === "it" ? "Aperto ora" : "Open now",
        tone: "success" as const,
      };
    case "highlyRated":
      return {
        label: locale === "it" ? "Molto apprezzata" : "Highly rated",
        tone: "primary" as const,
      };
    case "familyFriendly":
      return {
        label: locale === "it" ? "Per famiglie" : "Family friendly",
        tone: "muted" as const,
      };
    case "accessible":
      return {
        label: locale === "it" ? "Accessibile" : "Accessible",
        tone: "muted" as const,
      };
    default:
      return {
        label: signal,
        tone: "muted" as const,
      };
  }
}

export type BusinessCardItem = Pick<
  Business,
  | "address"
  | "id"
  | "name"
  | "priceLevel"
  | "rating"
  | "reviewCount"
  | "shortDescription"
  | "slug"
> & {
  isOpenNow?: boolean;
  locality?: Pick<Locality, "id" | "name" | "slug"> | null;
  town: Pick<Town, "id" | "name" | "slug">;
  category: Pick<Category, "group" | "id" | "name" | "slug">;
  images?: { alt: string; url: string }[];
  signals?: BusinessSignal[];
};
