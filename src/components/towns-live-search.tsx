"use client";

import { useDeferredValue, useId, useState } from "react";
import { IconMapPin, IconSearch } from "@tabler/icons-react";

import { LocalityCard, type LocalityCardLocality } from "@/components/locality-card";
import { TownCard, type TownCardTown } from "@/components/town-card";
import type { Locale } from "@/lib/i18n";

type TownSearchCopy = {
  emptyBody: string;
  emptyTitle: string;
  placeholder: string;
};

export type TownSearchItem = TownCardTown & {
  businessCount: number;
  id: string;
  region: string;
  thingsToDoCount: number;
};

export type LocalitySearchItem = LocalityCardLocality & {
  id: string;
  town: LocalityCardLocality["town"] & {
    region?: string;
  };
};

type TownsLiveSearchProps = {
  copy: TownSearchCopy;
  initialQuery: string;
  localities?: LocalitySearchItem[];
  locale: Locale;
  towns: TownSearchItem[];
};

function normalizeTownSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitSearchParts(value: string) {
  return normalizeTownSearchValue(value).split(/[\s'’-]+/).filter(Boolean);
}

function matchesSearch(
  normalizedQuery: string,
  primaryValue: string,
  secondaryValues: string[] = [],
) {
  if (!normalizedQuery) {
    return true;
  }

  const normalizedPrimary = normalizeTownSearchValue(primaryValue);
  const primaryParts = splitSearchParts(primaryValue);

  if (normalizedQuery.length === 1) {
    return primaryParts.some((part) => part.startsWith(normalizedQuery));
  }

  if (
    normalizedPrimary.includes(normalizedQuery) ||
    primaryParts.some((part) => part.startsWith(normalizedQuery))
  ) {
    return true;
  }

  return secondaryValues.some((value) => {
    const normalizedValue = normalizeTownSearchValue(value);

    return (
      normalizedValue.includes(normalizedQuery) ||
      splitSearchParts(value).some((part) => part.startsWith(normalizedQuery))
    );
  });
}

export function TownsLiveSearch({
  copy,
  initialQuery,
  localities = [],
  locale,
  towns,
}: TownsLiveSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const inputId = useId();
  const normalizedQuery = normalizeTownSearchValue(deferredQuery);
  const filteredTowns = towns.filter((town) =>
    matchesSearch(normalizedQuery, town.name, [town.province, town.region]),
  );
  const filteredLocalities = localities.filter((locality) =>
    matchesSearch(normalizedQuery, locality.name, [locality.town.name, locality.placeType]),
  );
  const hasResults = filteredTowns.length > 0 || filteredLocalities.length > 0;

  return (
    <>
      <div className="relative mb-8 max-w-sm">
        <label htmlFor={inputId} className="sr-only">
          {copy.placeholder}
        </label>
        <IconSearch
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
        />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.placeholder}
          autoComplete="off"
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-3 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] outline-none focus:ring-2 focus:ring-[color:rgba(42,98,87,0.18)]"
        />
      </div>

      {hasResults ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTowns.map((town) => (
            <TownCard
              key={town.id}
              town={town}
              businessCount={town.businessCount}
              thingsToDoCount={town.thingsToDoCount}
              locale={locale}
            />
          ))}
          {filteredLocalities.map((locality) => (
            <LocalityCard
              key={locality.id}
              locality={locality}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <div className="py-24 text-center text-[var(--muted)]">
          <IconMapPin size={40} className="mx-auto mb-4 opacity-30" />
          <p className="mb-2 text-lg font-medium">{copy.emptyTitle}</p>
          <p className="text-sm">{copy.emptyBody}</p>
        </div>
      )}
    </>
  );
}
