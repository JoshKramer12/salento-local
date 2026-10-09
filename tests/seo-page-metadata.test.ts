import assert from "node:assert/strict";
import test from "node:test";

import { generateMetadata as businessMetadata } from "@/app/businesses/[slug]/page";
import { generateMetadata as directoryMetadata } from "@/app/directory/page";
import { generateMetadata as exploreMetadata } from "@/app/explore/page";
import { metadata as homeMetadata } from "@/app/page";
import { generateMetadata as localityMetadata } from "@/app/localities/[slug]/page";
import { generateMetadata as localitiesMetadata } from "@/app/localities/page";
import { generateMetadata as townMetadata } from "@/app/towns/[slug]/page";
import { generateMetadata as townsMetadata } from "@/app/towns/page";
import { prisma } from "@/lib/prisma";

const params = (values: Record<string, string | string[] | undefined> = {}) => Promise.resolve(values);

test("homepage has the canonical www URL", () => {
  assert.equal(homeMetadata.alternates?.canonical, "https://www.salentolocal.ca/");
});

test("directory and explore keep one canonical landing URL while query pages stay out of the index", async () => {
  assert.equal((await directoryMetadata({ searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/directory");
  assert.equal((await exploreMetadata({ searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/directory");
  for (const query of [{ q: "pizza" }, { category: "restaurants" }, { towns: "otranto" }, { sort: "alphabetical" }, { view: "list" }, { page: "2" }]) {
    const metadata = await directoryMetadata({ searchParams: params(query) });
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.equal(metadata.alternates, undefined);
  }
  assert.deepEqual((await exploreMetadata({ searchParams: params({ page: "2" }) })).robots, { index: false, follow: true });
});

test("town and locality indexes canonicalize clean routes and noindex their searches", async () => {
  assert.equal((await townsMetadata({ searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/towns");
  assert.equal((await localitiesMetadata({ searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/localities");
  assert.deepEqual((await townsMetadata({ searchParams: params({ q: "lecce" }) })).robots, { index: false, follow: true });
  assert.deepEqual((await localitiesMetadata({ searchParams: params({ q: "porto" }) })).robots, { index: false, follow: true });
});

test("Business metadata uses the same public membership query and a clean canonical slug", async () => {
  const delegate = prisma.business as unknown as { findFirst: (query: unknown) => Promise<unknown> };
  const original = delegate.findFirst;
  let queryWhere: unknown;
  delegate.findFirst = async (query: unknown) => {
    queryWhere = (query as { where: unknown }).where;
    return { name: "Caffè Otranto", shortDescription: "Coffee by the sea" };
  };
  try {
    const metadata = await businessMetadata({ params: Promise.resolve({ slug: "caffe-otranto" }) });
    assert.equal(metadata.alternates?.canonical, "https://www.salentolocal.ca/businesses/caffe-otranto");
    assert.equal(metadata.title, "Caffè Otranto | Salento Local");
    const where = queryWhere as { slug: string; AND: Array<{ OR: Array<unknown> }> };
    assert.equal(where.slug, "caffe-otranto");
    assert.deepEqual(where.AND[0].OR[0], { membership: { is: null } });
    assert.match(JSON.stringify(where), /"entitlementRevokedAt":null/);
    assert.match(JSON.stringify(where), /"graceEndsAt":\{"gt":"/);
  } finally {
    delegate.findFirst = original;
  }
});

test("town and locality metadata use canonical slugs and noindex filter variants", async () => {
  const town = prisma.town as unknown as { findUnique: (query: unknown) => Promise<unknown> };
  const locality = prisma.locality as unknown as { findUnique: (query: unknown) => Promise<unknown> };
  const oldTown = town.findUnique;
  const oldLocality = locality.findUnique;
  town.findUnique = async () => ({ name: "Otranto", shortDescription: "Seaside town" });
  locality.findUnique = async () => ({ name: "Porto Badisco", shortDescription: "Bay", town: { name: "Otranto" } });
  try {
    assert.equal((await townMetadata({ params: Promise.resolve({ slug: "otranto" }), searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/towns/otranto");
    assert.equal((await localityMetadata({ params: Promise.resolve({ slug: "porto-badisco" }), searchParams: params() })).alternates?.canonical, "https://www.salentolocal.ca/localities/porto-badisco");
    assert.deepEqual((await townMetadata({ params: Promise.resolve({ slug: "otranto" }), searchParams: params({ category: "restaurants" }) })).robots, { index: false, follow: true });
    assert.deepEqual((await localityMetadata({ params: Promise.resolve({ slug: "porto-badisco" }), searchParams: params({ sort: "alphabetical" }) })).robots, { index: false, follow: true });
  } finally {
    town.findUnique = oldTown;
    locality.findUnique = oldLocality;
  }
});
