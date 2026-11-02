"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowUpRight,
  IconBuildingStore,
  IconMapPin,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Locale } from "@/lib/i18n";
import type { SearchSuggestion } from "@/lib/search-suggestions";

type SearchAutocompleteProps = {
  autoFocus?: boolean;
  buttonLabel?: string;
  className?: string;
  inputClassName?: string;
  locale: Locale;
  locations?: { kind: "town" | "locality"; label: string; slug: string }[];
  locationPlaceholder?: string;
  onValueChange?: (value: string) => void;
  placeholder: string;
  searchPath?: string;
  value?: string;
  variant?: "explorer" | "header" | "hero" | "home";
};

const suggestionIcons = {
  business: IconBuildingStore,
  keyword: IconSparkles,
  locality: IconMapPin,
  search: IconSearch,
  town: IconMapPin,
} as const;

export function SearchAutocomplete({
  autoFocus = false,
  buttonLabel,
  className,
  inputClassName,
  locale,
  locations = [],
  locationPlaceholder,
  onValueChange,
  placeholder,
  searchPath = "/directory",
  value,
  variant = "hero",
}: SearchAutocompleteProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalQuery, setInternalQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [locationError, setLocationError] = useState(false);
  const query = value ?? internalQuery;
  const deferredQuery = useDeferredValue(query.trim());
  const copy =
    locale === "it"
      ? {
          headerLabel: "Consigliati",
          noResults: "Continua con la ricerca completa",
        }
      : {
          headerLabel: "Recommended",
          noResults: "Continue with the full search",
        };

  useEffect(() => {
    if (!deferredQuery) {
      return;
    }

    const controller = new AbortController();

    async function run() {
      try {
        const response = await fetch(
          `/api/search-suggestions?q=${encodeURIComponent(deferredQuery)}&locale=${locale}&searchPath=${encodeURIComponent(searchPath)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok || controller.signal.aborted) {
          return;
        }

        const payload = (await response.json()) as { suggestions?: SearchSuggestion[] };

        if (!controller.signal.aborted) {
          setSuggestions(payload.suggestions ?? []);
          setHighlightedIndex(-1);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setSuggestions([]);
          setHighlightedIndex(-1);
        }
      }
    }

    void run();

    return () => controller.abort();
  }, [deferredQuery, locale, searchPath]);

  function updateQuery(nextValue: string) {
    if (value === undefined) {
      setInternalQuery(nextValue);
    }

    onValueChange?.(nextValue);
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function submitDirectorySearch(value: string) {
    const selectedLocation = locations.find((item) => item.label.toLocaleLowerCase() === location.trim().toLocaleLowerCase());
    if (location.trim() && !selectedLocation) {
      setLocationError(true);
      return;
    }
    if (!value.trim() && !selectedLocation) {
      return;
    }

    startTransition(() => {
      setOpen(false);
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      if (selectedLocation) params.set(selectedLocation.kind, selectedLocation.slug);
      router.push(`${searchPath}?${params.toString()}`);
    });
  }

  function openSuggestion(suggestion: SearchSuggestion) {
    startTransition(() => {
      setOpen(false);
      router.push(suggestion.href);
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const activeSuggestion =
      highlightedIndex >= 0 ? suggestions[highlightedIndex] : undefined;

    if (activeSuggestion) {
      openSuggestion(activeSuggestion);
      return;
    }

    submitDirectorySearch(query);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      openSuggestion(suggestions[highlightedIndex]);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  const showSuggestions = open && Boolean(query.trim()) && suggestions.length > 0;
  const rootClassName =
    variant === "home"
      ? "home-search"
      : variant === "hero"
      ? "mx-auto max-w-xl"
      : variant === "explorer"
        ? "w-full"
        : "w-[22rem] max-w-[22rem]";
  const formClassName =
    variant === "home"
      ? "home-search-form"
      : variant === "hero"
      ? "flex items-center gap-2 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl"
      : variant === "explorer"
        ? "flex min-h-[54px] items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-3 shadow-[0_6px_18px_rgba(40,51,48,0.06)] transition-shadow focus-within:border-[color:rgba(42,98,87,0.5)] focus-within:shadow-[0_0_0_4px_rgba(42,98,87,0.1)]"
        : "flex items-center gap-2 rounded-xl bg-[var(--secondary)] px-3 py-2";
  const mergedRootClassName = [rootClassName, className].filter(Boolean).join(" ");
  const mergedInputClassName = [
    variant === "hero" || variant === "home"
      ? "flex-1 bg-transparent py-2 text-base text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
      : "min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]",
    inputClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const searchInput = <input
    value={query}
    name="q"
    autoFocus={autoFocus}
    onChange={(event) => {
      const nextValue = event.target.value;
      updateQuery(nextValue);
      if (!nextValue.trim()) {
        setSuggestions([]);
        setHighlightedIndex(-1);
      }
      setOpen(true);
    }}
    onFocus={() => setOpen(true)}
    onKeyDown={handleKeyDown}
    placeholder={placeholder}
    className={mergedInputClassName}
    autoComplete="off"
    aria-label={placeholder}
  />;

  return (
    <div ref={containerRef} className={`relative ${mergedRootClassName}`}>
      <form onSubmit={handleSubmit} className={formClassName}>
        <IconSearch
          size={variant === "hero" || variant === "explorer" ? 18 : 14}
          className={variant === "hero" || variant === "home" ? "ml-3 shrink-0 text-[var(--primary)]" : "shrink-0 text-[var(--muted)]"}
        />
        {variant === "home" ? <label className="home-search-query"><small>{locale === "it" ? "Trova" : "Find"}</small>{searchInput}</label> : searchInput}
        {variant === "home" && locationPlaceholder ? (
          <label className="home-search-location">
            <IconMapPin size={22} className="shrink-0" />
            <span>
              <small>{locale === "it" ? "Vicino a" : "Near"}</small>
              <input
                aria-label={locationPlaceholder}
                aria-invalid={locationError}
                autoComplete="off"
                list="home-search-locations"
                onChange={(event) => { setLocation(event.target.value); setLocationError(false); }}
                placeholder={locationPlaceholder}
                value={location}
              />
              <datalist id="home-search-locations">
                {locations.map((item) => <option key={`${item.kind}-${item.slug}`} value={item.label} />)}
              </datalist>
            </span>
          </label>
        ) : null}
        {buttonLabel ? (
          <button type="submit" className={variant === "home" ? "home-search-button" : "btn-primary shrink-0"}>
            {variant === "home" ? <IconSearch size={21} /> : null}{buttonLabel}
          </button>
        ) : null}
      </form>
      {locationError ? <p className="home-search-error" role="alert">{locale === "it" ? "Seleziona un comune o una località dall’elenco." : "Select a town or locality from the list."}</p> : null}

      {showSuggestions ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-50 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--border)] px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            {copy.headerLabel}
          </div>
          <div className="max-h-[24rem] overflow-y-auto py-2">
            {suggestions.map((suggestion, index) => {
              const Icon = suggestionIcons[suggestion.type];

              return (
                <Link
                  key={suggestion.id}
                  href={suggestion.href}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                    highlightedIndex === index
                      ? "bg-[var(--secondary)]"
                      : "hover:bg-[color:rgba(247,244,239,0.7)]"
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)]">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                      {suggestion.title}
                    </span>
                    {suggestion.subtitle ? (
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {suggestion.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[var(--muted)]">
                    <IconArrowUpRight size={14} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : open && query.trim() ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => submitDirectorySearch(query)}
          className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-50 rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-left text-sm text-[var(--foreground)] shadow-[var(--shadow-card)]"
        >
          {copy.noResults}
        </button>
      ) : null}
    </div>
  );
}
