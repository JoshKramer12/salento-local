"use client";

import { type CategoryGroup } from "@prisma/client";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconGridDots,
  IconList,
  IconMapPin,
  IconX,
} from "@tabler/icons-react";
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { BusinessCard } from "@/components/business-card";
import { BusinessListRow } from "@/components/business-list-row";
import { CategoryIconGlyph } from "@/components/category-icon-glyph";
import { SearchAutocomplete } from "@/components/search-autocomplete";
import { TownMultiSelect, type TownFilterOption } from "@/components/town-multi-select";
import type { Locale } from "@/lib/i18n";
import {
  getCategoryGroupLabel,
  getCategoryLabel,
  type BusinessCardItem,
} from "@/lib/site";

type ExplorerBusiness = BusinessCardItem & {
  category: BusinessCardItem["category"] & { group: CategoryGroup };
  isFeatured: boolean;
  locality?: BusinessCardItem["locality"] | null;
  searchText: string;
};

type TownOption = TownFilterOption;

type LocalityOption = {
  name: string;
  slug: string;
  townSlug: string;
};

type CategoryOption = {
  group: CategoryGroup;
  name: string;
  slug: string;
};

type ExplorerInitialState = {
  category?: string;
  group?: string;
  locality?: string;
  q?: string;
  sort?: string;
  town?: string;
  towns?: string[];
  view?: string;
};

type BusinessExplorerProps = {
  businesses: ExplorerBusiness[];
  categories: CategoryOption[];
  categoryPresets?: Record<string, string[]>;
  emptyBody: string;
  emptyTitle: string;
  initialState?: ExplorerInitialState;
  locale?: Locale;
  lockedLocalitySlug?: string;
  lockedTownSlug?: string;
  localities?: LocalityOption[];
  maxVisibleResults?: number;
  pageSize?: number;
  resultLabel: string;
  searchPlaceholder: string;
  showCategoryChips?: boolean;
  showLocalityFilter?: boolean;
  showTownFilter?: boolean;
  townFilterMode?: "multi" | "single";
  showViewToggle?: boolean;
  serverPagination?: {
    currentPage: number;
    totalResults: number;
  };
  towns?: TownOption[];
};

const categoryArtwork: Record<string, string> = {
  cafes: "/category-images/cafes.jpg",
  beaches: "/category-images/beaches.jpg",
  hotels: "/category-images/hotels.jpg",
  restaurants: "/category-images/restaurants.jpg",
  shops: "/category-images/shops.jpg",
  "things-to-do": "/category-images/things-to-do.jpg",
  services: "/category-images/services.jpg",
};

