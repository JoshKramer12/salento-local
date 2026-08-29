export type SelectedAddress = {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  streetNumber: string | null;
  route: string | null;
  locality: string | null;
  administrativeAreaLevel2: string | null;
  administrativeAreaLevel1: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string | null;
};

export type AddressComponentLike = {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
};

export type PlaceDetailsLike = {
  addressComponents?: AddressComponentLike[] | null;
  displayName?: string | null;
  formattedAddress?: string | null;
  id?: string | null;
  location?: {
    lat?: (() => number) | number | null;
    latitude?: number | null;
    lng?: (() => number) | number | null;
    longitude?: number | null;
  } | null;
};

export type StoredAddressFields = {
  address: string | null | undefined;
  addressCountry?: string | null | undefined;
  addressCountryCode?: string | null | undefined;
  addressLatitude?: number | string | null | undefined;
  addressLocality?: string | null | undefined;
  addressLongitude?: number | string | null | undefined;
  addressPlaceId?: string | null | undefined;
  addressPostalCode?: string | null | undefined;
  addressProvince?: string | null | undefined;
  addressRegion?: string | null | undefined;
  addressRoute?: string | null | undefined;
  addressStreetNumber?: string | null | undefined;
};

export type AddressSelectionStorage = {
  address: string;
  addressCountry: string | null;
  addressCountryCode: string | null;
  addressLatitude: number;
  addressLocality: string | null;
  addressLongitude: number;
  addressPlaceId: string;
  addressPostalCode: string | null;
  addressProvince: string | null;
  addressRegion: string | null;
  addressRoute: string | null;
  addressStreetNumber: string | null;
};

const ADDRESS_COMPONENT_LOCALITY_TYPES = [
  "locality",
  "postal_town",
  "administrative_area_level_3",
] as const;

export const SALENTO_LOCATION_BIAS = {
  center: {
    lat: 40.255,
    lng: 18.095,
  },
  radius: 45_000,
} as const;

