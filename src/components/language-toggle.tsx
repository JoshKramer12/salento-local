"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconChevronDown } from "@tabler/icons-react";

import {
  dispatchLocaleSwitchComplete,
  dispatchLocaleSwitchStart,
} from "@/components/locale-transition-overlay";
import { localeLabels, type Locale } from "@/lib/i18n";

type LanguageToggleProps = {
  locale: Locale;
  variant?: "compact" | "segmented";
};

const locales: Locale[] = ["it", "en"];

function writeLocaleCookie(locale: Locale) {
  document.cookie = `salento_locale=${encodeURIComponent(locale)}; max-age=${60 * 60 * 24 * 365}; path=/; samesite=lax`;
}

export function LanguageToggle({ locale, variant = "segmented" }: LanguageToggleProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const query = searchParams.toString();
  const redirectTo = `${pathname}${query ? `?${query}` : ""}`;
  const isPending = pendingLocale !== null;
  const activeLocale = pendingLocale ?? locale;

  useEffect(() => {
    if (pendingLocale === locale) {
      const completionTimer = window.setTimeout(() => {
        dispatchLocaleSwitchComplete();
        setPendingLocale(null);
      }, 0);

      return () => window.clearTimeout(completionTimer);
    }
  }, [locale, pendingLocale]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleLocaleChange(nextLocale: Locale) {
    if (nextLocale === locale || isPending) {
      return;
    }

    dispatchLocaleSwitchStart();
    setPendingLocale(nextLocale);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      dispatchLocaleSwitchComplete();
      setPendingLocale((current) => (current === nextLocale ? null : current));
      resetTimerRef.current = null;
    }, 2500);

    try {
      writeLocaleCookie(nextLocale);
      document.documentElement.setAttribute("lang", nextLocale);
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale: nextLocale }),
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`Locale update failed with status ${response.status}`);
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      console.error("Unable to switch locale", error);
      window.location.assign(
        `/api/locale?locale=${encodeURIComponent(nextLocale)}&redirectTo=${encodeURIComponent(redirectTo)}`,
      );
    }
  }

  if (variant === "compact") {
    return (
      <label className="relative inline-flex h-10 items-center text-sm font-semibold text-[var(--foreground)]">
        <span className="sr-only">{locale === "it" ? "Cambia lingua" : "Change language"}</span>
        <select
          className="h-10 appearance-none rounded-xl border-0 bg-transparent py-0 pl-2 pr-7 text-sm font-semibold uppercase text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[rgba(42,98,87,0.32)]"
          aria-label={locale === "it" ? "Cambia lingua" : "Change language"}
          disabled={isPending}
          value={activeLocale}
          onChange={(event) => void handleLocaleChange(event.target.value as Locale)}
        >
          {locales.map((value) => (
            <option key={value} value={value}>
              {value.toUpperCase()}
            </option>
          ))}
        </select>
        <IconChevronDown
          size={15}
          stroke={2}
          className="pointer-events-none absolute right-1.5 text-[var(--foreground)]"
        />
      </label>
    );
  }

  return (
    <div
      className="relative z-20 inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--card)] p-1 shadow-[var(--shadow-card)]"
      aria-label="Language switcher"
    >
      {locales.map((value) => {
        const isActive = value === activeLocale;
        const isSwitchingToValue = pendingLocale === value;

        return (
          <button
            key={value}
            type="button"
            className={`relative z-20 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            } ${isSwitchingToValue ? "opacity-70" : ""}`}
            aria-current={isActive ? "true" : undefined}
            aria-pressed={isActive}
            disabled={isPending || isActive}
            title={localeLabels[value]}
            onClick={() => handleLocaleChange(value)}
          >
            {value.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
