import { clamp, isTruthyString } from "./normalize";
import type { CandidateListing, LoadedTown } from "./types";

export function computeFieldCompleteness(listing: {
  address?: string | null;
  email?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openingHoursText?: string | null;
  phone?: string | null;
  website?: string | null;
}) {
  const checks = [
    isTruthyString(listing.address),
    isTruthyString(listing.phone),
    isTruthyString(listing.email),
    isTruthyString(listing.website),
    isTruthyString(listing.openingHoursText),
    typeof listing.latitude === "number" && typeof listing.longitude === "number",
  ];

  const filled = checks.filter(Boolean).length;
  return filled / checks.length;
}

export function computeListingConfidence(candidate: CandidateListing) {
  let score = candidate.confidence;

  score += computeFieldCompleteness(candidate) * 20;

  if (candidate.sourceType === "OPENSTREETMAP") {
    score += 10;
  }

  if (candidate.imageUrl) {
    score += 4;
  }

  if (candidate.isLikelyClosed) {
    score -= 30;
  }

  return clamp(Math.round(score), 0, 100);
}

export function coverageSummaryForTown(town: LoadedTown) {
  const listings = town.businesses.length;
  const population = town.population ?? 0;
  const listingsPer1000 = population ? (listings * 1000) / population : listings;
  const averageConfidence = listings
    ? town.businesses.reduce((sum, business) => sum + business.sourceConfidence, 0) / listings
    : 0;
  const averageFieldCompleteness = listings
    ? town.businesses.reduce(
        (sum, business) => sum + computeFieldCompleteness(business),
        0,
      ) / listings
    : 0;

  return {
    listings,
    listingsPer1000,
    averageConfidence,
    averageFieldCompleteness,
  };
}