export function getAddressSuggestionsMaxHeight(
  inputBottom: number,
  viewportBottom: number,
) {
  const availableHeight = viewportBottom - inputBottom - 24;

  return Math.max(96, Math.min(288, availableHeight));
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toCoordinateValue(
  value: number | string | null | undefined | (() => number),
) {
  if (typeof value === "function") {
    return toCoordinateValue(value());
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function findAddressComponent(
  addressComponents: AddressComponentLike[] | null | undefined,
  acceptedTypes: readonly string[],
) {
  return (
    addressComponents?.find((component) =>
      component.types?.some((type) => acceptedTypes.includes(type)),
    ) ?? null
  );
}

function getAddressComponentLongText(
  addressComponents: AddressComponentLike[] | null | undefined,
  acceptedTypes: readonly string[],
) {
  return trimOrNull(findAddressComponent(addressComponents, acceptedTypes)?.longText);
}

function getAddressComponentShortText(
  addressComponents: AddressComponentLike[] | null | undefined,
  acceptedTypes: readonly string[],
) {
  return trimOrNull(findAddressComponent(addressComponents, acceptedTypes)?.shortText);
}

function getLocalityValue(addressComponents: AddressComponentLike[] | null | undefined) {
  for (const type of ADDRESS_COMPONENT_LOCALITY_TYPES) {
    const match = getAddressComponentLongText(addressComponents, [type]);

    if (match) {
      return match;
    }
  }

  return null;
}

export function normalizeAddressSelectionValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isValidSelectedAddress(value: SelectedAddress | null | undefined): value is SelectedAddress {
  if (!value) {
    return false;
  }

  return Boolean(
    value.placeId.trim() &&
      value.formattedAddress.trim() &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      value.latitude >= -90 &&
      value.latitude <= 90 &&
      value.longitude >= -180 &&
      value.longitude <= 180,
  );
}

export function shouldInvalidateSelectedAddress(
  query: string,
  selectedAddress: SelectedAddress | null | undefined,
) {
  if (!selectedAddress) {
    return false;
  }

  const normalizedQuery = normalizeAddressSelectionValue(query);
  const normalizedFormattedAddress = normalizeAddressSelectionValue(selectedAddress.formattedAddress);
  const normalizedStreetAddress = normalizeAddressSelectionValue(
    buildStreetAddressLine(selectedAddress),
  );

  return ![normalizedFormattedAddress, normalizedStreetAddress].includes(normalizedQuery);
}

export function buildStreetAddressLine(
  address: Pick<SelectedAddress, "formattedAddress" | "route" | "streetNumber">,
) {
  const streetLine = [address.route?.trim(), address.streetNumber?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  return streetLine || address.formattedAddress.trim();
}

export function buildSelectedAddressFromPlaceDetails(place: PlaceDetailsLike) {
  const placeId = trimOrNull(place.id);
  const formattedAddress = trimOrNull(place.formattedAddress);
  const latitude =
    toCoordinateValue(place.location?.lat) ??
    toCoordinateValue(place.location?.latitude);
  const longitude =
    toCoordinateValue(place.location?.lng) ??
    toCoordinateValue(place.location?.longitude);

  if (!placeId || !formattedAddress || latitude === null || longitude === null) {
    return null;
  }

  const addressComponents = place.addressComponents ?? [];

  const selectedAddress: SelectedAddress = {
    administrativeAreaLevel1: getAddressComponentLongText(addressComponents, [
      "administrative_area_level_1",
    ]),
    administrativeAreaLevel2: getAddressComponentLongText(addressComponents, [
      "administrative_area_level_2",
    ]),
    country: getAddressComponentLongText(addressComponents, ["country"]),
    countryCode: getAddressComponentShortText(addressComponents, ["country"]),
    formattedAddress,
    latitude,
    locality: getLocalityValue(addressComponents),
    longitude,
    placeId,
    postalCode: getAddressComponentLongText(addressComponents, ["postal_code"]),
    route: getAddressComponentLongText(addressComponents, ["route"]),
    streetNumber: getAddressComponentLongText(addressComponents, ["street_number"]),
  };

  return isValidSelectedAddress(selectedAddress) ? selectedAddress : null;
}

export function buildSelectedAddressFromStoredFields(fields: StoredAddressFields) {
  const selectedAddress: SelectedAddress = {
    administrativeAreaLevel1: trimOrNull(fields.addressRegion),
    administrativeAreaLevel2: trimOrNull(fields.addressProvince),
    country: trimOrNull(fields.addressCountry),
    countryCode: trimOrNull(fields.addressCountryCode),
    formattedAddress: trimOrNull(fields.address) ?? "",
    latitude: toCoordinateValue(fields.addressLatitude) ?? Number.NaN,
    locality: trimOrNull(fields.addressLocality),
    longitude: toCoordinateValue(fields.addressLongitude) ?? Number.NaN,
    placeId: trimOrNull(fields.addressPlaceId) ?? "",
    postalCode: trimOrNull(fields.addressPostalCode),
    route: trimOrNull(fields.addressRoute),
    streetNumber: trimOrNull(fields.addressStreetNumber),
  };

  return isValidSelectedAddress(selectedAddress) ? selectedAddress : null;
}

export function buildAddressSelectionStorage(address: SelectedAddress): AddressSelectionStorage {
  return {
    address: address.formattedAddress,
    addressCountry: address.country,
    addressCountryCode: address.countryCode,
    addressLatitude: address.latitude,
    addressLocality: address.locality,
    addressLongitude: address.longitude,
    addressPlaceId: address.placeId,
    addressPostalCode: address.postalCode,
    addressProvince: address.administrativeAreaLevel2,
    addressRegion: address.administrativeAreaLevel1,
    addressRoute: address.route,
    addressStreetNumber: address.streetNumber,
  };
}

export function buildGoogleMapsSearchUrl(address: Pick<SelectedAddress, "formattedAddress" | "placeId">) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", address.formattedAddress);

  if (address.placeId) {
    url.searchParams.set("query_place_id", address.placeId);
  }

  return url.toString();
}

export function buildGoogleMapsDirectionsUrl(
  address:
    | Pick<SelectedAddress, "latitude" | "longitude" | "placeId">
    | null
    | undefined,
) {
  if (!address) {
    return null;
  }

  const latitude = toCoordinateValue(address.latitude);
  const longitude = toCoordinateValue(address.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${latitude},${longitude}`);

  if (address.placeId?.trim()) {
    url.searchParams.set("destination_place_id", address.placeId.trim());
  }

  return url.toString();
}
