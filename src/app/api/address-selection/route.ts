import { NextResponse } from "next/server";

import {
  buildSelectedAddressFromPlaceDetails,
  isValidSelectedAddress,
  type AddressComponentLike,
  type PlaceDetailsLike,
} from "@/lib/address-selection";
import { getGoogleMapsApiKey } from "@/lib/google-maps-api-key";

export const runtime = "nodejs";

const GOOGLE_GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";

type GooglePlaceDetailsResponse = {
  addressComponents?: AddressComponentLike[];
  formattedAddress?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type GoogleGeocodingResponse = {
  results?: Array<{
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    place_id?: string;
  }>;
  status?: string;
};

function normalizeLocale(value: string | null) {
  return value === "en" ? "en" : "it";
}

function buildAddressQuery({
  address,
  province,
  region,
  town,
}: {
  address: string;
  province: string;
  region: string;
  town: string;
}) {
  return [address, town, province, region, "Italy"].filter(Boolean).join(", ");
}

async function fetchGooglePlaceDetails({
  apiKey,
  locale,
  placeId,
}: {
  apiKey: string;
  locale: "en" | "it";
  placeId: string;
}) {
  const url = new URL(`${GOOGLE_PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", locale);
  url.searchParams.set("regionCode", "IT");

  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
    },
    next: {
      revalidate: 0,
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as GooglePlaceDetailsResponse;
}

function mapGeocodingResultToPlaceDetails(
  result: NonNullable<GoogleGeocodingResponse["results"]>[number],
): PlaceDetailsLike | null {
  if (
    !result.place_id ||
    !result.formatted_address ||
    result.geometry?.location?.lat == null ||
    result.geometry?.location?.lng == null
  ) {
    return null;
  }

  return {
    addressComponents:
      result.address_components?.map((component) => ({
        longText: component.long_name,
        shortText: component.short_name,
        types: component.types,
      })) ?? [],
    formattedAddress: result.formatted_address,
    id: result.place_id,
    location: {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
    },
  };
}

async function geocodeSelectedAddress({
  address,
  apiKey,
  locale,
  province,
  region,
  town,
}: {
  address: string;
  apiKey: string;
  locale: "en" | "it";
  province: string;
  region: string;
  town: string;
}) {
  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set("address", buildAddressQuery({ address, province, region, town }));
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
    return null;
  }

  const payload = (await response.json()) as GoogleGeocodingResponse;

  if (!payload.results?.length || (payload.status && payload.status !== "OK")) {
    return null;
  }

  return mapGeocodingResultToPlaceDetails(payload.results[0] ?? null);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address")?.trim() ?? "";
  const locale = normalizeLocale(searchParams.get("locale"));
  const placeId = searchParams.get("placeId")?.trim() ?? "";
  const province = searchParams.get("province")?.trim() ?? "";
  const region = searchParams.get("region")?.trim() ?? "Puglia";
  const town = searchParams.get("town")?.trim() ?? "";
  const apiKey = getGoogleMapsApiKey();

  if (!address || !town || !apiKey) {
    return NextResponse.json({ selectedAddress: null }, { status: 400 });
  }

  try {
    const placeDetails =
      (placeId
        ? await fetchGooglePlaceDetails({
            apiKey,
            locale,
            placeId,
          })
        : null) ??
      (await geocodeSelectedAddress({
        address,
        apiKey,
        locale,
        province,
        region,
        town,
      }));

    const selectedAddress = placeDetails
      ? buildSelectedAddressFromPlaceDetails(placeDetails)
      : null;

    if (!selectedAddress || !isValidSelectedAddress(selectedAddress)) {
      return NextResponse.json({ selectedAddress: null }, { status: 404 });
    }

    return NextResponse.json({ selectedAddress });
  } catch {
    return NextResponse.json({ selectedAddress: null }, { status: 500 });
  }
}
