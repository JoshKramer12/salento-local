import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  buildSelectedAddressFromPlaceDetails,
  buildSelectedAddressFromStoredFields,
  getAddressSuggestionsMaxHeight,
  isValidSelectedAddress,
  shouldInvalidateSelectedAddress,
} from "@/lib/address-selection";
import { businessSubmissionSubmitSchema } from "@/lib/validation";

function createValidSubmission(overrides: Record<string, unknown> = {}) {
  return {
    address: "Via Roma 14, 73013 Galatina LE, Italy",
    addressCountry: "Italy",
    addressCountryCode: "IT",
    addressLatitude: "40.1742",
    addressLocality: "Galatina",
    addressLongitude: "18.1683",
    addressPlaceId: "place-123",
    addressPostalCode: "73013",
    addressProvince: "Lecce",
    addressRegion: "Puglia",
    addressRoute: "Via Roma",
    addressStreetNumber: "14",
    agreementSignature: "Mario Rossi",
    businessName: "Panificio Roma",
    categoryId: "category-1",
    email: "info@example.com",
    facebook: "",
    googleMapsUrl: "",
    instagram: "",
    longDescription: "Notes collected on site:\n- Fresh bread\n- Local groceries",
    openingHours: JSON.stringify([
      { day: "monday", open1: "08:00", close1: "13:00", split: false, closed: false },
      { day: "tuesday", open1: "08:00", close1: "13:00", split: false, closed: false },
    ]),
    ownerEmail: "owner@example.com",
    ownerHasNoEmail: false,
    ownerName: "Mario Rossi",
    ownerPhone: "+39 333 123 4567",
    paymentMethod: "ONLINE",
    phone: "+39 0836 123456",
    photoUrls: "https://example.com/a.jpg\nhttps://example.com/b.jpg",
    shortDescription: "Fresh bread and local specialties.",
    signerFullName: "Mario Rossi",
    signerRole: "OWNER",
    townId: "town-1",
    website: "",
    whatsapp: "+39 333 123 4567",
    ...overrides,
  };
}

test("buildSelectedAddressFromPlaceDetails keeps Italian structured components", () => {
  const selectedAddress = buildSelectedAddressFromPlaceDetails({
    addressComponents: [
      { longText: "14", types: ["street_number"] },
      { longText: "Via Roma", types: ["route"] },
      { longText: "Galatina", types: ["postal_town"] },
      { longText: "Lecce", types: ["administrative_area_level_2"] },
      { longText: "Puglia", types: ["administrative_area_level_1"] },
      { longText: "73013", types: ["postal_code"] },
      { longText: "Italy", shortText: "IT", types: ["country"] },
    ],
    formattedAddress: "Via Roma 14, 73013 Galatina LE, Italy",
    id: "place-123",
    location: {
      lat: 40.1742,
      lng: 18.1683,
    },
  });

  assert.ok(selectedAddress);
  assert.equal(selectedAddress.locality, "Galatina");
  assert.equal(selectedAddress.route, "Via Roma");
  assert.equal(selectedAddress.streetNumber, "14");
  assert.equal(selectedAddress.countryCode, "IT");
});

test("stored structured fields rebuild a valid selected address", () => {
  const selectedAddress = buildSelectedAddressFromStoredFields({
    address: "Via Roma 14, 73013 Galatina LE, Italy",
    addressCountry: "Italy",
    addressCountryCode: "IT",
    addressLatitude: "40.1742",
    addressLocality: "Galatina",
    addressLongitude: "18.1683",
    addressPlaceId: "place-123",
    addressPostalCode: "73013",
    addressProvince: "Lecce",
    addressRegion: "Puglia",
    addressRoute: "Via Roma",
    addressStreetNumber: "14",
  });

  assert.ok(isValidSelectedAddress(selectedAddress));
  assert.equal(selectedAddress?.placeId, "place-123");
  assert.equal(selectedAddress?.latitude, 40.1742);
  assert.equal(selectedAddress?.longitude, 18.1683);
});

test("selected addresses invalidate only when the typed address meaningfully changes", () => {
  const selectedAddress = buildSelectedAddressFromStoredFields({
    address: "Via Roma 14, 73013 Galatina LE, Italy",
    addressLatitude: "40.1742",
    addressLongitude: "18.1683",
    addressPlaceId: "place-123",
  });

  assert.ok(selectedAddress);
  assert.equal(
    shouldInvalidateSelectedAddress("  Via Roma 14 - 73013 Galatina LE Italy  ", selectedAddress),
    false,
  );
  assert.equal(shouldInvalidateSelectedAddress("Via Roma 16, Galatina", selectedAddress), true);
});

test("submit schema rejects a typed address without a selected Google place", () => {
  const parsed = businessSubmissionSubmitSchema.safeParse(
    createValidSubmission({
      addressCountry: "",
      addressCountryCode: "",
      addressLatitude: "",
      addressLocality: "",
      addressLongitude: "",
      addressPlaceId: "",
      addressPostalCode: "",
      addressProvince: "",
      addressRegion: "",
      addressRoute: "",
      addressStreetNumber: "",
    }),
  );

  assert.equal(parsed.success, false);
  assert.ok(
    parsed.error.issues.some(
      (issue) => issue.path[0] === "address" && issue.message === "invalid_address_selection",
    ),
  );
});

test("submit schema rejects invalid address coordinates", () => {
  const parsed = businessSubmissionSubmitSchema.safeParse(
    createValidSubmission({
      addressLatitude: "not-a-number",
    }),
  );

  assert.equal(parsed.success, false);
  assert.ok(parsed.error.issues.some((issue) => issue.path[0] === "addressLatitude"));
});

test("submit schema accepts a drawn signature and rejects an empty signature", () => {
  const drawnSignature = JSON.stringify({
    strokes: [[{ x: 12, y: 24 }, { x: 40, y: 32 }]],
    version: 1,
  });

  assert.equal(
    businessSubmissionSubmitSchema.safeParse(
      createValidSubmission({ agreementSignature: drawnSignature }),
    ).success,
    true,
  );

  const emptySignature = businessSubmissionSubmitSchema.safeParse(
    createValidSubmission({ agreementSignature: "" }),
  );

  assert.equal(emptySignature.success, false);
  assert.ok(
    emptySignature.error.issues.some((issue) => issue.path[0] === "agreementSignature"),
  );
});

test("maps helpers preserve place ids for search and directions links", () => {
  const searchUrl = buildGoogleMapsSearchUrl({
    formattedAddress: "Via Roma 14, 73013 Galatina LE, Italy",
    placeId: "place-123",
  });
  const directionsUrl = buildGoogleMapsDirectionsUrl({
    latitude: 40.1742,
    longitude: 18.1683,
    placeId: "place-123",
  });

  assert.equal(new URL(searchUrl).searchParams.get("query_place_id"), "place-123");
  assert.equal(new URL(directionsUrl ?? "").searchParams.get("destination_place_id"), "place-123");
});

test("mobile address suggestions use the available visual viewport height", () => {
  assert.equal(getAddressSuggestionsMaxHeight(300, 600), 276);
  assert.equal(getAddressSuggestionsMaxHeight(100, 900), 288);
  assert.equal(getAddressSuggestionsMaxHeight(500, 560), 96);
});
