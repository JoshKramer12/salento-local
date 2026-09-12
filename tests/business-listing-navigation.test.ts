import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBusinessOriginHref,
  getBusinessOriginSlug,
  resolveBusinessBackLink,
} from "@/lib/business-listing-navigation";

const originatingBusiness = {
  name: "Trattoria da Nonna",
  slug: "trattoria-da-nonna",
  townId: "otranto-id",
};

test("business-origin town links retain the exact originating business slug", () => {
  assert.equal(
    buildBusinessOriginHref("/towns/otranto", originatingBusiness.slug),
    "/towns/otranto?fromBusiness=trattoria-da-nonna",
  );
  assert.equal(
    buildBusinessOriginHref("https://attacker.example", originatingBusiness.slug),
    "/towns",
  );
});

test("town pages resolve a contextual business back link only for the originating town", () => {
  assert.deepEqual(
    resolveBusinessBackLink("trattoria-da-nonna", originatingBusiness, "otranto-id"),
    {
      href: "/businesses/trattoria-da-nonna",
      name: "Trattoria da Nonna",
    },
  );
  assert.equal(
    resolveBusinessBackLink("trattoria-da-nonna", originatingBusiness, "lecce-id"),
    null,
  );
});

test("invalid business-origin context falls back safely", () => {
  for (const value of [
    "https://attacker.example",
    "//attacker.example",
    "/businesses/trattoria-da-nonna",
    "trattoria-da-nonna?returnTo=https://attacker.example",
    "",
  ]) {
    assert.equal(getBusinessOriginSlug(value), null, value);
    assert.equal(resolveBusinessBackLink(value, originatingBusiness, "otranto-id"), null, value);
  }
});
