import { SourceReuseStatus, SourceType, VerificationStatus } from "@prisma/client";

import { clamp, normalizeWhitespace } from "../normalize";
import type { AdapterResult, CandidateListing, LoadedTown } from "../types";

const overpassEndpoint = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";
const userAgent =
  "SalentoDirectoryEnrichment/1.0 (legal public-source enrichment prototype)";

type OverpassElement = {
  center?: {
    lat: number;
    lon: number;
  };
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  type: "node" | "relation" | "way";
};

function getCoordinates(element: OverpassElement) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { latitude: element.lat, longitude: element.lon };
  }

  if (element.center) {
    return { latitude: element.center.lat, longitude: element.center.lon };
  }

  return null;
}

function buildTownAreaQuery(townName: string, aliases: string[]) {
  const areaParts = [townName, ...aliases]
    .map(
      (name) =>
        `area[boundary=administrative][admin_level=8][name="${name.replace(/"/g, '\\"')}"]->.searchArea;`,
    )
    .join("\n");

  return `[out:json][timeout:120];
${areaParts}
(
  nwr[amenity~"restaurant|fast_food|food_court|cafe|bar|pub|ice_cream|biergarten|pharmacy|marketplace|bank|atm|post_office|clinic|dentist|doctors|hospital|veterinary|fuel|car_wash|charging_station|taxi|library|theatre|cinema|arts_centre|community_centre|place_of_worship"](area.searchArea);
  nwr[shop](area.searchArea);
  nwr[tourism](area.searchArea);
  nwr[craft](area.searchArea);
  nwr[office~"estate_agent|travel_agent|insurance|accountant|lawyer"](area.searchArea);
  nwr[leisure~"sports_centre|park|swimming_pool|stadium|fitness_centre"](area.searchArea);
  nwr[historic](area.searchArea);
  nwr[natural="beach"](area.searchArea);
);
out center tags;`;
}

function isClosed(tags: Record<string, string>) {
  if (tags.disused === "yes" || tags.abandoned === "yes" || tags.demolished === "yes") {
    return true;
  }

  if (tags.shop === "vacant" || tags.amenity === "vacant") {
    return true;
  }

  const openingHours = tags.opening_hours?.toLowerCase();
  if (openingHours === "closed" || openingHours === "off") {
    return true;
  }

  return Object.keys(tags).some((key) =>
    /^(abandoned|demolished|destroyed|disused|former|removed|ruins|was):/i.test(key),
  );
}

