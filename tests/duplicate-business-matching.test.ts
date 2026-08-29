import assert from "node:assert/strict";
import test from "node:test";

import {
  areBusinessNamesCrediblySimilar,
  hasCredibleDuplicateMatches,
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

test("a small spelling difference in a distinctive business name remains credible", () => {
  assert.equal(
    areBusinessNamesCrediblySimilar("Panificio San Luca", "Panificio San Lucca"),
    true,
  );
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
});

test("an empty candidate result never requests duplicate review", () => {
  assert.equal(hasCredibleDuplicateMatches([]), false);
  assert.equal(hasCredibleDuplicateMatches(undefined), false);
  assert.equal(hasCredibleDuplicateMatches([{ id: "candidate" }]), true);
});
