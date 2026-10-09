import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { isBusinessMembershipPublic, getPublicBusinessMembershipWhere } from "@/lib/business-membership";
import { discoveryMetadata, publicUrl, PUBLIC_SITE_URL } from "@/lib/seo";
import { buildPublicSitemap } from "@/lib/seo-sitemap";
import robots from "@/app/robots";

const now = new Date("2027-01-10T12:00:00.000Z");
const before = new Date("2027-01-09T12:00:00.000Z");
const after = new Date("2027-01-11T12:00:00.000Z");

type FixtureBusiness = {
  slug: string;
  isLikelyClosed: boolean;
  membership: { graceEndsAt: Date; entitlementRevokedAt: Date | null } | null;
};

const businesses: FixtureBusiness[] = [
  { slug: "active", isLikelyClosed: false, membership: { graceEndsAt: after, entitlementRevokedAt: null } },
  { slug: "grace", isLikelyClosed: false, membership: { graceEndsAt: after, entitlementRevokedAt: null } },
  { slug: "boundary", isLikelyClosed: false, membership: { graceEndsAt: now, entitlementRevokedAt: null } },
  { slug: "expired", isLikelyClosed: false, membership: { graceEndsAt: before, entitlementRevokedAt: null } },
  { slug: "revoked", isLikelyClosed: false, membership: { graceEndsAt: after, entitlementRevokedAt: before } },
  { slug: "legacy", isLikelyClosed: false, membership: null },
  { slug: "likely-closed", isLikelyClosed: true, membership: null },
];

function fixtureDatabase() {
  const expectedWhere = { isLikelyClosed: false, ...getPublicBusinessMembershipWhere(now) };
  const publicBusinesses = businesses.filter((business) =>
    !business.isLikelyClosed && isBusinessMembershipPublic({
      entitlementRevokedAt: business.membership?.entitlementRevokedAt,
      graceEndsAt: business.membership?.graceEndsAt,
      now,
    }),
  );
  const calls: string[] = [];
  const database = {
    town: { findMany: async (query: unknown) => {
      assert.deepEqual(query, { select: { slug: true }, orderBy: { slug: "asc" } });
      calls.push("town");
      return [{ slug: "lecce" }, { slug: "otranto" }];
    } },
    locality: { findMany: async (query: { where: { businesses: { some: unknown } } }) => {
      assert.deepEqual(query.where.businesses.some, expectedWhere);
      calls.push("locality");
      return [
        { slug: "porto-badisco", businessSlug: "active" },
        { slug: "expired-only", businessSlug: "expired" },
      ].filter((locality) => publicBusinesses.some((business) => business.slug === locality.businessSlug))
        .map(({ slug }) => ({ slug }));
    } },
    business: { findMany: async (query: { where: unknown; select: unknown }) => {
      assert.deepEqual(query.where, expectedWhere);
      assert.deepEqual(query.select, { slug: true });
      calls.push("business");
      return publicBusinesses.map(({ slug }) => ({ slug }));
    } },
  } as unknown as Pick<PrismaClient, "town" | "locality" | "business">;
  return { calls, database };
}

test("sitemap uses the public membership predicate and only canonical public slugs", async () => {
  const { calls, database } = fixtureDatabase();
  const entries = await buildPublicSitemap(database, now);
  const urls = entries.map(({ url }) => url);

  assert.deepEqual(calls.sort(), ["business", "locality", "town"]);
  assert.ok(urls.includes(`${PUBLIC_SITE_URL}/`));
  assert.ok(urls.includes(`${PUBLIC_SITE_URL}/directory`));
  assert.ok(urls.includes(`${PUBLIC_SITE_URL}/towns/otranto`));
  assert.ok(urls.includes(`${PUBLIC_SITE_URL}/localities/porto-badisco`));
  assert.ok(!urls.includes(`${PUBLIC_SITE_URL}/localities/expired-only`));
  for (const slug of ["active", "grace", "legacy"]) {
    assert.ok(urls.includes(`${PUBLIC_SITE_URL}/businesses/${slug}`), slug);
  }
  for (const slug of ["boundary", "expired", "revoked", "likely-closed", "nonexistent", "draft-submission"]) {
    assert.ok(!urls.includes(`${PUBLIC_SITE_URL}/businesses/${slug}`), slug);
  }
  assert.equal(new Set(urls).size, urls.length);
  for (const url of urls) {
    assert.equal(new URL(url).origin, PUBLIC_SITE_URL);
    assert.equal(new URL(url).search, "");
    assert.doesNotMatch(url, /railway|localhost|\/api\/|\/dashboard\/|\/pay\/|token|session/i);
  }
});