function classify(tags: Record<string, string>) {
  const amenity = tags.amenity;
  const shop = tags.shop;
  const tourism = tags.tourism;
  const craft = tags.craft;
  const leisure = tags.leisure;
  const office = tags.office;
  const historic = tags.historic;
  const natural = tags.natural;

  if (shop === "bakery") {
    return { categorySlug: "bakeries", subcategory: "bakery" };
  }

  if (amenity === "pharmacy") {
    return { categorySlug: "pharmacies", subcategory: "pharmacy" };
  }

  if (
    craft === "mechanic" ||
    shop === "car_repair" ||
    shop === "car_parts" ||
    shop === "tyres"
  ) {
    return { categorySlug: "mechanics", subcategory: craft ?? shop ?? "mechanic" };
  }

  if (craft === "plumber") {
    return { categorySlug: "plumbers", subcategory: "plumber" };
  }

  if (natural === "beach") {
    return { categorySlug: "beaches", subcategory: "beach" };
  }

  if (
    tourism &&
    [
      "hotel",
      "guest_house",
      "motel",
      "hostel",
      "apartment",
      "camp_site",
      "chalet",
    ].includes(tourism)
  ) {
    return { categorySlug: "hotels", subcategory: tourism };
  }

  if (amenity && ["restaurant", "fast_food", "food_court"].includes(amenity)) {
    return { categorySlug: "restaurants", subcategory: amenity };
  }

  if (amenity && ["cafe", "bar", "pub", "ice_cream", "biergarten"].includes(amenity)) {
    return { categorySlug: "cafes", subcategory: amenity };
  }

  if (
    amenity === "marketplace" ||
    (shop &&
      ["supermarket", "convenience", "greengrocer", "butcher", "deli", "seafood"].includes(
        shop,
      ))
  ) {
    return { categorySlug: "grocery", subcategory: shop ?? amenity ?? "grocery" };
  }

  if (
    tourism &&
    ["museum", "attraction", "artwork", "gallery", "viewpoint", "information"].includes(
      tourism,
    )
  ) {
    return { categorySlug: "things-to-do", subcategory: tourism };
  }

  if (
    leisure &&
    ["sports_centre", "park", "swimming_pool", "stadium", "fitness_centre"].includes(leisure)
  ) {
    return { categorySlug: "things-to-do", subcategory: leisure };
  }

  if (
    historic &&
    ["archaeological_site", "ruins", "castle", "monument", "memorial"].includes(historic)
  ) {
    return { categorySlug: "things-to-do", subcategory: historic };
  }

  if (amenity === "place_of_worship" && tags.name) {
    return { categorySlug: "things-to-do", subcategory: "religious_site" };
  }

  if (
    amenity &&
    [
      "bank",
      "atm",
      "post_office",
      "clinic",
      "dentist",
      "doctors",
      "hospital",
      "veterinary",
      "fuel",
      "car_wash",
      "charging_station",
      "taxi",
      "library",
      "community_centre",
      "theatre",
      "cinema",
      "arts_centre",
    ].includes(amenity)
  ) {
    return { categorySlug: "services", subcategory: amenity };
  }

  if (craft && ["hairdresser", "beauty", "electrician", "locksmith"].includes(craft)) {
    return { categorySlug: "services", subcategory: craft };
  }

  if (office && ["estate_agent", "travel_agent", "insurance", "accountant", "lawyer"].includes(office)) {
    return { categorySlug: "services", subcategory: office };
  }

  if (shop) {
    return { categorySlug: "shops", subcategory: shop };
  }

  return null;
}

function buildAddress(tags: Record<string, string>, townName: string) {
  const street = tags["addr:street"];
  const houseNumber = tags["addr:housenumber"];
  const hamlet = tags["addr:hamlet"] ?? tags["addr:suburb"] ?? tags["addr:place"];

  if (street) {
    return normalizeWhitespace([street, houseNumber].filter(Boolean).join(" ")) + `, ${townName}`;
  }

  if (hamlet) {
    return `${hamlet}, ${townName}`;
  }

  return `${townName}, Puglia`;
}