export function BusinessExplorer({
  businesses,
  categories,
  categoryPresets = {},
  emptyBody,
  emptyTitle,
  initialState,
  locale = "it",
  lockedLocalitySlug,
  lockedTownSlug,
  localities = [],
  maxVisibleResults,
  pageSize = 24,
  resultLabel,
  searchPlaceholder,
  showCategoryChips = true,
  showLocalityFilter = true,
  showTownFilter = true,
  townFilterMode = "single",
  showViewToggle = true,
  serverPagination,
  towns = [],
}: BusinessExplorerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const copy = locale === "it"
    ? {
        allCategories: "Tutte le categorie",
        allLocalities: "Tutte le aree",
        allTowns: "Tutti i comuni",
        anywhere: "Ovunque nel Salento",
        browse: "Sfoglia per categoria",
        categories: "Categorie",
        clearAll: "Cancella tutto",
        clearFilters: "Azzera filtri",
        filters: "Filtri",
        locality: "Area",
        moreCategories: "Altre categorie",
        next: "Avanti",
        noPlaces: "Nessun luogo trovato",
        openFilters: "Apri filtri avanzati",
        page: "Pagina",
        placesFound: "luoghi trovati",
        priceHighLow: "Prezzo: alto-basso",
        priceLowHigh: "Prezzo: basso-alto",
        previous: "Indietro",
        results: "risultati",
        search: "Cerca",
        sort: "Ordina",
        sortBy: "Ordina:",
        sortAlphabetical: "A-Z",
        sortAlphabeticalDesc: "Z-A",
        sortPopular: "Consigliati",
        town: "Comune",
        viewGrid: "Griglia",
        viewList: "Lista",
        visibleOnly: "Mostrando i primi",
      }
    : {
        allCategories: "All categories",
        allLocalities: "All areas",
        allTowns: "All towns",
        anywhere: "Anywhere in Salento",
        browse: "Browse by category",
        categories: "Categories",
        clearAll: "Clear all",
        clearFilters: "Clear filters",
        filters: "Filters",
        locality: "Area",
        moreCategories: "More categories",
        next: "Next",
        noPlaces: "No places found",
        openFilters: "Open advanced filters",
        page: "Page",
        placesFound: "places found",
        priceHighLow: "Price: high-low",
        priceLowHigh: "Price: low-high",
        previous: "Previous",
        results: "results",
        search: "Search",
        sort: "Sort",
        sortBy: "Sort by:",
        sortAlphabetical: "A-Z",
        sortAlphabeticalDesc: "Z-A",
        sortPopular: "Recommended",
        town: "Town",
        viewGrid: "Grid",
        viewList: "List",
        visibleOnly: "Showing the first",
      };

  const [query, setQuery] = useState(initialState?.q ?? "");
  const [categoryValue, setCategoryValue] = useState(
    initialState?.category || (initialState?.group ? `group:${initialState.group}` : ""),
  );
  const [selectedTownSlugs, setSelectedTownSlugs] = useState(
    lockedTownSlug
      ? [lockedTownSlug]
      : initialState?.towns?.length
        ? initialState.towns
        : initialState?.town
          ? [initialState.town]
          : [],
  );
  const [localitySlug, setLocalitySlug] = useState(
    lockedLocalitySlug ?? initialState?.locality ?? "",
  );
  const [sort, setSort] = useState(initialState?.sort || "recommended");
  const [view, setView] = useState<"grid" | "list">(
    initialState?.view === "list" ? "list" : "grid",
  );
  const [page, setPage] = useState(serverPagination?.currentPage ?? 1);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const effectiveTownSlugs = useMemo(
    () => lockedTownSlug ? [lockedTownSlug] : selectedTownSlugs.filter(Boolean),
    [lockedTownSlug, selectedTownSlugs],
  );
  const canFilterByLocality = Boolean(lockedLocalitySlug) || effectiveTownSlugs.length <= 1;
  const availableLocalities = useMemo(
    () => localities.filter(
      (locality) =>
        canFilterByLocality &&
        (!effectiveTownSlugs.length || effectiveTownSlugs.includes(locality.townSlug)),
    ),
    [canFilterByLocality, effectiveTownSlugs, localities],
  );
  const effectiveLocalitySlug = useMemo(
    () => lockedLocalitySlug ??
      (availableLocalities.some((item) => item.slug === localitySlug) ? localitySlug : ""),
    [availableLocalities, localitySlug, lockedLocalitySlug],
  );
  const categoryGroups = useMemo(
    () => Array.from(new Set(categories.map((category) => category.group))),
    [categories],
  );
  const activeFilterCount = Number(Boolean(query)) + Number(Boolean(categoryValue)) +
    Number(showTownFilter && effectiveTownSlugs.length > 0) +
    Number(showLocalityFilter && Boolean(effectiveLocalitySlug));
  const hasFilters = activeFilterCount > 0 || sort !== "recommended";

  const syncUrl = useEffectEvent((nextState: {
    categoryValue: string;
    localitySlug: string;
    query: string;
    selectedTownSlugs: string[];
    sort: string;
    view: "grid" | "list";
    page: number;
  }) => {
    const params = new URLSearchParams();
    if (nextState.query) params.set("q", nextState.query);
    if (!lockedTownSlug && nextState.selectedTownSlugs.length) {
      if (townFilterMode === "multi") params.set("towns", nextState.selectedTownSlugs.join(","));
      else params.set("town", nextState.selectedTownSlugs[0] ?? "");
    }
    if (!lockedLocalitySlug && nextState.localitySlug) params.set("locality", nextState.localitySlug);
    if (nextState.categoryValue) params.set("category", nextState.categoryValue);
    if (nextState.sort !== "recommended") params.set("sort", nextState.sort);
    if (showViewToggle && nextState.view === "list") params.set("view", "list");
    if (serverPagination && nextState.page > 1) params.set("page", String(nextState.page));
    const queryString = params.toString();
    const destination = queryString ? `${pathname}?${queryString}` : pathname;
    if (serverPagination) router.replace(destination, { scroll: false });
    else window.history.replaceState(window.history.state, "", destination);
  });

  useEffect(() => {
    syncUrl({ categoryValue, localitySlug, query: serverPagination ? deferredQuery : query, selectedTownSlugs, sort, view, page });
  }, [categoryValue, deferredQuery, localitySlug, page, pathname, query, selectedTownSlugs, serverPagination, sort, townFilterMode, view]);

  function resetPage() {
    setPage(1);
  }

  const filteredResults = useMemo(
    () => serverPagination
      ? businesses
      : businesses
      .filter((business) => {
        if (deferredQuery && !business.searchText.includes(deferredQuery)) return false;
        const isGroupFilter = categoryValue.startsWith("group:");
        const normalizedGroup = isGroupFilter ? categoryValue.replace("group:", "") : "";
        const categoryPreset = !isGroupFilter && categoryValue ? categoryPresets[categoryValue] : undefined;
        if (
          categoryValue &&
          (categoryPreset
            ? !categoryPreset.includes(business.category.slug)
            : isGroupFilter
              ? business.category.group !== normalizedGroup
              : business.category.slug !== categoryValue)
        ) return false;
        if (effectiveTownSlugs.length && !effectiveTownSlugs.includes(business.town.slug)) return false;
        if (effectiveLocalitySlug && business.locality?.slug !== effectiveLocalitySlug) return false;
        return true;
      })
      .sort((left, right) => {
        const leftHasPrice = typeof left.priceLevel === "number";
        const rightHasPrice = typeof right.priceLevel === "number";
        switch (sort) {
          case "alphabetical": return left.name.localeCompare(right.name, locale);
          case "alphabetical-desc": return right.name.localeCompare(left.name, locale);
          case "price-asc":
            if (leftHasPrice && rightHasPrice) return (left.priceLevel ?? 0) - (right.priceLevel ?? 0) || left.name.localeCompare(right.name, locale);
            return leftHasPrice ? -1 : rightHasPrice ? 1 : left.name.localeCompare(right.name, locale);
          case "price-desc":
            if (leftHasPrice && rightHasPrice) return (right.priceLevel ?? 0) - (left.priceLevel ?? 0) || left.name.localeCompare(right.name, locale);
            return leftHasPrice ? -1 : rightHasPrice ? 1 : left.name.localeCompare(right.name, locale);
          default:
            return Number(right.isFeatured) - Number(left.isFeatured) ||
              right.reviewCount - left.reviewCount ||
              right.rating - left.rating ||
              left.name.localeCompare(right.name, locale);
        }
      }),
    [businesses, categoryPresets, categoryValue, deferredQuery, effectiveLocalitySlug, effectiveTownSlugs, locale, serverPagination, sort],
  );

  const totalPages = useMemo(
    () => maxVisibleResults ? 1 : Math.max(1, Math.ceil((serverPagination?.totalResults ?? filteredResults.length) / pageSize)),
    [filteredResults.length, maxVisibleResults, pageSize, serverPagination?.totalResults],
  );
  const currentPage = Math.min(serverPagination?.currentPage ?? page, totalPages);
  const visibleResults = useMemo(
    () => serverPagination
      ? filteredResults
      : maxVisibleResults
      ? filteredResults.slice(0, maxVisibleResults)
      : filteredResults.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredResults, maxVisibleResults, pageSize, serverPagination],
  );
  const selectedLocationValue = effectiveLocalitySlug
    ? `locality:${effectiveLocalitySlug}`
    : effectiveTownSlugs.length === 1
      ? `town:${effectiveTownSlugs[0]}`
      : "";

  const featuredCategories = [
    { slug: "restaurants", fallbackGroup: "FOOD" as CategoryGroup },
    { slug: "beaches", fallbackGroup: "BEACH" as CategoryGroup },
    { slug: "cafes", fallbackGroup: "FOOD" as CategoryGroup },
    { slug: "hotels", fallbackGroup: "STAY" as CategoryGroup },
    { slug: "shops", fallbackGroup: "SHOPPING" as CategoryGroup },
    { slug: "things-to-do", fallbackGroup: "TOURISM" as CategoryGroup },
    { slug: "services", fallbackGroup: "SERVICE" as CategoryGroup },
  ].map((item) => {
    const category = categories.find((candidate) => candidate.slug === item.slug);
    return {
      ...item,
      label: category ? getCategoryLabel(category.slug, category.name, locale) : getCategoryGroupLabel(item.fallbackGroup, locale),
      value: category ? category.slug : `group:${item.fallbackGroup}`,
    };
  });

  function resetFilters() {
    setQuery("");
    setCategoryValue("");
    if (!lockedTownSlug) setSelectedTownSlugs([]);
    if (!lockedLocalitySlug) setLocalitySlug("");
    setSort("recommended");
    setView("grid");
    setPage(1);
  }

  function selectLocation(nextValue: string) {
    if (!nextValue) {
      if (!lockedTownSlug) setSelectedTownSlugs([]);
      if (!lockedLocalitySlug) setLocalitySlug("");
      resetPage();
      return;
    }
    const [kind, slug] = nextValue.split(":");
    if (kind === "town") {
      if (!lockedTownSlug) setSelectedTownSlugs([slug]);
      if (!lockedLocalitySlug) setLocalitySlug("");
    } else if (kind === "locality") {
      const locality = localities.find((item) => item.slug === slug);
      if (locality && !lockedTownSlug) setSelectedTownSlugs([locality.townSlug]);
      if (!lockedLocalitySlug) setLocalitySlug(slug);
    }
    resetPage();
  }

  function removeCategory() {
    setCategoryValue("");
    resetPage();
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <SearchAutocomplete
        locale={locale}
        onValueChange={(nextValue) => {
          setQuery(nextValue);
          resetPage();
        }}
        placeholder={searchPlaceholder}
        searchPath={pathname}
        value={query}
        variant="explorer"
      />

      {showCategoryChips && categories.length ? (
        <section aria-labelledby="browse-by-category">
          <h2 id="browse-by-category" className="mb-3 font-serif text-xl text-[var(--foreground)] sm:text-2xl">{copy.browse}</h2>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-8">
            {featuredCategories.map((category, index) => (
              <button
                key={category.slug}
                type="button"
                onClick={() => {
                  setCategoryValue(category.value);
                  resetPage();
                }}
                className={`${index > 3 ? "hidden sm:block" : ""} group relative min-w-0 overflow-hidden rounded-xl border text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:rounded-2xl ${
                  categoryValue === category.value
                    ? "border-[var(--primary)] ring-2 ring-[color:rgba(42,98,87,0.16)]"
                    : "border-[var(--border)] hover:-translate-y-0.5 hover:border-[color:rgba(42,98,87,0.45)]"
                }`}
                aria-pressed={categoryValue === category.value}
              >
                <div className="relative aspect-[1/1.12] sm:aspect-[1.02/0.96]">
                  <img src={categoryArtwork[category.slug]} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                  <span className="absolute inset-0 bg-gradient-to-t from-[rgba(16,35,31,0.77)] via-[rgba(16,35,31,0.12)] to-transparent" />
                  <span className="absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-[var(--primary)] shadow-sm sm:bottom-3 sm:left-3 sm:h-8 sm:w-8">
                    <CategoryIconGlyph slug={category.slug} size={13} stroke={2} />
                  </span>
                  <span className="absolute bottom-2 right-1.5 left-1.5 truncate text-center text-[10px] font-semibold leading-3 text-white drop-shadow-sm sm:bottom-3 sm:left-3 sm:right-3 sm:text-left sm:text-xs">
                    {category.label}
                  </span>
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdvancedFiltersOpen(true)}
              className="flex aspect-[1/1.12] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.48)] px-1 text-center text-[var(--primary)] transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:aspect-[1.02/0.96] sm:rounded-2xl"
              aria-label={copy.moreCategories}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[color:rgba(42,98,87,0.3)] sm:h-9 sm:w-9"><IconGridDots size={17} /></span>
              <span className="text-[10px] font-semibold leading-3 sm:text-xs">{copy.moreCategories}</span>
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[rgba(255,255,255,0.72)] p-2 shadow-[0_6px_18px_rgba(40,51,48,0.04)] sm:p-2.5">
        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_auto] gap-1.5 sm:flex sm:items-center sm:gap-2">
          {showTownFilter || showLocalityFilter ? (
            <label className="relative min-w-0">
              <IconMapPin size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[var(--primary)]" />
              <select
                value={selectedLocationValue}
                onChange={(event) => selectLocation(event.target.value)}
                className="explore-filter-select w-full truncate pl-8 pr-6"
                aria-label={copy.anywhere}
              >
                <option value="">{copy.anywhere}</option>
                {showTownFilter && !lockedTownSlug ? (
                  <optgroup label={copy.town}>
                    {towns.map((town) => <option key={town.slug} value={`town:${town.slug}`}>{town.name}</option>)}
                  </optgroup>
                ) : null}
                {showLocalityFilter && !lockedLocalitySlug ? (
                  <optgroup label={copy.locality}>
                    {localities.map((locality) => <option key={locality.slug} value={`locality:${locality.slug}`}>{locality.name}</option>)}
                  </optgroup>
                ) : null}
              </select>
              <IconChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            </label>
          ) : null}
          <label className="relative min-w-0">
            <select
              value={categoryValue}
              onChange={(event) => {
                setCategoryValue(event.target.value);
                resetPage();
              }}
              className="explore-filter-select w-full truncate pr-6"
              aria-label={copy.categories}
            >
              <option value="">{copy.allCategories}</option>
              <optgroup label={locale === "it" ? "Tipi" : "Types"}>
                {categoryGroups.map((group) => (
                  <option key={group} value={`group:${group}`}>{getCategoryGroupLabel(group, locale)}</option>
                ))}
              </optgroup>
              <optgroup label={copy.categories}>
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>{getCategoryLabel(category.slug, category.name, locale)}</option>
                ))}
              </optgroup>
            </select>
            <IconChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          </label>
          <button
            type="button"
            onClick={() => setAdvancedFiltersOpen((isOpen) => !isOpen)}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-2.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-white sm:px-3 sm:text-sm"
            aria-expanded={advancedFiltersOpen}
            aria-controls="advanced-explore-filters"
          >
            <IconAdjustmentsHorizontal size={15} />
            <span className="hidden sm:inline">{copy.filters}</span>
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] text-white">{activeFilterCount}</span>
          </button>
          <label className="relative hidden min-w-[11rem] sm:ml-auto sm:block">
            <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-xs font-medium text-[var(--muted)]">{copy.sortBy}</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                resetPage();
              }}
              className="explore-filter-select w-full pl-[4.75rem] pr-6"
              aria-label={copy.sort}
            >
              <option value="recommended">{copy.sortPopular}</option>
              <option value="alphabetical">{copy.sortAlphabetical}</option>
              <option value="alphabetical-desc">{copy.sortAlphabeticalDesc}</option>
              <option value="price-asc">{copy.priceLowHigh}</option>
              <option value="price-desc">{copy.priceHighLow}</option>
            </select>
            <IconChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          </label>
        </div>
        {advancedFiltersOpen ? (
          <div id="advanced-explore-filters" className="mt-2 grid gap-3 border-t border-[var(--border)] px-1 pt-4 sm:grid-cols-2">
            {showTownFilter && !lockedTownSlug ? (
              townFilterMode === "multi" ? (
                <TownMultiSelect
                  locale={locale}
                  onChange={(nextSlugs) => {
                    setSelectedTownSlugs(nextSlugs);
                    setLocalitySlug("");
                    resetPage();
                  }}
                  options={towns}
                  selectedSlugs={selectedTownSlugs}
                />
              ) : (
                <label className="field-label">
                  {copy.town}
                  <select
                    value={selectedTownSlugs[0] ?? ""}
                    onChange={(event) => {
                      setSelectedTownSlugs(event.target.value ? [event.target.value] : []);
                      setLocalitySlug("");
                      resetPage();
                    }}
                    className="input-field"
                  >
                    <option value="">{copy.allTowns}</option>
                    {towns.map((town) => <option key={town.slug} value={town.slug}>{town.name}</option>)}
                  </select>
                </label>
              )
            ) : null}
            {showLocalityFilter && !lockedLocalitySlug ? (
              <label className="field-label">
                {copy.locality}
                <select
                  value={canFilterByLocality ? localitySlug : ""}
                  onChange={(event) => {
                    setLocalitySlug(event.target.value);
                    resetPage();
                  }}
                  className="input-field"
                  disabled={!canFilterByLocality}
                >
                  <option value="">{copy.allLocalities}</option>
                  {canFilterByLocality ? availableLocalities.map((locality) => (
                    <option key={locality.slug} value={locality.slug}>{locality.name}</option>
                  )) : null}
                </select>
              </label>
            ) : null}
            <label className="field-label sm:hidden">
              {copy.sort}
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  resetPage();
                }}
                className="input-field"
              >
                <option value="recommended">{copy.sortPopular}</option>
                <option value="alphabetical">{copy.sortAlphabetical}</option>
                <option value="alphabetical-desc">{copy.sortAlphabeticalDesc}</option>
                <option value="price-asc">{copy.priceLowHigh}</option>
                <option value="price-desc">{copy.priceHighLow}</option>
              </select>
            </label>
          </div>
        ) : null}
      </section>

      {activeFilterCount ? (
        <div className="flex flex-wrap items-center gap-2">
          {query ? <FilterChip label={query} locale={locale} onRemove={() => { setQuery(""); resetPage(); }} /> : null}
          {categoryValue ? <FilterChip label={categoryValue.startsWith("group:") ? getCategoryGroupLabel(categoryValue.replace("group:", "") as CategoryGroup, locale) : getCategoryLabel(categoryValue, categories.find((item) => item.slug === categoryValue)?.name ?? categoryValue, locale)} locale={locale} onRemove={removeCategory} /> : null}
          {effectiveTownSlugs.map((slug) => {
            const town = towns.find((item) => item.slug === slug);
            return town ? <FilterChip key={slug} label={town.name} locale={locale} onRemove={() => { setSelectedTownSlugs((current) => current.filter((value) => value !== slug)); setLocalitySlug(""); resetPage(); }} /> : null;
          })}
          {effectiveLocalitySlug ? (
            <FilterChip label={localities.find((item) => item.slug === effectiveLocalitySlug)?.name ?? effectiveLocalitySlug} locale={locale} onRemove={() => { setLocalitySlug(""); resetPage(); }} />
          ) : null}
          <button type="button" onClick={resetFilters} className="px-1 text-xs font-semibold text-[var(--primary)] underline-offset-2 hover:underline">{copy.clearAll}</button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <IconAdjustmentsHorizontal size={15} />
          <span><span className="font-semibold text-[var(--foreground)]">{(serverPagination?.totalResults ?? filteredResults.length).toLocaleString(locale === "it" ? "it-IT" : "en-US")}</span> {resultLabel || copy.placesFound}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative min-w-[8.75rem] sm:hidden">
            <select value={sort} onChange={(event) => { setSort(event.target.value); resetPage(); }} className="explore-filter-select w-full pr-6 text-xs" aria-label={copy.sort}>
              <option value="recommended">{copy.sortPopular}</option>
              <option value="alphabetical">{copy.sortAlphabetical}</option>
              <option value="alphabetical-desc">{copy.sortAlphabeticalDesc}</option>
              <option value="price-asc">{copy.priceLowHigh}</option>
              <option value="price-desc">{copy.priceHighLow}</option>
            </select>
            <IconChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          </label>
          {showViewToggle ? (
            <div className="hidden items-center gap-1 rounded-lg border border-[var(--border)] bg-white p-0.5 sm:flex">
              <button type="button" onClick={() => { setView("grid"); resetPage(); }} className={`rounded-md p-1.5 transition-colors ${view === "grid" ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`} aria-label={copy.viewGrid}><IconGridDots size={15} /></button>
              <button type="button" onClick={() => { setView("list"); resetPage(); }} className={`rounded-md p-1.5 transition-colors ${view === "list" ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`} aria-label={copy.viewList}><IconList size={15} /></button>
            </div>
          ) : null}
        </div>
      </div>

      {(serverPagination?.totalResults ?? filteredResults.length) ? (
        <>
          {maxVisibleResults && filteredResults.length > maxVisibleResults ? <p className="text-sm text-[var(--muted)]">{copy.visibleOnly} {maxVisibleResults} {copy.results}.</p> : null}
          {view === "list" ? (
            <div className="space-y-3">{visibleResults.map((business) => <BusinessListRow key={business.id} business={business} locale={locale} />)}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">{visibleResults.map((business) => <BusinessCard key={business.id} business={business} locale={locale} />)}</div>
          )}
          {!maxVisibleResults && totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-3 sm:px-5 sm:py-4">
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-40"><IconChevronLeft size={15} /><span className="hidden sm:inline">{copy.previous}</span></button>
              <p className="text-xs text-[var(--muted)] sm:text-sm">{copy.page} <span className="font-semibold text-[var(--foreground)]">{currentPage}</span> / {totalPages}</p>
              <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:cursor-not-allowed disabled:opacity-40"><span className="hidden sm:inline">{copy.next}</span><IconChevronRight size={15} /></button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center sm:p-10">
          <h2 className="font-serif text-2xl text-[var(--foreground)]">{emptyTitle || copy.noPlaces}</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{emptyBody}</p>
          {hasFilters ? <button type="button" onClick={resetFilters} className="mt-5 text-sm font-semibold text-[var(--primary)] hover:underline">{copy.clearFilters}</button> : null}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, locale, onRemove }: { label: string; locale: Locale; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:rgba(42,98,87,0.25)] bg-[color:rgba(42,98,87,0.08)] px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
      <span className="truncate">{label}</span>
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-[color:rgba(42,98,87,0.12)]" aria-label={`${locale === "it" ? "Rimuovi" : "Remove"} ${label}`}><IconX size={12} /></button>
    </span>
  );
}
