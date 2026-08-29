import { computeFieldCompleteness } from "./confidence";
import type { CoverageSummary, LoadedTown } from "./types";

const coreExpectedCategories = [
  "restaurants",
  "cafes",
  "grocery",
  "pharmacies",
  "shops",
  "services",
  "things-to-do",
  "hotels",
] as const;

const coastalCategories = ["beaches"] as const;

function isCoastalTown(town: LoadedTown) {
  return town.localities.some((locality) => locality.placeType === "MARINA");
}

export function summarizeCoverage(town: LoadedTown): CoverageSummary {
  const counts = new Map<string, number>();

  for (const business of town.businesses) {
    counts.set(business.category.slug, (counts.get(business.category.slug) ?? 0) + 1);
  }

  const expectedCategories = new Set<string>(coreExpectedCategories);
  if (isCoastalTown(town)) {
    for (const slug of coastalCategories) {
      expectedCategories.add(slug);
    }
  }

  const categories = Array.from(
    new Set([...counts.keys(), ...Array.from(expectedCategories)]),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((slug) => {
      const count = counts.get(slug) ?? 0;
      const expected = expectedCategories.has(slug);
      const weak = expected && count === 0;

      return {
        slug,
        count,
        expected,
        weak,
      };
    });

  const listings = town.businesses.length;
  const listingsPer1000 = town.population
    ? (listings * 1000) / town.population
    : listings;
  const averageConfidence = listings
    ? town.businesses.reduce((sum, business) => sum + business.sourceConfidence, 0) /
      listings
    : 0;
  const averageFieldCompleteness = listings
    ? town.businesses.reduce(
        (sum, business) => sum + computeFieldCompleteness(business),
        0,
      ) / listings
    : 0;
  const categoryBreadth = counts.size;

  const breadthScore = Math.min(25, categoryBreadth * 2.5);
  const volumeScore = Math.min(30, listingsPer1000 * 8);
  const detailScore = averageFieldCompleteness * 25;
  const confidenceScore = Math.min(20, averageConfidence / 5);
  const missingExpectedPenalty = categories.filter((category) => category.weak).length * 4;
  const score = Math.max(
    0,
    Math.min(100, breadthScore + volumeScore + detailScore + confidenceScore - missingExpectedPenalty),
  );

  return {
    score: Math.round(score * 10) / 10,
    listings,
    listingsPer1000: Math.round(listingsPer1000 * 100) / 100,
    averageConfidence: Math.round(averageConfidence * 100) / 100,
    averageFieldCompleteness: Math.round(averageFieldCompleteness * 100) / 100,
    categoryBreadth,
    categories,
    weakCategories: categories
      .filter((category) => category.weak)
      .map((category) => category.slug),
  };
}
