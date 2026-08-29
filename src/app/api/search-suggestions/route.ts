import { NextRequest, NextResponse } from "next/server";

import { defaultLocale, isLocale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";
import { type SearchSuggestion } from "@/lib/search-suggestions";
import { getCategoryLabel } from "@/lib/site";

function normalizeSearchValue(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function getSearchTokens(value: string) {
  return normalizeSearchValue(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function getTextMatchScore(value: string | undefined, normalizedQuery: string) {
  if (!value) {
    return null;
  }

  const normalizedValue = normalizeSearchValue(value);

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.startsWith(normalizedQuery)) {
    return 0;
  }

  if (getSearchTokens(value).some((token) => token.startsWith(normalizedQuery))) {
    return 1;
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return 2;
  }

  return null;
}

function getSuggestionScore(suggestion: SearchSuggestion, normalizedQuery: string) {
  if (suggestion.type === "search") {
    return 99;
  }

  const titleScore = getTextMatchScore(suggestion.title, normalizedQuery);

  if (titleScore !== null) {
    return titleScore;
  }

  const subtitleScore = getTextMatchScore(suggestion.subtitle, normalizedQuery);

  if (subtitleScore !== null) {
    return 10 + subtitleScore;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const localeValue = request.nextUrl.searchParams.get("locale") ?? defaultLocale;
  const locale = isLocale(localeValue) ? localeValue : defaultLocale;
  const searchPath = request.nextUrl.searchParams.get("searchPath")?.trim() || "/directory";
  const normalizedSearchPath = searchPath.startsWith("/") ? searchPath : "/directory";
  const normalizedQuery = normalizeSearchValue(query);

  if (!query) {
    return NextResponse.json({ suggestions: [] satisfies SearchSuggestion[] });
  }

  const [towns, localities, businesses, categories] = await Promise.all([
    prisma.town.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { slug: { contains: normalizeSearchValue(query) } },
        ],
      },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 12,
    }),
    prisma.locality.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { town: { name: { contains: query } } },
        ],
      },
      include: {
        town: true,
      },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 12,
    }),
    prisma.business.findMany({
      where: {
        isLikelyClosed: false,
        OR: [
          { name: { contains: query } },
          { shortDescription: { contains: query } },
          { subcategory: { contains: query } },
          { category: { name: { contains: query } } },
          { town: { name: { contains: query } } },
          { locality: { name: { contains: query } } },
        ],
      },
      include: {
        category: true,
        locality: true,
        town: true,
      },
      orderBy: [
        { isFeatured: "desc" },
        { reviewCount: "desc" },
        { rating: "desc" },
        { name: "asc" },
      ],
      take: 16,
    }),
    prisma.category.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { slug: { contains: query.toLowerCase() } },
          { description: { contains: query } },
        ],
      },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 12,
    }),
  ]);

  const suggestions: SearchSuggestion[] = [
    {
      href: `${normalizedSearchPath}?q=${encodeURIComponent(query)}`,
      id: `search:${query.toLowerCase()}`,
      subtitle:
        locale === "it"
          ? "Cerca in tutta la directory"
          : "Search across the full directory",
      title: locale === "it" ? `Cerca "${query}"` : `Search for "${query}"`,
      type: "search",
    },
    ...towns.map((town) => ({
      href: `/towns/${town.slug}`,
      id: `town:${town.id}`,
      subtitle: `${town.province}, ${town.region}`,
      title: town.name,
      type: "town" as const,
    })),
    ...localities.map((locality) => ({
      href: `/localities/${locality.slug}`,
      id: `locality:${locality.id}`,
      subtitle: locality.town.name,
      title: locality.name,
      type: "locality" as const,
    })),
    ...businesses.map((business) => ({
      href: `/businesses/${business.slug}`,
      id: `business:${business.id}`,
      subtitle: `${getCategoryLabel(business.category.slug, business.category.name, locale)} · ${business.town.name}`,
      title: business.name,
      type: "business" as const,
    })),
    ...categories.map((category) => ({
      href: `${normalizedSearchPath}?category=${encodeURIComponent(category.slug)}`,
      id: `keyword:${category.id}`,
      subtitle:
        locale === "it"
          ? "Apri risultati per parola chiave"
          : "Open keyword results",
      title: getCategoryLabel(category.slug, category.name, locale),
      type: "keyword" as const,
    })),
  ];

  const scoredSuggestions = Array.from(
    new Map(suggestions.map((suggestion) => [suggestion.href, suggestion])).values(),
  )
    .map((suggestion) => ({
      score: getSuggestionScore(suggestion, normalizedQuery),
      suggestion,
    }))
    .filter((entry) => entry.score !== null) as Array<{
    score: number;
    suggestion: SearchSuggestion;
  }>;

  const hasPrefixMatches = scoredSuggestions.some(
    (entry) => entry.score < 2 || entry.score === 10 || entry.score === 11,
  );
  const dedupedSuggestions = scoredSuggestions
    .filter(
      (entry) =>
        entry.suggestion.type === "search" ||
        !hasPrefixMatches ||
        entry.score < 2 ||
        entry.score === 10 ||
        entry.score === 11,
    )
    .sort(
      (left, right) =>
        left.score - right.score || left.suggestion.title.localeCompare(right.suggestion.title, locale),
    )
    .map((entry) => entry.suggestion)
    .slice(0, 10);

  return NextResponse.json({ suggestions: dedupedSuggestions });
}