function resolveImageUrl(tags: Record<string, string>) {
  const value = tags.image ?? tags.wikimedia_commons;
  if (!value) {
    return undefined;
  }

  if (/^https?:\/\//i.test(value) && /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/i.test(value)) {
    return value;
  }

  if (/^File:/i.test(value)) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      value.replace(/^File:/i, "").trim(),
    )}`;
  }

  return undefined;
}

function buildDescription(name: string, townName: string, subcategory?: string) {
  if (subcategory) {
    return `${name} is a ${subcategory.replace(/_/g, " ")} listing in ${townName}.`;
  }

  return `${name} is a local listing in ${townName}.`;
}

function buildSocialLinks(tags: Record<string, string>) {
  const values = {
    facebook: tags["contact:facebook"] ?? tags.facebook ?? undefined,
    instagram: tags["contact:instagram"] ?? tags.instagram ?? undefined,
  };

  const filtered = Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return Object.keys(filtered).length ? filtered : undefined;
}

function computeConfidence(tags: Record<string, string>) {
  let score = 38;

  if (tags["addr:street"] || tags["addr:place"] || tags["addr:suburb"]) {
    score += 18;
  }

  if (tags["addr:housenumber"]) {
    score += 8;
  }

  if (tags.phone || tags["contact:phone"]) {
    score += 14;
  }

  if (tags.website || tags["contact:website"] || tags.url) {
    score += 14;
  }

  if (tags.email || tags["contact:email"]) {
    score += 8;
  }

  if (tags.opening_hours) {
    score += 12;
  }

  if (resolveImageUrl(tags)) {
    score += 6;
  }

  return clamp(score, 20, 99);
}

export async function runOsmAdapter(town: LoadedTown): Promise<AdapterResult> {
  const query = buildTownAreaQuery(
    town.name,
    town.aliases.map((alias) => alias.name),
  );

  const response = await fetch(overpassEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "User-Agent": userAgent,
    },
    body: query,
  });

  if (!response.ok) {
    return {
      adapterName: "osmAdapter",
      sourceChecks: [
        {
          adapter: "osmAdapter",
          sourceName: "OpenStreetMap / Overpass",
          sourceType: SourceType.OPENSTREETMAP,
          sourceUrl: overpassEndpoint,
          reuseStatus: SourceReuseStatus.ALLOWED,
          status: "skipped",
          note: `Town query failed with status ${response.status}.`,
        },
      ],
      listings: [],
      notes: [],
    };
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] };
  const rawElements = payload.elements ?? [];
  const listings: CandidateListing[] = [];

  for (const element of rawElements) {
    const tags = element.tags ?? {};
    const classification = classify(tags);
    const name = normalizeWhitespace(tags.name ?? tags.brand ?? tags.operator ?? "");
    const coordinates = getCoordinates(element);

    if (!classification || !name || !coordinates) {
      continue;
    }

    const closed = isClosed(tags);

    listings.push({
      sourceType: SourceType.OPENSTREETMAP,
      sourceName: "OpenStreetMap / Overpass",
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      sourceKey: `osm:${element.type}:${element.id}`,
      reuseStatus: SourceReuseStatus.ALLOWED,
      license: "ODbL 1.0",
      name,
      categorySlug: classification.categorySlug,
      subcategory: classification.subcategory,
      townName: town.name,
      localityName:
        tags["addr:place"] ??
        tags["addr:suburb"] ??
        tags["addr:hamlet"] ??
        tags["addr:village"] ??
        undefined,
      address: buildAddress(tags, town.name),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      phone: tags["contact:phone"] ?? tags.phone ?? undefined,
      email: tags["contact:email"] ?? tags.email ?? undefined,
      website: tags["contact:website"] ?? tags.website ?? tags.url ?? undefined,
      socialLinks: buildSocialLinks(tags),
      openingHoursText: tags.opening_hours ?? undefined,
      shortDescription: `${classification.subcategory?.replace(/_/g, " ") ?? "local"} listing imported from OpenStreetMap.`,
      description: buildDescription(name, town.name, classification.subcategory),
      imageUrl: resolveImageUrl(tags),
      confidence: closed ? clamp(computeConfidence(tags) - 30, 0, 80) : computeConfidence(tags),
      verificationStatus: closed
        ? VerificationStatus.REPORTED_STALE
        : VerificationStatus.OPEN_DATA,
      isLikelyClosed: closed,
      staleReason: closed ? "OSM lifecycle or opening-hours tags suggest closure." : undefined,
      rawData: tags,
      discoveredAt: new Date().toISOString(),
    });
  }

  return {
    adapterName: "osmAdapter",
    sourceChecks: [
      {
        adapter: "osmAdapter",
        sourceName: "OpenStreetMap / Overpass",
        sourceType: SourceType.OPENSTREETMAP,
        sourceUrl: overpassEndpoint,
        reuseStatus: SourceReuseStatus.ALLOWED,
        status: "used",
        note: `Fetched ${rawElements.length} raw map elements and converted ${listings.length} named public-facing listings, including stale candidates when OSM lifecycle tags suggested closure.`,
      },
    ],
    listings,
    notes: [
      "OSM is the main legally reusable listing source in this pilot.",
      "Unnamed generic map features were excluded.",
    ],
  };
}
