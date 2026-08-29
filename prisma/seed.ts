import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CategoryGroup,
  LocalityKind,
  Prisma,
  PrismaClient,
  SourceReuseStatus,
  SourceType,
  VerificationStatus,
} from "@prisma/client";

import {
  featuredTownNames,
  salentoScope,
  townAliasNotes,
  townReplacements,
  type ScopeTown,
} from "./salento-scope";

const prisma = new PrismaClient();

const wikipediaUserAgent =
  "SalentoDirectoryPrototype/1.0 (local prototype import for structured municipality data)";

const overpassEndpoint = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
const cacheDir = path.join(process.cwd(), "work", "import-cache");
const featuredLocalityNames = new Set([
  "Porto Badisco",
  "Santa Maria di Leuca",
  "Torre dell'Orso",
  "San Foca",
  "Roca Vecchia",
  "Torre Sant'Andrea",
  "Frigole",
  "Santa Caterina",
  "Santa Maria al Bagno",
  "Torre Lapillo",
  "Torre San Giovanni",
  "Torre Mozza",
  "Lido Marini",
  "Campomarino",
  "Punta Prosciutto",
  "Specchiolla",
  "Villanova",
  "Rosa Marina",
  "Monticelli",
]);

const PRIMARY_ADMIN_USERNAME = "josh";

const categories = [
  {
    slug: "restaurants",
    name: "Restaurants",
    icon: "fork-knife",
    description: "Restaurants, trattorias, pizzerias, and dining-led places.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "cafes",
    name: "Cafes",
    icon: "coffee",
    description: "Cafes, bars, pastry counters, and casual coffee stops.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "beaches",
    name: "Beaches",
    icon: "beach",
    description: "Named beaches, seaside clubs, and coastal access points.",
    group: CategoryGroup.BEACH,
    featured: true,
  },
  {
    slug: "hotels",
    name: "Hotels",
    icon: "bed",
    description: "Hotels, guest houses, apartments, and hospitality listings.",
    group: CategoryGroup.STAY,
    featured: true,
  },
  {
    slug: "grocery",
    name: "Grocery",
    icon: "basket",
    description: "Markets, supermarkets, convenience stores, and food shopping.",
    group: CategoryGroup.SHOPPING,
    featured: true,
  },
  {
    slug: "mechanics",
    name: "Mechanics",
    icon: "tool",
    description: "Mechanics, car repair, and vehicle service businesses.",
    group: CategoryGroup.SERVICE,
    featured: true,
  },
  {
    slug: "pharmacies",
    name: "Pharmacies",
    icon: "medical-cross",
    description: "Pharmacies and health-oriented practical stops.",
    group: CategoryGroup.ESSENTIAL,
    featured: true,
  },
  {
    slug: "plumbers",
    name: "Plumbers",
    icon: "droplet",
    description: "Plumbers and technical home-service workshops.",
    group: CategoryGroup.SERVICE,
    featured: true,
  },
  {
    slug: "bakeries",
    name: "Bakeries",
    icon: "bread",
    description: "Bakeries, forno counters, and bread-focused shops.",
    group: CategoryGroup.FOOD,
    featured: true,
  },
  {
    slug: "things-to-do",
    name: "Things to do",
    icon: "sparkles",
    description: "Attractions, museums, leisure, marinas, and activity-oriented places.",
    group: CategoryGroup.TOURISM,
    featured: true,
  },
  {
    slug: "services",
    name: "Services",
    icon: "briefcase",
    description: "Everyday practical services, fuel, health, and useful local stops.",
    group: CategoryGroup.SERVICE,
    featured: false,
  },
  {
    slug: "shops",
    name: "Shops",
    icon: "shopping-bag",
    description: "General retail shops and useful commercial stops.",
    group: CategoryGroup.SHOPPING,
    featured: false,
  },
] as const;

type CategorySlug = (typeof categories)[number]["slug"];

