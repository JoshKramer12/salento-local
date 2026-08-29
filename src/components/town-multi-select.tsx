"use client";

import {
  IconChevronDown,
  IconMapPin,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n";

export type TownFilterOption = {
  name: string;
  slug: string;
};

type TownMultiSelectProps = {
  locale?: Locale;
  onChange: (slugs: string[]) => void;
  options: TownFilterOption[];
  selectedSlugs: string[];
};

export function TownMultiSelect({
  locale = "it",
  onChange,
  options,
  selectedSlugs,
}: TownMultiSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const copy =
    locale === "it"
      ? {
          noResults: "Nessun risultato trovato",
          placeholder: "Cerca e aggiungi comuni",
          selected: "Comuni selezionati",
          town: "Comune",
        }
      : {
          noResults: "No results found",
          placeholder: "Search and add towns",
          selected: "Selected towns",
          town: "Town",
        };

  const selectedTowns = useMemo(
    () =>
      selectedSlugs
        .map((slug) => options.find((option) => option.slug === slug) ?? null)
        .filter((option): option is TownFilterOption => Boolean(option)),
    [options, selectedSlugs],
  );

  const availableOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return options.filter((option) => {
      if (selectedSlugs.includes(option.slug)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return option.name.toLowerCase().includes(normalizedQuery);
    });
  }, [options, query, selectedSlugs]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function addTown(slug: string) {
    if (selectedSlugs.includes(slug)) {
      return;
    }

    onChange([...selectedSlugs, slug]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function removeTown(slug: string) {
    onChange(selectedSlugs.filter((value) => value !== slug));
  }

  return (
    <div ref={containerRef} className="field-label relative">
      <span>{copy.town}</span>
      <div
        className="input-field flex min-h-[58px] flex-wrap items-center gap-2 py-2.5"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {selectedTowns.map((town) => (
          <span
            key={town.slug}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--secondary)] px-3 py-1.5 text-sm text-[var(--foreground)]"
          >
            <IconMapPin size={13} className="text-[var(--primary)]" />
            {town.name}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                removeTown(town.slug);
              }}
              className="rounded-full p-0.5 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
              aria-label={`${copy.selected}: ${town.name}`}
            >
              <IconX size={12} />
            </button>
          </span>
        ))}

        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <IconSearch size={15} className="shrink-0 text-[var(--muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && selectedSlugs.length) {
                removeTown(selectedSlugs[selectedSlugs.length - 1]);
              }
            }}
            placeholder={selectedTowns.length ? copy.placeholder : copy.placeholder}
            className="min-w-[8rem] flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
            aria-label={copy.placeholder}
          />
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
            inputRef.current?.focus();
          }}
          className="ml-auto rounded-full p-1 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          aria-label={copy.town}
        >
          <IconChevronDown size={16} />
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.6rem)] z-50 overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
          <div className="max-h-[18rem] overflow-y-auto py-2">
            {availableOptions.length ? (
              availableOptions.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addTown(option.slug)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:rgba(247,244,239,0.7)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-[var(--primary)]">
                    <IconMapPin size={16} />
                  </span>
                  <span className="text-sm font-medium text-[var(--foreground)]">{option.name}</span>
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-[var(--muted)]">{copy.noResults}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
