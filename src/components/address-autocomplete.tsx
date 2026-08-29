"use client";

import { IconAlertTriangle, IconCheck, IconLoader2, IconMapPin } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Locale } from "@/lib/i18n";
import {
  buildAddressSelectionStorage,
  buildGoogleMapsSearchUrl,
  buildSelectedAddressFromPlaceDetails,
  buildStreetAddressLine,
  getAddressSuggestionsMaxHeight,
  isValidSelectedAddress,
  SALENTO_LOCATION_BIAS,
  shouldInvalidateSelectedAddress,
  type PlaceDetailsLike,
  type SelectedAddress,
} from "@/lib/address-selection";

type AddressAutocompleteTown = {
  latitude: number;
  longitude: number;
  name: string;
  province?: string;
  region?: string;
};

type AddressAutocompleteProps = {
  clientError?: string;
  emphasizeError?: boolean;
  initialGooglePlacesApiKey?: string;
  locale: Locale;
  onClientErrorChange?: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSelectedAddressChange: (value: SelectedAddress | null) => void;
  query: string;
  selectedAddress: SelectedAddress | null;
  serverError?: string;
  town?: AddressAutocompleteTown | null;
};

type AutocompleteSuggestionEntry = {
  displayName: string;
  placeId?: string;
  placeResourceName?: string;
  secondaryText?: string;
  value: string;
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      place?: string;
      placeId?: string;
      structuredFormat?: {
        mainText?: {
          text?: string;
        };
        secondaryText?: {
          text?: string;
        };
      };
      text?: {
        text?: string;
      };
    };
  }>;
};

type GooglePlaceDetailsResponse = PlaceDetailsLike;
type GoogleMapsBrowserKeyResponse = {
  apiKey?: string;
};

const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const GOOGLE_BROWSER_KEY_URL = "/api/google-maps/browser-key";
const GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1";

function buildCopy(locale: Locale) {
  if (locale === "it") {
    return {
      addressSelected: "Indirizzo selezionato",
      apiEnablePlaces: "La ricerca indirizzo richiede Places API (New) attiva sulla chiave Google Maps di questo sito.",
      apiLoadFailure: "La ricerca indirizzo non e disponibile in questo momento.",
      label: "Indirizzo",
      loading: "Ricerca indirizzi in corso...",
      noResults: "Nessun indirizzo corrispondente trovato.",
      placeholder: "Via, piazza e numero civico",
      selectRequired: "Seleziona un indirizzo dai suggerimenti.",
      typeMore: "Scrivi almeno 2 lettere per cercare l'indirizzo.",
    };
  }

  return {
    addressSelected: "Address selected",
    apiEnablePlaces:
      "Address search requires Places API (New) to be enabled for this site's Google Maps key.",
    apiLoadFailure: "Address search is unavailable right now.",
    label: "Street address",
    loading: "Searching addresses...",
    noResults: "No matching addresses found.",
    placeholder: "Street name and house number",
    selectRequired: "Select an address from the suggestions.",
    typeMore: "Type at least 2 letters to search the address.",
  };
}

function normalizeSuggestionText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function canSearchAddress(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= 2;
}

function createAddressSessionToken() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function buildGoogleAutocompleteRequest({
  locale,
  query,
  sessionToken,
  town,
}: {
  locale: Locale;
  query: string;
  sessionToken: string | null;
  town?: AddressAutocompleteTown | null;
}) {
  const request: Record<string, unknown> = {
    includedRegionCodes: ["it"],
    input: query,
    languageCode: locale,
  };

  if (sessionToken) {
    request.sessionToken = sessionToken;
  }

  if (town && Number.isFinite(town.latitude) && Number.isFinite(town.longitude)) {
    request.locationBias = {
      circle: {
        center: {
          latitude: town.latitude,
          longitude: town.longitude,
        },
        radius: 18_000,
      },
    };
  } else {
    request.locationBias = {
      circle: {
        center: {
          latitude: SALENTO_LOCATION_BIAS.center.lat,
          longitude: SALENTO_LOCATION_BIAS.center.lng,
        },
        radius: SALENTO_LOCATION_BIAS.radius,
      },
    };
  }

  return request;
}

