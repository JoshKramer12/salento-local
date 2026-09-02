import assert from "node:assert/strict";
import test from "node:test";

import {
  areBusinessNamesCrediblySimilar,
  getBusinessNameCandidateSearchTerms,
  getBusinessNameMatchStrength,
  hasCredibleDuplicateMatches,
  isBusinessNameDuplicateSignal,
  normalizeDuplicateBusinessName,
  normalizeDuplicatePhone,
  normalizedAddressValuesMatch,
} from "@/lib/duplicate-business-matching";

test("exact business phone matches", () => {
  assert.equal(normalizeDuplicatePhone("+39 0833 123456"), normalizeDuplicatePhone("+39 0833 123456"));
});

test("Italian phone matches across country-code and punctuation formatting", () => {
  assert.equal(normalizeDuplicatePhone("0833 123 456"), normalizeDuplicatePhone("+39 (0833) 123-456"));
  assert.equal(normalizeDuplicatePhone("0039 0833 123456"), normalizeDuplicatePhone("+39 0833 123456"));
});

test("normalized address matches despite punctuation and formatted locality details", () => {
  assert.equal(
    normalizedAddressValuesMatch(
      ["Via Roma, 14"],
      ["Via Roma 14, 73013 Galatina LE, Italia"],
    ),
    true,
  );
});

test("same business name and address provide credible duplicate signals", () => {
  assert.equal(areBusinessNamesCrediblySimilar("La Pergola", "La Pergola"), true);
  assert.equal(
    normalizedAddressValuesMatch(["Via Lecce 8"], ["Via Lecce, 8, Gallipoli"]),
    true,
  );
});

test("business-name normalization treats apostrophes, case, spacing, and punctuation as harmless formatting", () => {
  const normalized = normalizeDuplicateBusinessName("Bob's Burgers");

  for (const name of ["Bobs Burgers", "Bob’s Burgers", "  BOBS   BURGERS  ", "Bob's-Burgers!"]) {
    assert.equal(normalizeDuplicateBusinessName(name), normalized);
    assert.equal(getBusinessNameMatchStrength("Bob's Burgers", name), "exact");
  }

  assert.equal(
    getBusinessNameMatchStrength("Pasticceria Étoile", "  PASTICCERIA  Etoile  "),
    "exact",
  );
});

test("candidate search terms retain short fragments needed to fetch punctuation and accent variants", () => {
  const bobsTerms = getBusinessNameCandidateSearchTerms("Bobs Burgers");
  const pasticceriaTerms = getBusinessNameCandidateSearchTerms("Patisserie Etoile");

  assert.ok(bobsTerms.includes("bob"));
  assert.ok(pasticceriaTerms.includes("tisse"));
  assert.equal(getBusinessNameCandidateSearchTerms("Market Centrale").includes("market"), false);
});

test("a small spelling difference in a distinctive business name remains credible", () => {
  assert.equal(
    areBusinessNamesCrediblySimilar("Panificio San Luca", "Panificio San Lucca"),
    true,
  );
  assert.equal(getBusinessNameMatchStrength("Bob's Burger", "Bobs Burgers"), "fuzzy");
});

test("completely different identity signals do not match", () => {
  assert.equal(areBusinessNamesCrediblySimilar("Masseria Aurora", "Officina Greco"), false);
  assert.equal(normalizeDuplicatePhone("+39 0833 111111") === normalizeDuplicatePhone("+39 0833 999999"), false);
  assert.equal(normalizedAddressValuesMatch(["Via Roma 1"], ["Via Lecce 44"]), false);
});

test("a shared generic business word does not make unrelated names duplicates", () => {
  assert.equal(areBusinessNamesCrediblySimilar("Bar Aurora", "Bar Tramonto"), false);
  assert.equal(areBusinessNamesCrediblySimilar("Hotel del Mare", "Hotel Centrale"), false);
  assert.equal(areBusinessNamesCrediblySimilar("Ristorante", "Restaurant"), false);
  assert.equal(areBusinessNamesCrediblySimilar("Market Centrale", "Market Levante"), false);
  assert.equal(areBusinessNamesCrediblySimilar("Pasticceria Aurora", "Officina Aurora"), false);
  assert.equal(areBusinessNamesCrediblySimilar("Tramonto Blu", "Tramonto Verde"), false);
});

test("name signals require local context or an independent address or phone match", () => {
  assert.equal(
    isBusinessNameDuplicateSignal({
      addressMatches: false,
      matchStrength: getBusinessNameMatchStrength("Bob's Burgers", "Bobs Burgers"),
      phoneMatches: false,
      sameTown: true,
    }),
    true,
  );
  assert.equal(
    isBusinessNameDuplicateSignal({
      addressMatches: false,
      matchStrength: getBusinessNameMatchStrength("Panificio San Luca", "Panificio San Lucca"),
      phoneMatches: false,
      sameTown: false,
    }),
    false,
  );
  assert.equal(
    isBusinessNameDuplicateSignal({
      addressMatches: true,
      matchStrength: getBusinessNameMatchStrength("Panificio San Luca", "Panificio San Lucca"),
      phoneMatches: false,
      sameTown: false,
    }),
    true,
  );
  assert.equal(
    isBusinessNameDuplicateSignal({
      addressMatches: false,
      matchStrength: getBusinessNameMatchStrength("Panificio San Luca", "Panificio San Lucca"),
      phoneMatches: true,
      sameTown: false,
    }),
    true,
  );
});

test("an empty candidate result never requests duplicate review", () => {
  assert.equal(hasCredibleDuplicateMatches([]), false);
  assert.equal(hasCredibleDuplicateMatches(undefined), false);
  assert.equal(hasCredibleDuplicateMatches([{ id: "candidate" }]), true);
});
