import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import rawPhoneNumberMetadata from "libphonenumber-js/metadata.min.json";

const phoneNumberMetadataModule = rawPhoneNumberMetadata as typeof rawPhoneNumberMetadata & {
  default?: typeof rawPhoneNumberMetadata;
};
const phoneNumberMetadata = phoneNumberMetadataModule.default ?? rawPhoneNumberMetadata;

const genericBusinessNameTokens = new Set([
  "albergo",
  "agriturismo",
  "bar",
  "bistro",
  "bistrot",
  "cafe",
  "caffe",
  "farmacia",
  "gelateria",
  "hotel",
  "locanda",
  "market",
  "masseria",
  "negozio",
  "osteria",
  "panificio",
  "pizzeria",
  "pub",
  "restaurant",
  "ristorante",
  "shop",
  "stabilimento",
  "trattoria",
]);

const businessNameStopWords = new Set([
  "a",
  "al",
  "alla",
  "and",
  "da",
  "dal",
  "dalla",
  "de",
  "del",
  "della",
  "di",
  "il",
  "la",
  "le",
  "lo",
  "the",
]);

export function normalizeDuplicateBusinessName(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[\u0027\u0060\u00b4\u02bb\u02bc\u2018\u2019\u201b]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Produces a small, town-scoped set of database search terms that can locate
 * candidates before their fully normalized names are compared in memory.
 * Short edge fragments bridge harmless punctuation and accent differences
 * without widening the query to the entire directory.
 */
export function getBusinessNameCandidateSearchTerms(value: string | null | undefined) {
  const originalTokens = (value ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedTokens = getSignificantBusinessNameTokens(value);
  const terms = new Set<string>();

  for (const token of [...originalTokens, ...normalizedTokens]) {
    const normalizedToken = normalizeDuplicateBusinessName(token);

    if (
      token.length < 3 ||
      genericBusinessNameTokens.has(normalizedToken) ||
      businessNameStopWords.has(normalizedToken)
    ) {
      continue;
    }

    terms.add(token);
    terms.add(token.slice(0, 3));

    if (token.length >= 6) {
      terms.add(token.slice(-4));
    }

    if (token.length >= 7) {
      terms.add(token.slice(2, 7));
    }
  }

  return [...terms].slice(0, 12);
}

export function getSignificantBusinessNameTokens(value: string | null | undefined) {
  return normalizeDuplicateBusinessName(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !genericBusinessNameTokens.has(token) &&
        !businessNameStopWords.has(token),
    );
}

function getEditDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

export type BusinessNameMatchStrength = "exact" | "fuzzy" | null;

export function getBusinessNameMatchStrength(
  left: string | null | undefined,
  right: string | null | undefined,
): BusinessNameMatchStrength {
  const normalizedLeft = normalizeDuplicateBusinessName(left);
  const normalizedRight = normalizeDuplicateBusinessName(right);
  const leftTokens = getSignificantBusinessNameTokens(left);
  const rightTokens = getSignificantBusinessNameTokens(right);

  // A generic label such as "Bar" or "Hotel" is not an identity signal by itself.
  if (!leftTokens.length || !rightTokens.length) {
    return null;
  }

  if (normalizedLeft === normalizedRight) {
    return "exact";
  }

  const leftValue = leftTokens.join(" ");
  const rightValue = rightTokens.join(" ");
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const sharedTokenCount = [...leftSet].filter((token) => rightSet.has(token)).length;
  const unionSize = new Set([...leftSet, ...rightSet]).size;
  const tokenSimilarity = unionSize ? sharedTokenCount / unionSize : 0;
  const longestLength = Math.max(leftValue.length, rightValue.length);
  const editSimilarity = longestLength
    ? 1 - getEditDistance(leftValue, rightValue) / longestLength
    : 0;

  // This is intentionally stricter than a general-purpose fuzzy matcher. It
  // allows a small typo or pluralization but avoids matching merely related names.
  if (editSimilarity >= 0.88 || (sharedTokenCount >= 2 && tokenSimilarity >= 0.8)) {
    return "fuzzy";
  }

  return null;
}

export function isBusinessNameDuplicateSignal(input: {
  addressMatches: boolean;
  matchStrength: BusinessNameMatchStrength;
  phoneMatches: boolean;
  sameTown: boolean;
}) {
  if (!input.matchStrength) {
    return false;
  }

  // Exact normalized names are strong within the same town. A fuzzy name must
  // likewise have local context or another independently strong identifier.
  return input.sameTown || input.addressMatches || input.phoneMatches;
}

export function areBusinessNamesCrediblySimilar(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  return Boolean(getBusinessNameMatchStrength(left, right));
}

export function normalizeDuplicatePhone(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  const parsed = parsePhoneNumberFromString(trimmed, "IT", phoneNumberMetadata);

  if (parsed) {
    return parsed.number.replace(/\D+/g, "");
  }

  return trimmed.replace(/\D+/g, "").replace(/^00/, "");
}

export function normalizedAddressValuesMatch(
  leftValues: Array<string | null | undefined>,
  rightValues: Array<string | null | undefined>,
) {
  const normalize = (value: string | null | undefined) =>
    (value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const left = leftValues.map(normalize).filter(Boolean);
  const right = rightValues.map(normalize).filter(Boolean);

  return left.some((leftValue) =>
    right.some(
      (rightValue) =>
        leftValue === rightValue ||
        leftValue.startsWith(`${rightValue} `) ||
        rightValue.startsWith(`${leftValue} `),
    ),
  );
}

export function hasCredibleDuplicateMatches(matches: readonly unknown[] | null | undefined) {
  return Boolean(matches?.length);
}
