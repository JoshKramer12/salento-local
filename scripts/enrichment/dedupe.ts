import {
  haversineKm,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeWebsite,
  tokenSimilarity,
} from "./normalize";
import type {
  CandidateListing,
  DedupeCandidateMatch,
  ExistingMatch,
  LoadedTown,
} from "./types";

function candidateSimilarity(left: CandidateListing, right: CandidateListing) {
  if (left.sourceType === right.sourceType && left.sourceUrl === right.sourceUrl) {
    return { score: 1, reason: "Same source URL" };
  }

  const leftWebsite = normalizeWebsite(left.website);
  const rightWebsite = normalizeWebsite(right.website);
  if (leftWebsite && leftWebsite === rightWebsite) {
    return { score: 0.98, reason: "Same website" };
  }

  const leftPhone = normalizePhone(left.phone);
  const rightPhone = normalizePhone(right.phone);
  if (leftPhone && leftPhone === rightPhone) {
    return { score: 0.96, reason: "Same phone number" };
  }

  const leftName = normalizeName(left.name);
  const rightName = normalizeName(right.name);
  const leftAddress = normalizeAddress(left.address);
  const rightAddress = normalizeAddress(right.address);

  if (leftName && leftName === rightName && leftAddress && leftAddress === rightAddress) {
    return { score: 0.95, reason: "Same normalized name and address" };
  }

  const nameSimilarity = tokenSimilarity(left.name, right.name);
  if (
    nameSimilarity >= 0.85 &&
    typeof left.latitude === "number" &&
    typeof left.longitude === "number" &&
    typeof right.latitude === "number" &&
    typeof right.longitude === "number"
  ) {
    const distanceKm = haversineKm(
      { latitude: left.latitude, longitude: left.longitude },
      { latitude: right.latitude, longitude: right.longitude },
    );

    if (distanceKm <= 0.15) {
      return {
        score: 0.9,
        reason: `Very similar name within ${distanceKm.toFixed(2)} km`,
      };
    }
  }

  if (nameSimilarity >= 0.9) {
    return { score: 0.82, reason: "Very similar normalized name" };
  }

  return { score: 0, reason: "" };
}

export function dedupeCandidates(candidates: CandidateListing[]) {
  const accepted: CandidateListing[] = [];
  const duplicates: DedupeCandidateMatch[] = [];

  for (const candidate of candidates) {
    const duplicate = accepted
      .map((acceptedCandidate) => ({
        acceptedCandidate,
        ...candidateSimilarity(candidate, acceptedCandidate),
      }))
      .filter((entry) => entry.score >= 0.9)
      .sort((left, right) => right.score - left.score)[0];

    if (duplicate) {
      duplicates.push({
        candidate,
        duplicateOf: duplicate.acceptedCandidate,
        score: duplicate.score,
        reason: duplicate.reason,
      });
      continue;
    }

    accepted.push(candidate);
  }

  return {
    accepted,
    duplicates,
  };
}

export function matchAgainstExisting(
  candidates: CandidateListing[],
  businesses: LoadedTown["businesses"],
) {
  const matches: ExistingMatch[] = [];
  const unmatched: CandidateListing[] = [];

  for (const candidate of candidates) {
    const candidateWebsite = normalizeWebsite(candidate.website);
    const candidatePhone = normalizePhone(candidate.phone);
    const candidateEmail = normalizeEmail(candidate.email);
    const candidateSourceUrl = candidate.sourceUrl;
    const candidateName = normalizeName(candidate.name);
    const candidateAddress = normalizeAddress(candidate.address);

    const best = businesses
      .map((business) => {
        if (business.sourceUrl && business.sourceUrl === candidateSourceUrl) {
          return { business, score: 1, reason: "Same primary source URL" };
        }

        if (business.sources.some((source) => source.sourceUrl === candidateSourceUrl)) {
          return { business, score: 0.99, reason: "Same stored source URL" };
        }

        if (candidateWebsite && normalizeWebsite(business.website) === candidateWebsite) {
          return { business, score: 0.98, reason: "Same website" };
        }

        if (candidatePhone && normalizePhone(business.phone) === candidatePhone) {
          return { business, score: 0.96, reason: "Same phone number" };
        }

        if (candidateEmail && normalizeEmail(business.email) === candidateEmail) {
          return { business, score: 0.94, reason: "Same email address" };
        }

        const businessName = normalizeName(business.name);
        const businessAddress = normalizeAddress(business.address);
        if (
          candidateName &&
          businessName === candidateName &&
          candidateAddress &&
          businessAddress === candidateAddress
        ) {
          return {
            business,
            score: 0.93,
            reason: "Same normalized name and address",
          };
        }

        const nameScore = tokenSimilarity(candidate.name, business.name);
        if (
          nameScore >= 0.85 &&
          typeof candidate.latitude === "number" &&
          typeof candidate.longitude === "number"
        ) {
          const distanceKm = haversineKm(
            { latitude: candidate.latitude, longitude: candidate.longitude },
            { latitude: business.latitude, longitude: business.longitude },
          );

          if (distanceKm <= 0.12) {
            return {
              business,
              score: 0.88,
              reason: `Similar name within ${distanceKm.toFixed(2)} km`,
            };
          }
        }

        if (nameScore >= 0.93) {
          return { business, score: 0.8, reason: "Very similar normalized name" };
        }

        return { business, score: 0, reason: "" };
      })
      .sort((left, right) => right.score - left.score)[0];

    if (best && best.score >= 0.88) {
      matches.push({
        candidate,
        business: best.business,
        score: best.score,
        reason: best.reason,
      });
      continue;
    }

    unmatched.push(candidate);
  }

  return {
    matches,
    unmatched,
  };
}
