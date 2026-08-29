import { parsePhoneNumberFromString } from "libphonenumber-js/core";
import rawPhoneNumberMetadata from "libphonenumber-js/metadata.min.json";

const phoneNumberMetadataModule = rawPhoneNumberMetadata as typeof rawPhoneNumberMetadata & {
  default?: typeof rawPhoneNumberMetadata;
};
const phoneNumberMetadata = phoneNumberMetadataModule.default ?? rawPhoneNumberMetadata;

const genericBusinessNameTokens = new Set([
  "albergo",
  "bar",
  "bistro",
  "bistrot",
  "cafe",
  "caffe",
  "hotel",
  "locanda",
  "osteria",
  "panificio",
  "pizzeria",
  "restaurant",
  "ristorante",
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
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

export function areBusinessNamesCrediblySimilar(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftTokens = getSignificantBusinessNameTokens(left);
  const rightTokens = getSignificantBusinessNameTokens(right);

  // A generic label such as "Bar" or "Hotel" is not an identity signal by itself.
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }

  const leftValue = leftTokens.join(" ");
  const rightValue = rightTokens.join(" ");

  if (leftValue === rightValue) {
    return true;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const sharedTokenCount = [...leftSet].filter((token) => rightSet.has(token)).length;
  const unionSize = new Set([...leftSet, ...rightSet]).size;
  const tokenSimilarity = unionSize ? sharedTokenCount / unionSize : 0;
  const longestLength = Math.max(leftValue.length, rightValue.length);
  const editSimilarity = longestLength
    ? 1 - getEditDistance(leftValue, rightValue) / longestLength
    : 0;

  return editSimilarity >= 0.82 || (sharedTokenCount >= 2 && tokenSimilarity >= 0.67);
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