test("canonical policy keeps clean pages indexable and noindexes every discovery query, including page two", () => {
  for (const path of ["/", "/businesses/cafe-lecce", "/towns/otranto", "/localities/porto-badisco", "/directory"]) {
    assert.equal(publicUrl(path), `${PUBLIC_SITE_URL}${path}`);
  }
  assert.deepEqual(discoveryMetadata("/directory"), { alternates: { canonical: `${PUBLIC_SITE_URL}/directory` } });
  assert.deepEqual(discoveryMetadata("/directory", { q: "pizza" }), { robots: { index: false, follow: true } });
  assert.deepEqual(discoveryMetadata("/directory", { category: "restaurants", town: "otranto", sort: "price-asc", view: "list" }), { robots: { index: false, follow: true } });
  assert.deepEqual(discoveryMetadata("/directory", { page: "2" }), { robots: { index: false, follow: true } });
  assert.deepEqual(discoveryMetadata("/towns/otranto", { category: "beaches" }), { robots: { index: false, follow: true } });
  // Locale cookies are deliberately absent from the URL and metadata policy.
  assert.equal(discoveryMetadata("/directory").alternates?.canonical, publicUrl("/directory"));
});

test("robots permits public crawling and names only the canonical sitemap", () => {
  assert.deepEqual(robots(), {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  });
});

test("private account routes share noindex and token or download responses add narrow protection", () => {
  const accountLayout = readFileSync("src/app/(account)/layout.tsx", "utf8");
  const accountPages = readdirSync("src/app/(account)", { recursive: true }).filter((name) => String(name).endsWith("page.tsx"));
  assert.ok(accountPages.length > 20);
  for (const path of [
    "login/page.tsx", "signup/page.tsx", "forgot-password/page.tsx", "reset-password/[token]/page.tsx",
    "dashboard/page.tsx", "dashboard/admin/memberships/page.tsx", "dashboard/refund/[businessId]/page.tsx",
    "claim/verify/page.tsx", "owner-access/[token]/page.tsx", "publish/payment/success/page.tsx",
    "receipts/[submissionId]/page.tsx", "settings/page.tsx", "partner/onboarding/page.tsx",
  ]) {
    assert.ok(accountPages.includes(path), path);
  }
  assert.match(accountLayout, /robots: \{ index: false, follow: false \}/);
  assert.match(readFileSync("src/app/businesses/[slug]/edit/page.tsx", "utf8"), /robots: \{ index: false, follow: false \}/);
  assert.match(readFileSync("src/app/pay/element/[token]/page.tsx", "utf8"), /robots: \{ index: false, follow: false \}/);
  for (const path of [
    "src/app/api/agreements/[submissionId]/route.ts",
    "src/app/api/receipts/[submissionId]/route.ts",
    "src/app/api/receipts/payment/[paymentId]/route.ts",
    "src/app/pay/stripe/[checkoutSessionId]/route.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /X-Robots-Tag[^\n]*noindex/);
  }
  assert.match(readFileSync("src/app/(account)/owner-access/[token]/layout.tsx", "utf8"), /no-referrer/);
  assert.match(readFileSync("src/app/(account)/reset-password/[token]/layout.tsx", "utf8"), /no-referrer/);
  assert.match(readFileSync("src/app/(account)/publish/payment/layout.tsx", "utf8"), /no-referrer/);
  assert.match(readFileSync("src/app/(account)/receipts/layout.tsx", "utf8"), /no-referrer/);
});