type WikipediaSummary = {
  title: string;
  description?: string;
  extract?: string;
  thumbnail?: {
    source?: string;
  };
  coordinates?: {
    lat: number;
    lon: number;
  };
  wikibase_item?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

type WikidataTownDetails = {
  areaKm2?: number;
  elevationM?: number;
  officialWebsite?: string;
  population?: number;
};

type TownImport = {
  province: ScopeTown["province"];
  slug: string;
  name: string;
  sourceUrl?: string;
  wikipediaTitle?: string;
  wikidataId?: string;
  latitude: number;
  longitude: number;
  population?: number;
  areaKm2?: number;
  elevationM?: number;
  officialWebsite?: string;
  shortDescription: string;
  intro: string;
  history: string;
  practicalInfo: string;
  imageUrl?: string;
  featured: boolean;
  assignmentRadiusKm: number;
};

type LocalityImport = {
  slug: string;
  name: string;
  shortDescription: string;
  intro: string;
  practicalInfo: string;
  heroImageSeed: string;
  imageUrl?: string;
  latitude: number;
  longitude: number;
  placeType: LocalityKind;
  sourceUrl?: string;
  featured: boolean;
  townSlug: string;
  assignmentRadiusKm: number;
};

type ProvinceBounds = {
  east: number;
  north: number;
  south: number;
  west: number;
};

type OverpassElement = {
  center?: {
    lat: number;
    lon: number;
  };
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  type: "node" | "way" | "relation";
};

async function ensurePrimaryAdminUser() {
  const configuredEmail = process.env.PRIMARY_ADMIN_EMAIL?.trim().toLowerCase() || "";
  const configuredPassword = process.env.PRIMARY_ADMIN_PASSWORD?.trim() || "";
  const existingPrimaryAdmin = await prisma.user.findFirst({
    where: {
      username: PRIMARY_ADMIN_USERNAME,
    },
    select: {
      id: true,
    },
  });

  if (existingPrimaryAdmin) {
    await prisma.user.update({
      where: {
        id: existingPrimaryAdmin.id,
      },
      data: {
        profileCompleted: true,
        role: "ADMIN",
      },
    });
    return;
  }

  if (!configuredEmail || !configuredPassword) {
    console.warn(
      "Skipping primary admin seed. Set PRIMARY_ADMIN_EMAIL and PRIMARY_ADMIN_PASSWORD to create the Josh account automatically.",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(configuredPassword, 12);

  await prisma.user.create({
    data: {
      email: configuredEmail,
      emailVerified: new Date(),
      passwordHash,
      profileCompleted: true,
      role: "ADMIN",
      username: PRIMARY_ADMIN_USERNAME,
    },
  });
}

type ImportedBusiness = {
  address: string;
  categorySlug: CategorySlug;
  description: string;
  externalSource: string;
  heroImageSeed: string;
  isFeatured: boolean;
  isOpenNow: boolean;
  imageUrl?: string;
  isLikelyClosed: boolean;
  latitude: number;
  longitude: number;
  mapsUrl: string;
  name: string;
  openingHoursText?: string;
  phone?: string;
  rawTags?: Prisma.InputJsonValue;
  shortDescription: string;
  sourceKey: string;
  sourceUrl: string;
  sourceConfidence: number;
  tagNames: string[];
  localitySlug?: string;
  townSlug: string;
  verificationStatus: VerificationStatus;
  website?: string;
};

type WikidataClaimsResponse = {
  entities: Record<
    string,
    {
      claims?: Record<
        string,
        Array<{
          mainsnak?: {
            datavalue?: {
              value?: unknown;
            };
          };
        }>
      >;
    }
  >;
};

function ensureCacheDir() {
  mkdirSync(cacheDir, { recursive: true });
}

function readCache<T>(filename: string) {
  ensureCacheDir();
  const filePath = path.join(cacheDir, filename);

  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeCache(filename: string, value: unknown) {
  ensureCacheDir();
  writeFileSync(path.join(cacheDir, filename), JSON.stringify(value, null, 2));
}

const categoryLabels = new Map(categories.map((category) => [category.slug, category.name]));

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstSentence(value: string) {
  const sentence = value.match(/.+?[.!?](\s|$)/)?.[0]?.trim();
  return sentence ?? value.trim();
}

function haversineKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function getCoordinates(element: OverpassElement) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { latitude: element.lat, longitude: element.lon };
  }

  if (element.center) {
    return { latitude: element.center.lat, longitude: element.center.lon };
  }

  return null;
}

function buildAddress(tags: Record<string, string>, townName: string) {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const hamlet = tags["addr:hamlet"] ?? tags["addr:suburb"] ?? tags["addr:place"];

  if (street) {
    return [street, houseNumber].filter(Boolean).join(" ") + `, ${townName}`;
  }

  if (hamlet) {
    return `${hamlet}, ${townName}`;
  }

  return `${townName}, Puglia`;
}

function getTagValue(tags: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = tags[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}

function toTitleList(value: string) {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/_/g, " ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(", ");
}

function toTitleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function resolveWikimediaFilePathUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /^Category:/i.test(trimmed)) {
    return undefined;
  }

  const fileName = trimmed.replace(/^File:/i, "").trim();
  if (!fileName) {
    return undefined;
  }

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
}

function normalizeExternalImageUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^(File:|Category:)/i.test(trimmed)) {
    return resolveWikimediaFilePathUrl(trimmed);
  }

  if (/^\/\//.test(trimmed)) {
    return normalizeExternalImageUrl(`https:${trimmed}`);
  }

  const wikimediaFileMatch = trimmed.match(/\/wiki\/(File:[^?#]+)/i);
  if (wikimediaFileMatch?.[1]) {
    return resolveWikimediaFilePathUrl(decodeURIComponent(wikimediaFileMatch[1]));
  }

  if (/wikimedia\.org\/wiki\/Special:FilePath/i.test(trimmed)) {
    return trimmed;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  if (!/\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function resolveImageUrlFromTags(tags: Record<string, string>) {
  const image = getTagValue(tags, "image", "wikimedia_commons");

  if (image) {
    return normalizeExternalImageUrl(image);
  }

  return undefined;
}

function isInactiveListing(tags: Record<string, string>) {
  if (tags.disused === "yes" || tags.abandoned === "yes" || tags.demolished === "yes") {
    return true;
  }

  if (tags.shop === "vacant" || tags.amenity === "vacant") {
    return true;
  }

  return Object.keys(tags).some((key) =>
    /^(abandoned|demolished|destroyed|disused|former|removed|ruins|was):/i.test(key),
  );
}

function isLikelyClosedListing(tags: Record<string, string>) {
  const openingHours = getTagValue(tags, "opening_hours")?.toLowerCase();

  return (
    isInactiveListing(tags) ||
    openingHours === "closed" ||
    openingHours === "off" ||
    Boolean(openingHours?.includes("temporarily closed"))
  );
}

function computeSourceConfidence(tags: Record<string, string>) {
  let score = 18;

  if (getTagValue(tags, "addr:street", "addr:place", "addr:suburb", "addr:hamlet")) {
    score += 18;
  }

  if (tags["addr:housenumber"]) {
    score += 6;
  }

  if (getTagValue(tags, "contact:phone", "phone")) {
    score += 14;
  }

  if (getTagValue(tags, "contact:website", "website", "url")) {
    score += 14;
  }

  if (getTagValue(tags, "opening_hours")) {
    score += 14;
  }

  if (getTagValue(tags, "contact:email", "email")) {
    score += 6;
  }

  if (resolveImageUrlFromTags(tags)) {
    score += 8;
  }

  if (getTagValue(tags, "brand", "operator")) {
    score += 5;
  }

  if (getTagValue(tags, "cuisine", "tourism", "shop", "craft", "amenity", "description")) {
    score += 7;
  }

  return clamp(score, 10, 99);
}

function computeVerificationStatus(
  tags: Record<string, string>,
  sourceConfidence: number,
  isLikelyClosed: boolean,
) {
  if (isLikelyClosed) {
    return VerificationStatus.REPORTED_STALE;
  }

  if (sourceConfidence >= 45 && !isInactiveListing(tags)) {
    return VerificationStatus.OPEN_DATA;
  }

  return VerificationStatus.UNVERIFIED;
}

function buildBusinessTags(categorySlug: CategorySlug, tags: Record<string, string>) {
  const cuisines = getTagValue(tags, "cuisine")
    ?.split(/[;,]/)
    .map((entry) => toTitleCase(entry.trim()))
    .filter(Boolean);

  const values = uniqueStrings([
    ...(cuisines ?? []),
    tags.tourism ? toTitleCase(tags.tourism) : null,
    tags.shop ? toTitleCase(tags.shop) : null,
    tags.craft ? toTitleCase(tags.craft) : null,
    tags.amenity ? toTitleCase(tags.amenity) : null,
    tags.leisure ? toTitleCase(tags.leisure) : null,
    tags.organic === "yes" ? "Organic" : null,
    tags.takeaway === "yes" ? "Takeaway" : null,
    tags.delivery === "yes" ? "Delivery" : null,
    tags.outdoor_seating === "yes" ? "Outdoor seating" : null,
    tags.wheelchair === "yes"
      ? "Wheelchair accessible"
      : tags.wheelchair === "limited"
        ? "Limited wheelchair access"
        : null,
    tags.internet_access === "wlan" || tags.wifi === "yes" ? "Wi-Fi" : null,
    tags["payment:cards"] === "yes" ? "Cards accepted" : null,
    categorySlug === "beaches" ? "Seafront" : null,
  ]);

  return values.slice(0, 8);
}

function buildShortDescription(categorySlug: CategorySlug, tags: Record<string, string>) {
  const cuisine = getTagValue(tags, "cuisine");
  const tourism = tags.tourism;
  const shop = tags.shop;
  const amenity = tags.amenity;
  const craft = tags.craft;

  if (categorySlug === "restaurants" && cuisine) {
    return `${toTitleList(cuisine)} restaurant listing imported from OpenStreetMap.`;
  }

  if (categorySlug === "cafes" && amenity) {
    return `${amenity.replace(/_/g, " ")} listing imported from OpenStreetMap.`;
  }

  if (categorySlug === "hotels" && tourism) {
    return `${tourism.replace(/_/g, " ")} stay listing imported from OpenStreetMap.`;
  }

  if (categorySlug === "shops" && shop) {
    return `${shop.replace(/_/g, " ")} shop listing imported from OpenStreetMap.`;
  }

  if (categorySlug === "grocery" && (shop || amenity)) {
    return `${(shop ?? amenity).replace(/_/g, " ")} listing imported from OpenStreetMap.`;
  }

  if (categorySlug === "things-to-do" && (tourism || amenity)) {
    return `${(tourism ?? amenity ?? "leisure").replace(/_/g, " ")} place imported from OpenStreetMap.`;
  }

  if (categorySlug === "mechanics" && (craft || shop)) {
    return `${(craft ?? shop ?? "mechanic").replace(/_/g, " ")} service imported from OpenStreetMap.`;
  }

  if (categorySlug === "plumbers" && craft) {
    return `${craft.replace(/_/g, " ")} service imported from OpenStreetMap.`;
  }

  return `${categoryLabels.get(categorySlug) ?? "Local"} listing imported from OpenStreetMap.`;
}

function buildDescription(
  categorySlug: CategorySlug,
  tags: Record<string, string>,
  townName: string,
) {
  const parts = [
    buildShortDescription(categorySlug, tags),
    `Located in ${townName}.`,
  ];

  const cuisine = getTagValue(tags, "cuisine");
  if (cuisine) {
    parts.push(`Cuisine: ${toTitleList(cuisine)}.`);
  }

  const openingHours = getTagValue(tags, "opening_hours");
  if (openingHours) {
    parts.push(`Opening hours tag: ${openingHours}.`);
  }

  const payment = getTagValue(tags, "payment:cash", "payment:cards");
  if (payment) {
    parts.push("Additional payment details are present in the source tags.");
  }

  parts.push("Structured listing sourced from OpenStreetMap for this local prototype.");

  return parts.join(" ");
}

function placeValueToLocalityKind(value?: string) {
  switch (value) {
    case "quarter":
      return LocalityKind.QUARTER;
    case "suburb":
      return LocalityKind.SUBURB;
    case "neighbourhood":
      return LocalityKind.NEIGHBOURHOOD;
    case "hamlet":
      return LocalityKind.HAMLET;
    case "village":
      return LocalityKind.VILLAGE;
    default:
      return LocalityKind.LOCALITY;
  }
}

function localityKindLabel(kind: LocalityKind) {
  switch (kind) {
    case LocalityKind.MARINA:
      return "marina";
    case LocalityKind.FRAZIONE:
      return "frazione";
    case LocalityKind.HAMLET:
      return "hamlet";
    case LocalityKind.VILLAGE:
      return "village";
    case LocalityKind.SUBURB:
      return "suburb";
    case LocalityKind.QUARTER:
      return "quarter";
    case LocalityKind.NEIGHBOURHOOD:
      return "neighbourhood";
    default:
      return "locality";
  }
}

function looksCoastalLocality(name: string, tags: Record<string, string>) {
  const normalized = normalizeName(name);
  const words = ["porto", "marina", "lido", "torre", "baia", "costa"];

  return (
    featuredLocalityNames.has(name) ||
    words.some((word) => normalized.split(" ").includes(word)) ||
    tags.seamark ||
    tags.coast_type === "beach"
  );
}

function buildLocalityText(
  localityName: string,
  localityKind: LocalityKind,
  townName: string,
  province: ScopeTown["province"],
) {
  const kindLabel = localityKindLabel(localityKind);

  return {
    shortDescription: `${kindLabel} in ${townName}, ${province}.`,
    intro: `${localityName} is a ${kindLabel} within the municipality of ${townName} in the province of ${province}.`,
    practicalInfo: `This smaller place is grouped under ${townName} for municipal context while keeping its own page for beaches, services, restaurants, stays, and other nearby listings.`,
  };
}

function looksFeatured(categorySlug: string, tags: Record<string, string>, townSlug: string) {
  return (
    featuredTownNames.has(tags["addr:city"] ?? "") ||
    ["beaches", "things-to-do", "hotels"].includes(categorySlug) ||
    Boolean(tags.website || tags["contact:website"]) ||
    ["lecce", "gallipoli", "otranto", "porto-cesareo", "ostuni", "taranto"].includes(
      townSlug,
    )
  );
}

function buildTownPracticalInfo(
  town: TownImport,
  counts: Partial<Record<(typeof categories)[number]["slug"], number>>,
  totalBusinesses: number,
) {
  const highlights = [
    counts.restaurants ? `${counts.restaurants} restaurants` : null,
    counts.cafes ? `${counts.cafes} cafes and bars` : null,
    counts.beaches ? `${counts.beaches} named beaches or coastal places` : null,
    counts.grocery ? `${counts.grocery} grocery or market listings` : null,
    counts.mechanics ? `${counts.mechanics} mechanic listings` : null,
    counts.plumbers ? `${counts.plumbers} plumber listings` : null,
    counts.pharmacies ? `${counts.pharmacies} pharmacies` : null,
    counts["things-to-do"] ? `${counts["things-to-do"]} activity-oriented places` : null,
  ].filter(Boolean);

  const populationLine =
    typeof town.population === "number"
      ? `Population data imported from Wikidata: ${town.population.toLocaleString("en-US")}.`
      : "Population data is not currently present in the imported Wikidata fields.";

  return [
    `This municipality currently has ${totalBusinesses} imported structured listings in the prototype.`,
    highlights.length ? `Notable category coverage includes ${highlights.slice(0, 4).join(", ")}.` : null,
    populationLine,
    town.officialWebsite ? `Official municipal website: ${town.officialWebsite}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function categoryFromTags(tags: Record<string, string>): CategorySlug | null {
  const amenity = tags.amenity;
  const shop = tags.shop;
  const tourism = tags.tourism;
  const craft = tags.craft;
  const natural = tags.natural;
  const leisure = tags.leisure;

  if (shop === "bakery") {
    return "bakeries";
  }

  if (amenity === "pharmacy") {
    return "pharmacies";
  }

  if (craft === "plumber") {
    return "plumbers";
  }

  if (craft === "mechanic" || shop === "car_repair") {
    return "mechanics";
  }

  if (natural === "beach" || leisure === "beach_resort") {
    return "beaches";
  }

  if (
    tourism &&
    ["hotel", "guest_house", "motel", "hostel", "apartment", "camp_site"].includes(tourism)
  ) {
    return "hotels";
  }

  if (
    tourism ||
    leisure === "marina" ||
    leisure === "sports_centre" ||
    leisure === "water_park" ||
    amenity === "events_venue"
  ) {
    return "things-to-do";
  }

  if (amenity && ["restaurant", "fast_food", "food_court"].includes(amenity)) {
    return "restaurants";
  }

  if (amenity && ["cafe", "bar", "pub", "ice_cream", "biergarten"].includes(amenity)) {
    return "cafes";
  }

  if (
    amenity === "marketplace" ||
    (shop &&
      ["supermarket", "convenience", "greengrocer", "butcher", "deli", "seafood"].includes(
        shop,
      ))
  ) {
    return "grocery";
  }

  if (shop) {
    return "shops";
  }

  return null;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry<T>(url: string, init?: RequestInit, attempt = 1): Promise<T> {
  const response = await fetch(url, init);

  if (response.ok) {
    return (await response.json()) as T;
  }

  if (attempt >= 4) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  await sleep(
    response.status === 429 || response.status === 503 ? 15000 * attempt : 1000 * attempt,
  );
  return fetchJsonWithRetry<T>(url, init, attempt + 1);
}

async function searchWikipediaTitle(title: string, province: ScopeTown["province"]) {
  const searchUrl =
    "https://it.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=5&srsearch=" +
    encodeURIComponent(`${title} comune ${province}`);

  const payload = await fetchJsonWithRetry<{
    query?: {
      search?: Array<{
        title: string;
      }>;
    };
  }>(searchUrl, {
    headers: {
      "User-Agent": wikipediaUserAgent,
    },
  });

  const searchResults = payload.query?.search ?? [];

  return (
    searchResults.find((result) => normalizeName(result.title).includes(normalizeName(title)))
      ?.title ??
    searchResults[0]?.title
  );
}

async function fetchWikipediaSummary(title: string, province: ScopeTown["province"]) {
  const attempts = [title, `${title} (${province})`, `${title} (Puglia)`];

  for (const attemptTitle of attempts) {
    const cacheKey = `wiki-${slugify(attemptTitle)}.json`;
    const cached = readCache<WikipediaSummary>(cacheKey);
    if (cached?.coordinates) {
      return cached;
    }

    try {
      const url = `https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(attemptTitle)}`;
      const summary = await fetchJsonWithRetry<WikipediaSummary>(url, {
        headers: {
          "User-Agent": wikipediaUserAgent,
        },
      });

      if (summary.coordinates) {
        writeCache(cacheKey, summary);
        return summary;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("status 404")) {
        console.warn(`Wikipedia fetch fallback for ${attemptTitle}: ${message}`);
      }
    }
  }

  const searchedTitle = await searchWikipediaTitle(title, province);
  if (searchedTitle && !attempts.includes(searchedTitle)) {
    return fetchWikipediaSummary(searchedTitle, province);
  }

  throw new Error(`Missing coordinates in Wikipedia summary for ${title}`);
}

async function fetchWikidataDetails(qids: string[]) {
  const details = new Map<string, WikidataTownDetails>(
    Object.entries(readCache<Record<string, WikidataTownDetails>>("wikidata-details.json") ?? {}),
  );
  const uncachedQids = qids.filter((qid) => !details.has(qid));

  for (let index = 0; index < uncachedQids.length; index += 40) {
    const batch = uncachedQids.slice(index, index + 40);
    const url =
      "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=" +
      batch.join("|");

    const response = await fetchJsonWithRetry<WikidataClaimsResponse>(url, {
      headers: {
        "User-Agent": wikipediaUserAgent,
      },
    });

    for (const qid of batch) {
      const entity = response.entities[qid];
      const claims = entity?.claims ?? {};

      const readQuantity = (property: string) => {
        const value = claims[property]?.[0]?.mainsnak?.datavalue?.value as
          | { amount?: string }
          | undefined;
        return value?.amount ? Number(value.amount) : undefined;
      };

      const readString = (property: string) => {
        const value = claims[property]?.[0]?.mainsnak?.datavalue?.value as string | undefined;
        return value;
      };

      details.set(qid, {
        areaKm2: (() => {
          const area = readQuantity("P2046");
          if (typeof area !== "number") {
            return undefined;
          }

          return Math.abs(area);
        })(),
        elevationM: (() => {
          const elevation = readQuantity("P2044");
          return typeof elevation === "number" ? Math.round(Math.abs(elevation)) : undefined;
        })(),
        officialWebsite: readString("P856"),
        population: (() => {
          const populationValue = claims.P1082?.[0]?.mainsnak?.datavalue?.value as
            | { amount?: string }
            | number
            | undefined;

          if (typeof populationValue === "number") {
            return Math.round(populationValue);
          }

          if (populationValue && typeof populationValue === "object" && populationValue.amount) {
            return Math.round(Math.abs(Number(populationValue.amount)));
          }

          return undefined;
        })(),
      });
    }

    writeCache("wikidata-details.json", Object.fromEntries(details.entries()));
    await sleep(200);
  }

  return details;
}

function buildCanonicalScope() {
  const canonical = new Map<string, ScopeTown>();

  for (const scopeTown of salentoScope) {
    const canonicalName = townReplacements.get(scopeTown.name) ?? scopeTown.name;
    const key = `${scopeTown.province}:${canonicalName}`;

    if (!canonical.has(key)) {
      canonical.set(key, {
        province: scopeTown.province,
        name: canonicalName,
      });
    }
  }

  return Array.from(canonical.values());
}

function buildAliasRecords(canonicalTowns: TownImport[]) {
  const townByName = new Map(canonicalTowns.map((town) => [town.name, town]));

  return salentoScope
    .filter((scopeTown) => townReplacements.has(scopeTown.name))
    .map((scopeTown) => {
      const canonicalName = townReplacements.get(scopeTown.name);
      const canonicalTown = canonicalName ? townByName.get(canonicalName) : undefined;

      if (!canonicalName || !canonicalTown) {
        return null;
      }

      return {
        slug: slugify(scopeTown.name),
        name: scopeTown.name,
        note: townAliasNotes.get(scopeTown.name) ?? null,
        townId: canonicalTown.slug,
      };
    })
    .filter((alias): alias is { slug: string; name: string; note: string | null; townId: string } =>
      Boolean(alias),
    );
}

async function importTowns() {
  const canonicalScope = buildCanonicalScope();
  const summaries = new Map<string, WikipediaSummary>();

  for (const scopeTown of canonicalScope) {
    const summary = await fetchWikipediaSummary(scopeTown.name, scopeTown.province);
    summaries.set(scopeTown.name, summary);
    console.log(`Fetched municipality summary for ${scopeTown.name}`);
    await sleep(1000);
  }

  const qids = Array.from(
    new Set(
      Array.from(summaries.values())
        .map((summary) => summary.wikibase_item)
        .filter((qid): qid is string => Boolean(qid)),
    ),
  );

  const wikidataDetails = await fetchWikidataDetails(qids);

  const towns = canonicalScope.map<TownImport>((scopeTown) => {
    const summary = summaries.get(scopeTown.name);

    if (!summary?.coordinates) {
      throw new Error(`Missing summary for ${scopeTown.name}`);
    }

    const wikidata = summary.wikibase_item
      ? wikidataDetails.get(summary.wikibase_item)
      : undefined;

    const intro = (summary.extract ?? summary.description ?? `${scopeTown.name} is a municipality in Puglia.`).trim();
    const history =
      summary.extract?.trim() ??
      `${scopeTown.name} is a municipality in the province of ${scopeTown.province}, within the wider Salento area of Puglia.`;

    const areaKm2 =
      typeof wikidata?.areaKm2 === "number" && Number.isFinite(wikidata.areaKm2)
        ? wikidata.areaKm2
        : undefined;

    return {
      province: scopeTown.province,
      slug: slugify(scopeTown.name),
      name: scopeTown.name,
      sourceUrl: summary.content_urls?.desktop?.page,
      wikipediaTitle: summary.title,
      wikidataId: summary.wikibase_item,
      latitude: summary.coordinates.lat,
      longitude: summary.coordinates.lon,
      population: wikidata?.population,
      areaKm2,
      elevationM: wikidata?.elevationM,
      officialWebsite: wikidata?.officialWebsite,
      shortDescription:
        summary.description?.trim() ?? firstSentence(summary.extract ?? `${scopeTown.name} in Puglia.`),
      intro,
      history,
      practicalInfo: "",
      imageUrl: summary.thumbnail?.source,
      featured: featuredTownNames.has(scopeTown.name),
      assignmentRadiusKm: clamp(
        areaKm2 ? Math.sqrt(areaKm2 / Math.PI) * 1.15 : 6,
        2.5,
        18,
      ),
    };
  });

  return towns;
}

function buildProvinceBounds(towns: TownImport[]) {
  const grouped = new Map<ScopeTown["province"], TownImport[]>();

  for (const town of towns) {
    grouped.set(town.province, [...(grouped.get(town.province) ?? []), town]);
  }

  const bounds = new Map<ScopeTown["province"], ProvinceBounds>();

  for (const [province, provinceTowns] of grouped.entries()) {
    const latitudes = provinceTowns.map((town) => town.latitude);
    const longitudes = provinceTowns.map((town) => town.longitude);

    bounds.set(province, {
      south: Math.min(...latitudes) - 0.12,
      west: Math.min(...longitudes) - 0.12,
      north: Math.max(...latitudes) + 0.12,
      east: Math.max(...longitudes) + 0.12,
    });
  }

  return bounds;
}

function buildOverpassQuery(bounds: ProvinceBounds) {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  return `[out:json][timeout:180];
(
  nwr[amenity~"restaurant|fast_food|food_court|cafe|bar|pub|ice_cream|biergarten|pharmacy|marketplace|events_venue"](${bbox});
  nwr[shop](${bbox});
  nwr[tourism](${bbox});
  nwr[craft~"mechanic|plumber"](${bbox});
  nwr[natural="beach"](${bbox});
  nwr[leisure~"beach_resort|marina|sports_centre|water_park"](${bbox});
);
out center tags;`;
}

function buildLocalitiesOverpassQuery(bounds: ProvinceBounds) {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;

  return `[out:json][timeout:180];
(
  nwr[place~"locality|hamlet|village|suburb|quarter|neighbourhood"](${bbox});
);
out center tags;`;
}

async function fetchProvincePois(province: ScopeTown["province"], bounds: ProvinceBounds) {
  const cacheKey = `osm-${slugify(province)}.json`;
  const cached = readCache<{ elements: OverpassElement[] }>(cacheKey);
  if (cached?.elements?.length) {
    console.log(`Loaded ${cached.elements.length} cached OSM elements for ${province}`);
    return cached.elements;
  }

  const query = buildOverpassQuery(bounds);
  const response = await fetch(overpassEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": wikipediaUserAgent,
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error(`Overpass import failed for ${province} with status ${response.status}`);
  }

  const payload = (await response.json()) as { elements: OverpassElement[] };
  writeCache(cacheKey, payload);
  console.log(`Fetched ${payload.elements.length} OSM elements for ${province}`);
  return payload.elements;
}

async function fetchProvinceLocalities(province: ScopeTown["province"], bounds: ProvinceBounds) {
  const cacheKey = `osm-localities-${slugify(province)}.json`;
  const cached = readCache<{ elements: OverpassElement[] }>(cacheKey);
  if (cached?.elements?.length) {
    console.log(`Loaded ${cached.elements.length} cached OSM localities for ${province}`);
    return cached.elements;
  }

  const query = buildLocalitiesOverpassQuery(bounds);
  const response = await fetch(overpassEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": wikipediaUserAgent,
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error(`Overpass locality import failed for ${province} with status ${response.status}`);
  }

  const payload = (await response.json()) as { elements: OverpassElement[] };
  writeCache(cacheKey, payload);
  console.log(`Fetched ${payload.elements.length} OSM localities for ${province}`);
  return payload.elements;
}

function assignTown(
  element: OverpassElement,
  province: ScopeTown["province"],
  towns: TownImport[],
  namesIndex: Map<string, string>,
) {
  const tags = element.tags ?? {};
  const provinceTowns = towns.filter((town) => town.province === province);

  const namedCandidates = [
    tags["addr:city"],
    tags["addr:place"],
    tags["addr:suburb"],
    tags["addr:village"],
    tags["is_in"],
  ]
    .flatMap((value) => (value ? value.split(/[;,/]/).map((part) => part.trim()) : []))
    .filter(Boolean);

  for (const candidate of namedCandidates) {
    const normalized = normalizeName(candidate);
    const matchSlug = namesIndex.get(normalized);
    if (matchSlug) {
      return towns.find((town) => town.slug === matchSlug) ?? null;
    }
  }

  const coordinates = getCoordinates(element);
  if (!coordinates) {
    return null;
  }

  const nearestTown = provinceTowns
    .map((town) => ({
      distanceKm: haversineKm(
        {
          latitude: town.latitude,
          longitude: town.longitude,
        },
        coordinates,
      ),
      town,
    }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];

  if (!nearestTown) {
    return null;
  }

  if (nearestTown.distanceKm > nearestTown.town.assignmentRadiusKm * 1.35) {
    return null;
  }

  return nearestTown.town;
}

async function importLocalities(towns: TownImport[]) {
  const provinceBounds = buildProvinceBounds(towns);
  const namesIndex = new Map<string, string>();
  const sourceMap = new Map<string, LocalityImport>();

  for (const town of towns) {
    namesIndex.set(normalizeName(town.name), town.slug);
  }

  for (const [aliasName, canonicalName] of townReplacements.entries()) {
    const canonicalTown = towns.find((town) => town.name === canonicalName);
    if (canonicalTown) {
      namesIndex.set(normalizeName(aliasName), canonicalTown.slug);
    }
  }

  for (const province of ["Lecce", "Brindisi", "Taranto"] as const) {
    const bounds = provinceBounds.get(province);

    if (!bounds) {
      continue;
    }

    const elements = await fetchProvinceLocalities(province, bounds);

    for (const element of elements) {
      const tags = element.tags ?? {};
      const name = tags.name?.trim();
      const coordinates = getCoordinates(element);
      const placeValue = tags.place;

      if (!name || !coordinates || !placeValue) {
        continue;
      }

      const town = assignTown(element, province, towns, namesIndex);
      if (!town) {
        continue;
      }

      if (normalizeName(name) === normalizeName(town.name)) {
        continue;
      }

      const provisionalKind = placeValueToLocalityKind(placeValue);
      const localityKind = looksCoastalLocality(name, tags)
        ? LocalityKind.MARINA
        : provisionalKind;

      const key = `${town.slug}:${normalizeName(name)}`;
      if (sourceMap.has(key)) {
        continue;
      }

      const copy = buildLocalityText(name, localityKind, town.name, town.province);

      sourceMap.set(key, {
        slug: slugify(`${name}-${town.slug}`),
        name,
        shortDescription: copy.shortDescription,
        intro: copy.intro,
        practicalInfo: copy.practicalInfo,
        heroImageSeed: `${slugify(name)}-${town.slug}-hero`,
        imageUrl: resolveImageUrlFromTags(tags),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        placeType: localityKind,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        featured: featuredLocalityNames.has(name),
        townSlug: town.slug,
        assignmentRadiusKm: clamp(
          localityKind === LocalityKind.MARINA
            ? 4.5
            : localityKind === LocalityKind.SUBURB || localityKind === LocalityKind.QUARTER
              ? 2
              : 3.2,
          1.2,
          5,
        ),
      });
    }

    await sleep(300);
  }

  return Array.from(sourceMap.values());
}

function assignLocality(
  element: OverpassElement,
  town: TownImport,
  localitiesByTownSlug: Map<string, LocalityImport[]>,
) {
  const localities = localitiesByTownSlug.get(town.slug) ?? [];

  if (!localities.length) {
    return null;
  }

  const tags = element.tags ?? {};
  const namedCandidates = [
    tags["addr:place"],
    tags["addr:suburb"],
    tags["addr:hamlet"],
    tags["addr:village"],
    tags["addr:neighbourhood"],
    tags["is_in"],
  ]
    .flatMap((value) => (value ? value.split(/[;,/]/).map((part) => part.trim()) : []))
    .filter(Boolean);

  for (const candidate of namedCandidates) {
    const normalizedCandidate = normalizeName(candidate);
    const exactMatch = localities.find(
      (locality) => normalizeName(locality.name) === normalizedCandidate,
    );

    if (exactMatch) {
      return exactMatch;
    }
  }

  const coordinates = getCoordinates(element);
  if (!coordinates) {
    return null;
  }

  const nearestLocality = localities
    .map((locality) => ({
      distanceKm: haversineKm(
        {
          latitude: locality.latitude,
          longitude: locality.longitude,
        },
        coordinates,
      ),
      locality,
    }))
    .sort((left, right) => left.distanceKm - right.distanceKm)[0];

  if (!nearestLocality) {
    return null;
  }

  if (nearestLocality.distanceKm > nearestLocality.locality.assignmentRadiusKm) {
    return null;
  }

  const isUrbanSubdivision =
    nearestLocality.locality.placeType === LocalityKind.SUBURB ||
    nearestLocality.locality.placeType === LocalityKind.QUARTER ||
    nearestLocality.locality.placeType === LocalityKind.NEIGHBOURHOOD;

  if (isUrbanSubdivision && !featuredLocalityNames.has(nearestLocality.locality.name)) {
    return null;
  }

  return nearestLocality.locality;
}

function mergeSupplementalLocalities(
  towns: TownImport[],
  localities: LocalityImport[],
  businesses: ImportedBusiness[],
) {
  const byKey = new Map(localities.map((locality) => [`${locality.townSlug}:${normalizeName(locality.name)}`, locality]));
  const townBySlug = new Map(towns.map((town) => [town.slug, town]));

  for (const business of businesses) {
    if (business.localitySlug) {
      continue;
    }

    const tags = (business.rawTags ?? {}) as Record<string, string>;
    const nameCandidate = [
      tags["addr:place"],
      tags["addr:suburb"],
      tags["addr:hamlet"],
      tags["addr:village"],
      tags["addr:neighbourhood"],
    ].find(Boolean);

    if (!nameCandidate) {
      continue;
    }

    const key = `${business.townSlug}:${normalizeName(nameCandidate)}`;
    if (byKey.has(key)) {
      continue;
    }

    const town = townBySlug.get(business.townSlug);
    if (!town) {
      continue;
    }

    const localityKind = looksCoastalLocality(nameCandidate, tags)
      ? LocalityKind.MARINA
      : LocalityKind.LOCALITY;
    const copy = buildLocalityText(nameCandidate, localityKind, town.name, town.province);

    const locality: LocalityImport = {
      slug: slugify(`${nameCandidate}-${town.slug}`),
      name: nameCandidate,
      shortDescription: copy.shortDescription,
      intro: copy.intro,
      practicalInfo: copy.practicalInfo,
      heroImageSeed: `${slugify(nameCandidate)}-${town.slug}-hero`,
      imageUrl: business.imageUrl,
      latitude: business.latitude,
      longitude: business.longitude,
      placeType: localityKind,
      sourceUrl: business.sourceUrl,
      featured: featuredLocalityNames.has(nameCandidate),
      townSlug: town.slug,
      assignmentRadiusKm: localityKind === LocalityKind.MARINA ? 4.5 : 2.4,
    };

    byKey.set(key, locality);
  }

  return Array.from(byKey.values());
}

async function importBusinesses(towns: TownImport[], importedLocalities: LocalityImport[]) {
  const provinceBounds = buildProvinceBounds(towns);
  const namesIndex = new Map<string, string>();
  const sourceMap = new Map<string, ImportedBusiness>();
  const localitiesByTownSlug = new Map<string, LocalityImport[]>();

  for (const town of towns) {
    namesIndex.set(normalizeName(town.name), town.slug);
  }

  for (const locality of importedLocalities) {
    localitiesByTownSlug.set(locality.townSlug, [
      ...(localitiesByTownSlug.get(locality.townSlug) ?? []),
      locality,
    ]);
  }

  for (const [aliasName, canonicalName] of townReplacements.entries()) {
    const canonicalTown = towns.find((town) => town.name === canonicalName);
    if (canonicalTown) {
      namesIndex.set(normalizeName(aliasName), canonicalTown.slug);
    }
  }

  for (const province of ["Lecce", "Brindisi", "Taranto"] as const) {
    const bounds = provinceBounds.get(province);

    if (!bounds) {
      continue;
    }

    const elements = await fetchProvincePois(province, bounds);

    for (const element of elements) {
      const tags = element.tags ?? {};
      const categorySlug = categoryFromTags(tags);
      const coordinates = getCoordinates(element);

      if (!categorySlug || !coordinates) {
        continue;
      }

      if (isInactiveListing(tags)) {
        continue;
      }

      const town = assignTown(element, province, towns, namesIndex);
      if (!town) {
        continue;
      }
      const locality = assignLocality(element, town, localitiesByTownSlug);

      const name =
        getTagValue(tags, "name", "operator", "brand") ??
        (categorySlug === "beaches" ? `${town.name} Beach` : undefined);

      if (!name) {
        continue;
      }

      const sourceKey = `osm:${element.type}:${element.id}`;
      if (sourceMap.has(sourceKey)) {
        continue;
      }

      const website = getTagValue(tags, "contact:website", "website", "url");
      const phone = getTagValue(tags, "contact:phone", "phone");
      const openingHoursText = getTagValue(tags, "opening_hours");
      const imageUrl = resolveImageUrlFromTags(tags);
      const isLikelyClosed = isLikelyClosedListing(tags);
      const sourceConfidence = computeSourceConfidence(tags);
      const address = buildAddress(tags, town.name);

      sourceMap.set(sourceKey, {
        address,
        categorySlug,
        description: buildDescription(categorySlug, tags, town.name),
        externalSource: "osm",
        heroImageSeed: `${slugify(name)}-${town.slug}-osm`,
        isFeatured: looksFeatured(categorySlug, tags, town.slug),
        isOpenNow: false,
        imageUrl,
        isLikelyClosed,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        mapsUrl: `https://maps.google.com/?q=${coordinates.latitude},${coordinates.longitude}`,
        name,
        openingHoursText,
        phone,
        rawTags: tags as Prisma.InputJsonValue,
        shortDescription: buildShortDescription(categorySlug, tags),
        sourceKey,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        sourceConfidence,
        tagNames: buildBusinessTags(categorySlug, tags),
        localitySlug: locality?.slug,
        townSlug: town.slug,
        verificationStatus: computeVerificationStatus(
          tags,
          sourceConfidence,
          isLikelyClosed,
        ),
        website,
      });
    }

    await sleep(400);
  }

  const businesses = Array.from(sourceMap.values());
  const supplementedLocalities = mergeSupplementalLocalities(
    towns,
    importedLocalities,
    businesses,
  );
  const supplementedLocalitiesByTownSlug = new Map<string, LocalityImport[]>();

  for (const locality of supplementedLocalities) {
    supplementedLocalitiesByTownSlug.set(locality.townSlug, [
      ...(supplementedLocalitiesByTownSlug.get(locality.townSlug) ?? []),
      locality,
    ]);
  }

  for (const business of businesses) {
    if (business.localitySlug) {
      continue;
    }

    const town = towns.find((entry) => entry.slug === business.townSlug);
    if (!town) {
      continue;
    }

    const locality = assignLocality(
      {
        id: 0,
        type: "node",
        lat: business.latitude,
        lon: business.longitude,
        tags: (business.rawTags ?? {}) as Record<string, string>,
      },
      town,
      supplementedLocalitiesByTownSlug,
    );

    business.localitySlug = locality?.slug;
  }

  return {
    businesses,
    localities: supplementedLocalities,
  };
}

function createTownCounts(businesses: ImportedBusiness[]) {
  const counts = new Map<string, Partial<Record<(typeof categories)[number]["slug"], number>>>();

  for (const business of businesses) {
    const current = counts.get(business.townSlug) ?? {};
    current[business.categorySlug] = (current[business.categorySlug] ?? 0) + 1;
    counts.set(business.townSlug, current);
  }

  return counts;
}

async function main() {
  await ensurePrimaryAdminUser();

  const importedTowns = await importTowns();
  const importedLocalities = await importLocalities(importedTowns);
  const localityImport = await importBusinesses(importedTowns, importedLocalities);
  const importedBusinesses = localityImport.businesses;
  const finalizedLocalities = localityImport.localities;
  const townCounts = createTownCounts(importedBusinesses);

  const finalizedTowns = importedTowns.map((town) => {
    const counts = townCounts.get(town.slug) ?? {};
    const totalBusinesses = Object.values(counts).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );

    return {
      ...town,
      practicalInfo: buildTownPracticalInfo(town, counts, totalBusinesses),
    };
  });

  const aliasRecords = buildAliasRecords(finalizedTowns);
  const importTimestamp = new Date();

  await prisma.businessImage.deleteMany();
  await prisma.businessHour.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.review.deleteMany();
  await prisma.business.deleteMany();
  await prisma.locality.deleteMany();
  await prisma.townAlias.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.town.deleteMany();

  const categoryIdBySlug = new Map<string, string>();
  for (const category of categories) {
    const created = await prisma.category.create({ data: category });
    categoryIdBySlug.set(category.slug, created.id);
  }

  const townIdBySlug = new Map<string, string>();
  for (const town of finalizedTowns) {
    const created = await prisma.town.create({
      data: {
        slug: town.slug,
        name: town.name,
        province: town.province,
        region: "Puglia",
        shortDescription: town.shortDescription,
        intro: town.intro,
        history: town.history,
        practicalInfo: town.practicalInfo,
        heroImageSeed: `${town.slug}-hero`,
        imageUrl: town.imageUrl,
        latitude: town.latitude,
        longitude: town.longitude,
        population: town.population,
        areaKm2: town.areaKm2,
        elevationM: town.elevationM,
        wikipediaTitle: town.wikipediaTitle,
        wikidataId: town.wikidataId,
        officialWebsite: town.officialWebsite,
        sourceUrl: town.sourceUrl,
        featured: town.featured,
      },
    });

    townIdBySlug.set(town.slug, created.id);
  }

  const localityIdBySlug = new Map<string, string>();
  for (const locality of finalizedLocalities) {
    const townId = townIdBySlug.get(locality.townSlug);

    if (!townId) {
      continue;
    }

    const created = await prisma.locality.create({
      data: {
        slug: locality.slug,
        name: locality.name,
        shortDescription: locality.shortDescription,
        intro: locality.intro,
        practicalInfo: locality.practicalInfo,
        heroImageSeed: locality.heroImageSeed,
        imageUrl: locality.imageUrl,
        latitude: locality.latitude,
        longitude: locality.longitude,
        placeType: locality.placeType,
        sourceUrl: locality.sourceUrl,
        featured: locality.featured,
        townId,
      },
    });

    localityIdBySlug.set(locality.slug, created.id);
  }

  if (aliasRecords.length) {
    const aliasData = aliasRecords
      .map((alias) => {
        const townId = townIdBySlug.get(alias.townId);

        if (!townId) {
          return null;
        }

        return {
          slug: alias.slug,
          name: alias.name,
          note: alias.note ?? undefined,
          townId,
        };
      })
      .filter(
        (
          alias,
        ): alias is { slug: string; name: string; note: string | undefined; townId: string } =>
          Boolean(alias),
      );

    await prisma.townAlias.createMany({
      data: aliasData,
    });
  }

  const businessData = importedBusinesses
    .map((business) => {
      const townId = townIdBySlug.get(business.townSlug);
      const categoryId = categoryIdBySlug.get(business.categorySlug);
      const localityId = business.localitySlug
        ? localityIdBySlug.get(business.localitySlug)
        : undefined;

      if (!townId || !categoryId) {
        return null;
      }

      return {
        slug: slugify(`${business.name}-${business.townSlug}-${business.sourceKey}`),
        sourceKey: business.sourceKey,
        externalSource: business.externalSource,
        sourceUrl: business.sourceUrl,
        name: business.name,
        shortDescription: business.shortDescription,
        description: business.description,
        address: business.address,
        phone: business.phone,
        website: business.website,
        openingHoursText: business.openingHoursText,
        rating: 0,
        reviewCount: 0,
        isFeatured: business.isFeatured,
        isOpenNow: business.isOpenNow,
        verificationStatus: business.verificationStatus,
        sourceConfidence: business.sourceConfidence,
        lastVerifiedAt: importTimestamp,
        isLikelyClosed: business.isLikelyClosed,
        mapsUrl: business.mapsUrl,
        heroImageSeed: business.heroImageSeed,
        latitude: business.latitude,
        longitude: business.longitude,
        rawTags: business.rawTags,
        categoryId,
        localityId,
        townId,
      };
    })
    .filter(Boolean) as Prisma.BusinessCreateManyInput[];

  await prisma.business.createMany({
    data: businessData,
  });

  const createdBusinesses = await prisma.business.findMany({
    select: {
      id: true,
      sourceKey: true,
      name: true,
    },
  });

  const businessIdBySourceKey = new Map(
    createdBusinesses
      .filter((business): business is typeof business & { sourceKey: string } =>
        Boolean(business.sourceKey),
      )
      .map((business) => [business.sourceKey, business.id]),
  );

  const businessImages = importedBusinesses
    .flatMap((business) => {
      const businessId = businessIdBySourceKey.get(business.sourceKey);

      if (!businessId || !business.imageUrl) {
        return [];
      }

      return [
        {
          businessId,
          url: business.imageUrl,
          alt: `${business.name} listing photo`,
          sortOrder: 0,
        },
      ];
    })
    .filter(Boolean);

  if (businessImages.length) {
    await prisma.businessImage.createMany({
      data: businessImages,
    });
  }

  const importedBusinessBySourceKey = new Map(
    importedBusinesses.map((business) => [business.sourceKey, business]),
  );
  const tagCatalog = new Map<string, string>();

  for (const business of importedBusinesses) {
    for (const tagName of business.tagNames) {
      tagCatalog.set(slugify(tagName), tagName);
    }
  }

  if (tagCatalog.size) {
    await prisma.tag.createMany({
      data: Array.from(tagCatalog.entries()).map(([slug, name]) => ({
        slug,
        name,
      })),
    });

    const createdTags = await prisma.tag.findMany({
      select: {
        id: true,
        slug: true,
      },
    });
    const tagIdBySlug = new Map(createdTags.map((tag) => [tag.slug, tag.id]));

    const businessTagRows = createdBusinesses.flatMap((business) => {
      const importedBusiness = business.sourceKey
        ? importedBusinessBySourceKey.get(business.sourceKey)
        : undefined;

      if (!importedBusiness) {
        return [];
      }

      return importedBusiness.tagNames
        .map((tagName) => {
          const tagId = tagIdBySlug.get(slugify(tagName));

          if (!tagId) {
            return null;
          }

          return {
            businessId: business.id,
            tagId,
          };
        })
        .filter(
          (row): row is { businessId: string; tagId: string } => Boolean(row),
        );
    });

    if (businessTagRows.length) {
      await prisma.businessTag.createMany({
        data: businessTagRows,
      });
    }
  }

  const businessSourceRows: Prisma.BusinessSourceCreateManyInput[] = createdBusinesses
    .flatMap((business) => {
      if (!business.sourceKey) {
        return [];
      }

      const importedBusiness = importedBusinessBySourceKey.get(business.sourceKey);
      if (!importedBusiness) {
        return [];
      }

      return [
        {
          businessId: business.id,
          sourceType: SourceType.OPENSTREETMAP,
          sourceName: "OpenStreetMap / Overpass",
          sourceUrl: importedBusiness.sourceUrl,
          sourceKey: importedBusiness.sourceKey,
          license: "ODbL 1.0",
          reuseStatus: SourceReuseStatus.ALLOWED,
          confidence: importedBusiness.sourceConfidence,
          isPrimary: true,
          fieldMask: [
            "name",
            "category",
            "address",
            importedBusiness.phone ? "phone" : null,
            importedBusiness.website ? "website" : null,
            importedBusiness.openingHoursText ? "openingHoursText" : null,
          ].filter(Boolean) as Prisma.InputJsonValue,
          payload: importedBusiness.rawTags,
        },
      ];
    });

  if (businessSourceRows.length) {
    await prisma.businessSource.createMany({
      data: businessSourceRows,
    });
  }

  const allTowns = await prisma.town.count();
  const allLocalities = await prisma.locality.count();
  const allBusinesses = await prisma.business.count();

  console.log(
    `Imported ${allTowns} municipalities, ${allLocalities} localities, and ${allBusinesses} businesses.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
