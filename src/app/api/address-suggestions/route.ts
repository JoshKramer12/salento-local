import { NextResponse } from "next/server";

import { getGoogleMapsApiKey } from "@/lib/google-maps-api-key";

export const runtime = "nodejs";

const ADDRESS_LOOKUP_INTERVAL_MS = 450;
const ADDRESS_LOOKUP_TTL_MS = 1000 * 60 * 60 * 12;
const ADDRESS_LOOKUP_CACHE_VERSION = "v5";
const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_LOCATION_BIAS_RADIUS_METERS = 18_000;

type AddressSuggestionPayload = {
  displayName: string;
  mapsUrl?: string;
  placeId?: string;
  provider: "google" | "openstreetmap";
  secondaryText?: string;
  value: string;
};

type CachedSuggestions = {
  expiresAt: number;
  suggestions: AddressSuggestionPayload[];
};

type NominatimResult = {
  address?: {
    city?: string;
    county?: string;
    country?: string;
    hamlet?: string;
    house_number?: string;
    postcode?: string;
    road?: string;
    state?: string;
    suburb?: string;
    town?: string;
    village?: string;
  };
  display_name?: string;
  name?: string;
  road?: string;
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: {
          text?: string;
        };
        secondaryText?: {
          text?: string;
        };
      };
      text?: {
        text?: string;
      };
    };
  }>;
};

type GoogleGeocodingResponse = {
  results?: Array<{
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    formatted_address?: string;
    partial_match?: boolean;
    place_id?: string;
    types?: string[];
  }>;
  status?: string;
};

type ParsedStreetQuery = {
  houseNumber: string;
  road: string;
};

const addressLookupState = globalThis as typeof globalThis & {
  __salentoAddressLookupCache?: Map<string, CachedSuggestions>;
  __salentoAddressLookupQueue?: Promise<void>;
  __salentoAddressLookupNextAt?: number;
};

const addressLookupCache =
  addressLookupState.__salentoAddressLookupCache ??
  (addressLookupState.__salentoAddressLookupCache = new Map());

let addressLookupQueue =
  addressLookupState.__salentoAddressLookupQueue ?? Promise.resolve();

function updateAddressLookupQueue(queue: Promise<void>) {
  addressLookupQueue = queue;
  addressLookupState.__salentoAddressLookupQueue = queue;
}

function getAddressLookupNextAt() {
  return addressLookupState.__salentoAddressLookupNextAt ?? 0;
}

function setAddressLookupNextAt(value: number) {
  addressLookupState.__salentoAddressLookupNextAt = value;
}