function buildGooglePlaceDetailsUrl({
  locale,
  placeResourceName,
}: {
  locale: Locale;
  placeResourceName: string;
}) {
  const url = new URL(`${GOOGLE_PLACE_DETAILS_URL}/${placeResourceName}`);
  url.searchParams.set("languageCode", locale);
  url.searchParams.set("regionCode", "IT");
  return url.toString();
}

function resolveAddressAutocompleteErrorMessage(
  error: unknown,
  copy: ReturnType<typeof buildCopy>,
) {
  const message = error instanceof Error ? error.message : "";

  if (
    /Place autocomplete is unavailable/i.test(message) ||
    /Places API/i.test(message) ||
    /ApiNotActivatedMapError/i.test(message) ||
    /AccessNotConfigured/i.test(message)
  ) {
    return copy.apiEnablePlaces;
  }

  return process.env.NODE_ENV === "production"
    ? copy.apiLoadFailure
    : `${copy.apiLoadFailure} ${message || copy.apiLoadFailure}`;
}

export function AddressAutocomplete({
  clientError,
  emphasizeError = false,
  initialGooglePlacesApiKey,
  locale,
  onClientErrorChange,
  onQueryChange,
  onSelectedAddressChange,
  query,
  selectedAddress,
  serverError,
  town,
}: AddressAutocompleteProps) {
  const copy = useMemo(() => buildCopy(locale), [locale]);
  const fieldId = useId();
  const listboxId = `${fieldId}-listbox`;
  const statusId = `${fieldId}-status`;
  const errorId = `${fieldId}-error`;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaderError, setLoaderError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestionEntry[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [suggestionsMaxHeight, setSuggestionsMaxHeight] = useState(288);
  const [sessionToken, setSessionToken] = useState<string | null>(() => createAddressSessionToken());
  const [googlePlacesApiKey, setGooglePlacesApiKey] = useState<string | null>(() => {
    const initialKey = initialGooglePlacesApiKey?.trim();
    return initialKey || null;
  });
  const googlePlacesApiKeyLoaded = googlePlacesApiKey !== null;
  const trimmedQuery = query.trim();
  const mergedError = clientError || serverError || loaderError || "";

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    let frameId = 0;
    const visualViewport = window.visualViewport;

    function updateSuggestionsMaxHeight() {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const input = inputRef.current;

        if (!input) {
          return;
        }

        const inputRect = input.getBoundingClientRect();
        const viewportBottom = visualViewport
          ? visualViewport.offsetTop + visualViewport.height
          : window.innerHeight;
        setSuggestionsMaxHeight(
          getAddressSuggestionsMaxHeight(inputRect.bottom, viewportBottom),
        );
      });
    }

    updateSuggestionsMaxHeight();
    window.addEventListener("resize", updateSuggestionsMaxHeight);
    visualViewport?.addEventListener("resize", updateSuggestionsMaxHeight);
    visualViewport?.addEventListener("scroll", updateSuggestionsMaxHeight);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateSuggestionsMaxHeight);
      visualViewport?.removeEventListener("resize", updateSuggestionsMaxHeight);
      visualViewport?.removeEventListener("scroll", updateSuggestionsMaxHeight);
    };
  }, [open, suggestions.length]);

  useEffect(() => {
    if (googlePlacesApiKey !== null) {
      return;
    }

    let cancelled = false;

    const loadGooglePlacesApiKey = async () => {
      try {
        const response = await fetch(GOOGLE_BROWSER_KEY_URL, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Google Maps browser key request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as GoogleMapsBrowserKeyResponse;

        if (cancelled) {
          return;
        }

        setGooglePlacesApiKey(payload.apiKey?.trim() ?? "");
      } catch (error) {
        if (!cancelled) {
          console.error("Google Maps browser key request failed.", error);
          setGooglePlacesApiKey("");
        }
      }
    };

    void loadGooglePlacesApiKey();

    return () => {
      cancelled = true;
    };
  }, [googlePlacesApiKey]);

  useEffect(() => {
    if (!canSearchAddress(trimmedQuery)) {
      const resetTimeoutId = window.setTimeout(() => {
        setSuggestions([]);
        setLoading(false);
      }, 0);

      return () => window.clearTimeout(resetTimeoutId);
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);

      try {
        if (!googlePlacesApiKeyLoaded) {
          return;
        }

        if (!googlePlacesApiKey) {
          throw new Error("Google Maps is not configured.");
        }

        const response = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
          body: JSON.stringify(
            buildGoogleAutocompleteRequest({
              locale,
              query: trimmedQuery,
              sessionToken,
              town,
            }),
          ),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": googlePlacesApiKey,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text",
          },
          method: "POST",
        });

        if (!response.ok) {
          throw new Error(`Address suggestions request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as GoogleAutocompleteResponse;

        if (cancelled) {
          return;
        }

        const nextSuggestions = (payload.suggestions ?? [])
          .map<AutocompleteSuggestionEntry | null>((entry) => {
            const prediction = entry.placePrediction;
            const primaryText = normalizeSuggestionText(
              prediction?.structuredFormat?.mainText?.text ??
              prediction?.text?.text ??
              "",
            );
            const secondaryText = normalizeSuggestionText(
              prediction?.structuredFormat?.secondaryText?.text ?? "",
            );
            const value = normalizeSuggestionText(
              [primaryText, secondaryText].filter(Boolean).join(", "),
            );

            if (!primaryText || !value) {
              return null;
            }

            return {
              displayName: primaryText,
              placeId: prediction?.placeId,
              placeResourceName: prediction?.place,
              secondaryText,
              value,
            } satisfies AutocompleteSuggestionEntry;
          })
          .filter((entry): entry is AutocompleteSuggestionEntry => entry !== null)
          .map((entry) => ({
            ...entry,
            displayName: normalizeSuggestionText(entry.displayName),
            secondaryText: normalizeSuggestionText(entry.secondaryText ?? ""),
            value: normalizeSuggestionText(entry.value),
          }))
          .slice(0, 8);

        setSuggestions(nextSuggestions);
        setHighlightedIndex(-1);
        setLoaderError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSuggestions([]);
        console.error("Address autocomplete suggestions failed.", error);
        setLoaderError(resolveAddressAutocompleteErrorMessage(error, copy));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [copy, googlePlacesApiKey, googlePlacesApiKeyLoaded, locale, sessionToken, town, trimmedQuery]);

  function clearSelectionForQuery(nextQuery: string) {
    if (shouldInvalidateSelectedAddress(nextQuery, selectedAddress)) {
      onSelectedAddressChange(null);
      setSuggestions([]);
      setHighlightedIndex(-1);
      onClientErrorChange?.("");

      if (sessionToken) {
        setSessionToken(createAddressSessionToken());
      }
    }
  }

  async function handleSelectSuggestion(entry: AutocompleteSuggestionEntry) {
    setLoading(true);
    onClientErrorChange?.("");

    try {
      if (!googlePlacesApiKey || !entry.placeResourceName) {
        throw new Error(copy.selectRequired);
      }

      const response = await fetch(
        buildGooglePlaceDetailsUrl({
          locale,
          placeResourceName: entry.placeResourceName,
        }),
        {
          cache: "no-store",
          headers: {
            "X-Goog-Api-Key": googlePlacesApiKey,
            "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Address selection request failed with ${response.status}.`);
      }

      const payload = (await response.json()) as GooglePlaceDetailsResponse;
      const selected = buildSelectedAddressFromPlaceDetails(payload);

      if (!selected || !isValidSelectedAddress(selected)) {
        throw new Error(copy.selectRequired);
      }

      onQueryChange(buildStreetAddressLine(selected));
      onSelectedAddressChange(selected);
      setOpen(false);
      setSuggestions([]);
      setHighlightedIndex(-1);
      setLoaderError(null);
      inputRef.current?.blur();
      setSessionToken(createAddressSessionToken());
    } catch (error) {
      console.error("Address autocomplete selection failed.", error);
      setLoaderError(resolveAddressAutocompleteErrorMessage(error, copy));
      onSelectedAddressChange(null);
    } finally {
      setLoading(false);
    }
  }

  const selectionStorage = isValidSelectedAddress(selectedAddress)
    ? buildAddressSelectionStorage(selectedAddress)
    : null;
  const showTypeMore = open && trimmedQuery.length > 0 && !canSearchAddress(trimmedQuery);
  const showSuggestions = open && suggestions.length > 0;
  const showNoResults =
    open &&
    canSearchAddress(trimmedQuery) &&
    !loading &&
    !suggestions.length &&
    !loaderError;
  const showLoading = open && loading;

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name="address" value={selectionStorage?.address ?? query} />
      <input
        type="hidden"
        name="googleMapsUrl"
        value={
          selectionStorage
            ? buildGoogleMapsSearchUrl({
                formattedAddress: selectionStorage.address,
                placeId: selectionStorage.addressPlaceId,
              })
            : ""
        }
      />
      <input type="hidden" name="addressPlaceId" value={selectionStorage?.addressPlaceId ?? ""} />
      <input
        type="hidden"
        name="addressLatitude"
        value={
          typeof selectionStorage?.addressLatitude === "number"
            ? String(selectionStorage.addressLatitude)
            : ""
        }
      />
      <input
        type="hidden"
        name="addressLongitude"
        value={
          typeof selectionStorage?.addressLongitude === "number"
            ? String(selectionStorage.addressLongitude)
            : ""
        }
      />
      <input
        type="hidden"
        name="addressStreetNumber"
        value={selectionStorage?.addressStreetNumber ?? ""}
      />
      <input type="hidden" name="addressRoute" value={selectionStorage?.addressRoute ?? ""} />
      <input
        type="hidden"
        name="addressLocality"
        value={selectionStorage?.addressLocality ?? ""}
      />
      <input
        type="hidden"
        name="addressProvince"
        value={selectionStorage?.addressProvince ?? ""}
      />
      <input
        type="hidden"
        name="addressRegion"
        value={selectionStorage?.addressRegion ?? ""}
      />
      <input
        type="hidden"
        name="addressPostalCode"
        value={selectionStorage?.addressPostalCode ?? ""}
      />
      <input
        type="hidden"
        name="addressCountry"
        value={selectionStorage?.addressCountry ?? ""}
      />
      <input
        type="hidden"
        name="addressCountryCode"
        value={selectionStorage?.addressCountryCode ?? ""}
      />

      <label htmlFor={fieldId} className="mb-2 block text-sm font-medium text-[var(--foreground)]">
        {copy.label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]">
          <IconMapPin size={16} />
        </div>
        <input
          ref={inputRef}
          id={fieldId}
          value={query}
          onFocus={() => {
            setOpen(true);
            onClientErrorChange?.("");
            if (window.matchMedia("(max-width: 639px)").matches) {
              window.setTimeout(() => {
                inputRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }, 180);
            }
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;

            onQueryChange(nextQuery);
            clearSelectionForQuery(nextQuery);
            setOpen(true);
            setHighlightedIndex(-1);
            onClientErrorChange?.("");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              if (!open) {
                setOpen(true);
                setHighlightedIndex(suggestions.length ? 0 : -1);
                event.preventDefault();
                return;
              }

              if (suggestions.length) {
                event.preventDefault();
                setHighlightedIndex((current) =>
                  current >= suggestions.length - 1 ? 0 : current + 1,
                );
              }
              return;
            }

            if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setHighlightedIndex((current) =>
                current <= 0 ? suggestions.length - 1 : current - 1,
              );
              return;
            }

            if (event.key === "Enter" && open) {
              const highlightedSuggestion =
                highlightedIndex >= 0 ? suggestions[highlightedIndex] : null;

              if (highlightedSuggestion) {
                event.preventDefault();
                void handleSelectSuggestion(highlightedSuggestion);
                return;
              }

              if (!isValidSelectedAddress(selectedAddress)) {
                event.preventDefault();
                onClientErrorChange?.(copy.selectRequired);
              }
              return;
            }

            if (event.key === "Escape") {
              setOpen(false);
              setHighlightedIndex(-1);
              return;
            }

            if (event.key === "Tab") {
              setOpen(false);
              setHighlightedIndex(-1);
            }
          }}
          placeholder={copy.placeholder}
          className={`input-field !pl-14 text-base ${mergedError ? "border-[rgb(185,28,28)] focus:border-[rgb(185,28,28)] focus:ring-[rgba(185,28,28,0.2)]" : ""}`}
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={`${statusId}${mergedError ? ` ${errorId}` : ""}`}
          aria-expanded={open}
          aria-activedescendant={
            open && highlightedIndex >= 0
              ? `${fieldId}-option-${highlightedIndex}`
              : undefined
          }
          aria-invalid={Boolean(mergedError)}
        />

        {open ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.55rem)] z-50 overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
            {showTypeMore ? (
              <p className="px-4 py-4 text-sm text-[var(--muted)]">{copy.typeMore}</p>
            ) : showSuggestions ? (
              <ul
                id={listboxId}
                role="listbox"
                className="overscroll-contain overflow-y-auto py-2 [touch-action:pan-y]"
                style={{
                  maxHeight: `${suggestionsMaxHeight}px`,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {suggestions.map((entry, index) => (
                  <li
                    key={entry.placeId ?? `${entry.value}-${index}`}
                    id={`${fieldId}-option-${index}`}
                    role="option"
                    aria-selected={index === highlightedIndex}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => void handleSelectSuggestion(entry)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        index === highlightedIndex
                          ? "bg-[color:rgba(247,244,239,0.82)]"
                          : "hover:bg-[color:rgba(247,244,239,0.74)]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--foreground)]">
                          {entry.displayName}
                        </span>
                        {entry.secondaryText ? (
                          <span className="mt-1 block text-xs text-[var(--muted)]">
                            {entry.secondaryText}
                          </span>
                        ) : null}
                      </span>
                      {entry.placeId && selectedAddress?.placeId === entry.placeId ? (
                        <IconCheck size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : showLoading ? (
              <div className="flex items-center gap-2 px-4 py-4 text-sm text-[var(--muted)]">
                <IconLoader2 size={16} className="animate-spin" />
                <span>{copy.loading}</span>
              </div>
            ) : showNoResults ? (
              <p className="px-4 py-4 text-sm text-[var(--muted)]">{copy.noResults}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div id={statusId} className="mt-2 text-sm text-[var(--muted)]" aria-live="polite">
        {isValidSelectedAddress(selectedAddress) &&
        !shouldInvalidateSelectedAddress(query, selectedAddress)
          ? copy.addressSelected
          : showTypeMore
              ? copy.typeMore
              : ""}
      </div>
      {mergedError ? (
        <p
          id={errorId}
          className={
            emphasizeError
              ? "mt-3 flex items-start gap-3 rounded-2xl border border-[rgba(185,28,28,0.42)] bg-[rgba(254,226,226,0.82)] px-4 py-3.5 text-sm font-semibold leading-6 text-[#991b1b] shadow-[0_8px_20px_rgba(185,28,28,0.08)]"
              : "mt-2 text-sm font-medium text-[var(--error)]"
          }
          aria-live={emphasizeError ? "assertive" : "polite"}
          role={emphasizeError ? "alert" : undefined}
        >
          {emphasizeError ? <IconAlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
          <span>{mergedError}</span>
        </p>
      ) : null}
    </div>
  );
}