function normalizeLookupValue(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function normalizeRoadComparisonValue(value: string) {
  return normalizeLookupValue(value)
    .split(" ")
    .filter(Boolean)
    .map((token) =>
      ["s", "san", "santo", "santa", "sant"].includes(token) ? "__saint__" : token,
    )
    .join(" ");
}

function canSearchAddress(value: string) {
  const normalized = normalizeLookupValue(value);

  return normalized.length >= 2 || /\d/.test(value);
}

function canFetchRemoteAddressSuggestions(value: string) {
  const normalized = normalizeLookupValue(value);

  return canSearchAddress(value) && /\p{L}/u.test(value) && normalized.length >= 2;
}

function parseStreetQuery(query: string) {
  const trimmed = query.replace(/\s+/g, " ").trim();
  const endsWithNumber = trimmed.match(/^(.*?)(\d+[A-Za-z/-]*)$/);

  if (endsWithNumber?.[1]?.trim()) {
    return {
      houseNumber: endsWithNumber[2],
      road: endsWithNumber[1].trim(),
    };
  }

  const startsWithNumber = trimmed.match(/^(\d+[A-Za-z/-]*)\s+(.*)$/);

  if (startsWithNumber?.[2]?.trim()) {
    return {
      houseNumber: startsWithNumber[1],
      road: startsWithNumber[2].trim(),
    };
  }

  return null;
}

function buildGoogleMapsSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatAddressValue(value: string) {
  return value
    .replace(/,\s*(Italia|Italy)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSuggestion(
  value: string,
  provider: "google" | "openstreetmap",
  displayName = value,
  {
    placeId,
    secondaryText,
  }: {
    placeId?: string;
    secondaryText?: string;
  } = {},
): AddressSuggestionPayload | null {
  const normalizedValue = formatAddressValue(value);

  if (!normalizedValue) {
    return null;
  }

  return {
    displayName: formatAddressValue(displayName),
    mapsUrl: buildGoogleMapsSearchUrl(normalizedValue),
    placeId: placeId?.trim() || undefined,
    provider,
    secondaryText: secondaryText?.trim() || undefined,
    value: normalizedValue,
  };
}

function dedupeSuggestions(suggestions: AddressSuggestionPayload[]) {
  return Array.from(
    new Map(
      suggestions
        .filter((entry) => entry.value.trim().length > 0)
        .map((entry) => [normalizeLookupValue(entry.value), entry]),
    ).values(),
  );
}

function extractAddressParts(result: NominatimResult) {
  const road = result.address?.road?.trim() ?? result.road?.trim() ?? result.name?.trim() ?? "";
  const houseNumber = result.address?.house_number?.trim() ?? "";
  const place =
    result.address?.village?.trim() ??
    result.address?.town?.trim() ??
    result.address?.city?.trim() ??
    result.address?.hamlet?.trim() ??
    result.address?.suburb?.trim() ??
    "";
  const postcode = result.address?.postcode?.trim() ?? "";

  return {
    displayName: result.display_name?.trim() ?? "",
    houseNumber,
    place,
    postcode,
    road,
  };
}

function buildAddressValue({
  houseNumber,
  houseNumberFirst = false,
  place,
  postcode,
  road,
}: {
  houseNumber?: string;
  houseNumberFirst?: boolean;
  place?: string;
  postcode?: string;
  road?: string;
}) {
  const streetLine =
    houseNumber && road
      ? houseNumberFirst
        ? `${houseNumber} ${road}`.trim()
        : `${road} ${houseNumber}`.trim()
      : [road, houseNumber].filter(Boolean).join(" ").trim();

  if (streetLine) {
    return [streetLine, place, postcode].filter(Boolean).join(", ").trim();
  }

  return "";
}

function pickAddressValue(result: NominatimResult) {
  const parts = extractAddressParts(result);
  const streetValue = buildAddressValue(parts);

  if (streetValue) {
    return streetValue;
  }

  const displayName = parts.displayName;

  if (!displayName) {
    return "";
  }

  return displayName.split(",").slice(0, 3).join(", ").trim();
}

function roadMatchesQuery(road: string, parsedStreet: ParsedStreetQuery) {
  return normalizeRoadComparisonValue(road) === normalizeRoadComparisonValue(parsedStreet.road);
}

function addressMatchesParsedStreet(address: string, parsedStreet: ParsedStreetQuery) {
  const firstSegment = address.split(",")[0]?.trim() ?? "";
  const parsedAddress = parseStreetQuery(firstSegment);

  if (!parsedAddress) {
    return false;
  }

  return (
    normalizeRoadComparisonValue(parsedAddress.road) ===
      normalizeRoadComparisonValue(parsedStreet.road) &&
    normalizeLookupValue(parsedAddress.houseNumber) === normalizeLookupValue(parsedStreet.houseNumber)
  );
}

function resultMatchesParsedStreet(result: NominatimResult, parsedStreet: ParsedStreetQuery) {
  const parts = extractAddressParts(result);

  return Boolean(
    parts.road &&
      parts.houseNumber &&
      normalizeRoadComparisonValue(parts.road) === normalizeRoadComparisonValue(parsedStreet.road) &&
      normalizeLookupValue(parts.houseNumber) === normalizeLookupValue(parsedStreet.houseNumber),
  );
}

function isProfessionalAddress(address: string) {
  const segments = address
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const streetLine = segments[0] ?? "";

  return (
    segments.length >= 2 &&
    (/\d/.test(streetLine) ||
      /\b(via|viale|corso|piazza|strada|largo|lungomare|vicolo|contrada|provinciale|sp|ss)\b/i.test(
        streetLine,
      ))
  );
}

function resultMatchesTown(result: NominatimResult, town: string) {
  const normalizedTown = normalizeLookupValue(town);
  const parts = extractAddressParts(result);
  const displaySegments = parts.displayName
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const localitySegment = displaySegments[1] ?? displaySegments[0] ?? "";
  const locality = parts.place || localitySegment;

  return Boolean(locality) && normalizeLookupValue(locality) === normalizedTown;
}

function getCacheKey(
  query: string,
  town: string,
  province: string,
  region: string,
  locale: "en" | "it",
) {
  return `${ADDRESS_LOOKUP_CACHE_VERSION}:${locale}:${normalizeLookupValue(
    region,
  )}:${normalizeLookupValue(province)}:${normalizeLookupValue(town)}:${normalizeLookupValue(query)}`;
}

function readCachedSuggestions(
  query: string,
  town: string,
  province: string,
  region: string,
  locale: "en" | "it",
) {
  const key = getCacheKey(query, town, province, region, locale);
  const cached = addressLookupCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    addressLookupCache.delete(key);
    return null;
  }

  return cached.suggestions;
}

function cacheSuggestions(
  query: string,
  town: string,
  province: string,
  region: string,
  locale: "en" | "it",
  suggestions: AddressSuggestionPayload[],
) {
  if (!suggestions.length) {
    return;
  }

  addressLookupCache.set(getCacheKey(query, town, province, region, locale), {
    expiresAt: Date.now() + ADDRESS_LOOKUP_TTL_MS,
    suggestions,
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAddressLookup(url: URL, locale: "en" | "it") {
  let response: Response;

  const task = addressLookupQueue.then(async () => {
    const waitMs = Math.max(0, getAddressLookupNextAt() - Date.now());

    if (waitMs > 0) {
      await delay(waitMs);
    }

    setAddressLookupNextAt(Date.now() + ADDRESS_LOOKUP_INTERVAL_MS);
    response = await fetch(url, {
      headers: {
        "accept-language": locale === "it" ? "it,en;q=0.8" : "en,it;q=0.8",
        "user-agent": "SalentoDirectory/1.0 address lookup",
      },
      next: {
        revalidate: 0,
      },
    });
  });

  updateAddressLookupQueue(task.catch(() => undefined));
  await task;

  return response!;
}

function predictionMatchesTown(
  prediction: NonNullable<GoogleAutocompleteResponse["suggestions"]>[number],
  town: string,
) {
  const normalizedTown = normalizeLookupValue(town);
  const predictionText =
    prediction.placePrediction?.structuredFormat?.secondaryText?.text ??
    prediction.placePrediction?.text?.text ??
    "";

  return normalizeLookupValue(predictionText).includes(normalizedTown);
}

async function fetchGoogleAutocompleteSuggestions({
  apiKey,
  latitude,
  locale,
  longitude,
  query,
  sessionToken,
  town,
}: {
  apiKey: string;
  latitude?: number;
  locale: "en" | "it";
  longitude?: number;
  query: string;
  sessionToken?: string;
  town: string;
}) {
  const body: Record<string, unknown> = {
    includeQueryPredictions: false,
    includedRegionCodes: ["it"],
    input: query,
    languageCode: locale,
  };

  if (sessionToken) {
    body.sessionToken = sessionToken;
  }

  if (typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude)) {
    body.locationBias = {
      circle: {
        center: {
          latitude,
          longitude,
        },
        radius: GOOGLE_LOCATION_BIAS_RADIUS_METERS,
      },
    };
  }

  const response = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    method: "POST",
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as GoogleAutocompleteResponse;
  const predictions = payload.suggestions?.filter((entry) => entry.placePrediction) ?? [];
  const townMatchedPredictions = predictions.filter((entry) => predictionMatchesTown(entry, town));
  const sourcePredictions = townMatchedPredictions.length ? townMatchedPredictions : predictions;

  return dedupeSuggestions(
    sourcePredictions
      .map((entry) => {
        const prediction = entry.placePrediction;
        const value =
          prediction?.text?.text?.trim() ||
          [
            prediction?.structuredFormat?.mainText?.text?.trim(),
            prediction?.structuredFormat?.secondaryText?.text?.trim(),
          ]
            .filter(Boolean)
            .join(", ");

        return value
          ? buildSuggestion(value, "google", value, {
              placeId: prediction?.placeId,
              secondaryText: prediction?.structuredFormat?.secondaryText?.text,
            })
          : null;
      })
      .filter((entry): entry is AddressSuggestionPayload => Boolean(entry)),
  );
}

function geocodeResultMatchesTown(
  result: NonNullable<GoogleGeocodingResponse["results"]>[number],
  town: string,
) {
  const normalizedTown = normalizeLookupValue(town);
  const localities =
    result.address_components
      ?.filter((component) =>
        component.types?.some((type) =>
          ["locality", "postal_town", "administrative_area_level_3"].includes(type),
        ),
      )
      .flatMap((component) => [component.long_name ?? "", component.short_name ?? ""])
      .filter(Boolean) ?? [];

  if (localities.some((value) => normalizeLookupValue(value) === normalizedTown)) {
    return true;
  }

  return normalizeLookupValue(result.formatted_address ?? "").includes(normalizedTown);
}

function geocodeResultHasStreetNumber(
  result: NonNullable<GoogleGeocodingResponse["results"]>[number],
) {
  return Boolean(
    result.address_components?.some((component) => component.types?.includes("street_number")),
  );
}

async function fetchGoogleGeocodingSuggestions({
  apiKey,
  locale,
  province,
  query,
  region,
  town,
}: {
  apiKey: string;
  locale: "en" | "it";
  province: string;
  query: string;
  region: string;
  town: string;
}) {
  const parsedStreet = parseStreetQuery(query);
  const url = new URL(GOOGLE_GEOCODING_URL);
  const addressQuery = [query, town, province, region, "Italy"].filter(Boolean).join(", ");

  url.searchParams.set("address", addressQuery);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", locale);
  url.searchParams.set(
    "components",
    ["country:IT", town ? `locality:${town}` : "", province ? `administrative_area:${province}` : ""]
      .filter(Boolean)
      .join("|"),
  );

  const response = await fetch(url, {
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as GoogleGeocodingResponse;

  if (!payload.results?.length || (payload.status && payload.status !== "OK")) {
    return [];
  }

  const exactResults = payload.results.filter((result) => {
    if (!result.formatted_address || !geocodeResultMatchesTown(result, town)) {
      return false;
    }

    if (parsedStreet) {
      if (result.partial_match || !geocodeResultHasStreetNumber(result)) {
        return false;
      }

      return addressMatchesParsedStreet(formatAddressValue(result.formatted_address), parsedStreet);
    }

    return !result.partial_match;
  });

  return dedupeSuggestions(
    exactResults
      .map((result) =>
        result.formatted_address
          ? buildSuggestion(result.formatted_address, "google", result.formatted_address, {
              placeId: result.place_id,
            })
          : null,
      )
      .filter((entry): entry is AddressSuggestionPayload => Boolean(entry)),
  );
}

async function fetchOpenStreetMapSuggestions({
  locale,
  province,
  query,
  region,
  town,
}: {
  locale: "en" | "it";
  province: string;
  query: string;
  region: string;
  town: string;
}) {
  const queryVariants = new Set<string>();
  const parsedStreet = parseStreetQuery(query);
  const queryLocation = [town, province, region, "Italy"].filter(Boolean).join(", ");

  queryVariants.add(`${query}, ${queryLocation}`);

  if (parsedStreet) {
    queryVariants.add(
      `${parsedStreet.road} ${parsedStreet.houseNumber}, ${queryLocation}`,
    );
    queryVariants.add(
      `${parsedStreet.road}, ${parsedStreet.houseNumber}, ${queryLocation}`,
    );
    queryVariants.add(
      `${parsedStreet.houseNumber} ${parsedStreet.road}, ${queryLocation}`,
    );
    queryVariants.add(`${parsedStreet.road}, ${queryLocation}`);
  }

  const urls = Array.from(queryVariants).map((value) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", value);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "it");
    url.searchParams.set("limit", "8");

    return url;
  });

  if (parsedStreet) {
    const structuredUrl = new URL("https://nominatim.openstreetmap.org/search");
    structuredUrl.searchParams.set(
      "street",
      `${parsedStreet.road} ${parsedStreet.houseNumber}`.trim(),
    );
    structuredUrl.searchParams.set("city", town);
    if (province) {
      structuredUrl.searchParams.set("county", province);
    }
    structuredUrl.searchParams.set("state", region);
    structuredUrl.searchParams.set("country", "Italy");
    structuredUrl.searchParams.set("format", "jsonv2");
    structuredUrl.searchParams.set("addressdetails", "1");
    structuredUrl.searchParams.set("countrycodes", "it");
    structuredUrl.searchParams.set("limit", "8");
    urls.unshift(structuredUrl);

    const roadOnlyStructuredUrl = new URL("https://nominatim.openstreetmap.org/search");
    roadOnlyStructuredUrl.searchParams.set("street", parsedStreet.road);
    roadOnlyStructuredUrl.searchParams.set("city", town);
    if (province) {
      roadOnlyStructuredUrl.searchParams.set("county", province);
    }
    roadOnlyStructuredUrl.searchParams.set("state", region);
    roadOnlyStructuredUrl.searchParams.set("country", "Italy");
    roadOnlyStructuredUrl.searchParams.set("format", "jsonv2");
    roadOnlyStructuredUrl.searchParams.set("addressdetails", "1");
    roadOnlyStructuredUrl.searchParams.set("countrycodes", "it");
    roadOnlyStructuredUrl.searchParams.set("limit", "8");
    urls.push(roadOnlyStructuredUrl);
  }

  const payload: NominatimResult[] = [];

  for (const url of urls) {
    const response = await fetchAddressLookup(url, locale);

    if (response.status === 429) {
      break;
    }

    if (!response.ok) {
      continue;
    }

    const results = (await response.json()) as NominatimResult[];

    payload.push(...results);

    const hasUsefulMatch = parsedStreet
      ? payload.some(
          (result) =>
            resultMatchesTown(result, town) && resultMatchesParsedStreet(result, parsedStreet),
        )
      : payload.some((result) => resultMatchesTown(result, town));

    if (hasUsefulMatch) {
      break;
    }
  }

  const townMatchedPayload = payload.filter((result) => resultMatchesTown(result, town));
  const uniqueSuggestions = new Map<
    string,
    { displayName: string; priority: number; value: string }
  >();

  function registerSuggestion(value: string, displayName: string, priority: number) {
    const normalizedKey = value.toLowerCase();
    const existing = uniqueSuggestions.get(normalizedKey);

    if (!existing || priority > existing.priority) {
      uniqueSuggestions.set(normalizedKey, {
        displayName,
        priority,
        value,
      });
    }
  }

  for (const result of townMatchedPayload) {
    const value = pickAddressValue(result);

    if (!value) {
      continue;
    }

    const parts = extractAddressParts(result);
    const roadMatch = parsedStreet && parts.road ? roadMatchesQuery(parts.road, parsedStreet) : false;
    const exactHouseNumberMatch =
      parsedStreet &&
      parts.houseNumber &&
      normalizeLookupValue(parts.houseNumber) === normalizeLookupValue(parsedStreet.houseNumber);

    registerSuggestion(
      value,
      value,
      exactHouseNumberMatch ? 120 : roadMatch ? 80 : 40,
    );
  }

  const suggestions = Array.from(uniqueSuggestions.values())
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.value.length - right.value.length ||
        left.value.localeCompare(right.value, locale),
    )
    .map(({ displayName, value }) => buildSuggestion(value, "openstreetmap", displayName))
    .filter((entry): entry is AddressSuggestionPayload => Boolean(entry));

  const narrowedSuggestions =
    parsedStreet
      ? suggestions.filter(
          (entry) =>
            isProfessionalAddress(entry.value) &&
            addressMatchesParsedStreet(entry.value, parsedStreet),
        )
      : [];

  return narrowedSuggestions.length ? narrowedSuggestions.slice(0, 1) : suggestions;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const town = searchParams.get("town")?.trim() ?? "";
  const province = searchParams.get("province")?.trim() ?? "";
  const region = searchParams.get("region")?.trim() ?? "Puglia";
  const locale = searchParams.get("locale")?.trim() === "en" ? "en" : "it";
  const latitude = Number(searchParams.get("latitude")?.trim() ?? "");
  const longitude = Number(searchParams.get("longitude")?.trim() ?? "");
  const sessionToken = searchParams.get("sessionToken")?.trim() ?? "";

  if (!canFetchRemoteAddressSuggestions(query) || !town) {
    return NextResponse.json({ suggestions: [] });
  }

  const cachedSuggestions = readCachedSuggestions(query, town, province, region, locale);

  if (cachedSuggestions) {
    return NextResponse.json({ suggestions: cachedSuggestions });
  }

  const googleApiKey = getGoogleMapsApiKey();

  if (googleApiKey) {
    try {
      const googleAutocompleteSuggestions = await fetchGoogleAutocompleteSuggestions({
        apiKey: googleApiKey,
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        locale,
        longitude: Number.isFinite(longitude) ? longitude : undefined,
        query,
        sessionToken,
        town,
      });
      const parsedStreet = parseStreetQuery(query);
      const hasExactGoogleMatch = parsedStreet
        ? googleAutocompleteSuggestions.some((entry) =>
            addressMatchesParsedStreet(entry.value, parsedStreet),
          )
        : googleAutocompleteSuggestions.length > 0;
      const googleGeocodingSuggestions =
        parsedStreet && !hasExactGoogleMatch
          ? await fetchGoogleGeocodingSuggestions({
              apiKey: googleApiKey,
              locale,
              province,
              query,
              region,
              town,
            })
          : [];
      const googleSuggestions = dedupeSuggestions([
        ...googleGeocodingSuggestions,
        ...googleAutocompleteSuggestions,
      ]);

      if (googleSuggestions.length) {
        cacheSuggestions(query, town, province, region, locale, googleSuggestions);
        return NextResponse.json({ suggestions: googleSuggestions });
      }
    } catch {
      // If Google is temporarily unavailable, keep the publish flow working with the fallback provider.
    }
  }

  const fallbackSuggestions = await fetchOpenStreetMapSuggestions({
    locale,
    province,
    query,
    region,
    town,
  });

  cacheSuggestions(query, town, province, region, locale, fallbackSuggestions);

  return NextResponse.json({ suggestions: fallbackSuggestions });
}
