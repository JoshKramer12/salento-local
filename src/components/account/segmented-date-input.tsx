"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { Locale } from "@/lib/i18n";

type SegmentedDateInputProps = {
  locale: Locale;
  name: string;
  onChange?: (value: string) => void;
  value?: string;
};

type DateParts = {
  day: string;
  month: string;
  year: string;
};

function parseDateValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { day: "", month: "", year: "" };
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return {
      day: isoMatch[3],
      month: isoMatch[2],
      year: isoMatch[1],
    };
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{0,4})$/);

  if (slashMatch) {
    return {
      day: slashMatch[1].slice(0, 2),
      month: slashMatch[2].slice(0, 2),
      year: slashMatch[3].slice(0, 4),
    };
  }

  const digitsOnly = trimmed.replace(/\D/g, "").slice(0, 8);

  return {
    day: digitsOnly.slice(0, 2),
    month: digitsOnly.slice(2, 4),
    year: digitsOnly.slice(4, 8),
  };
}

function isValidDateParts(parts: DateParts) {
  if (parts.day.length !== 2 || parts.month.length !== 2 || parts.year.length !== 4) {
    return false;
  }

  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return false;
  }

  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function buildSubmittedValue(parts: DateParts) {
  if (isValidDateParts(parts)) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  if (!parts.day && !parts.month && !parts.year) {
    return "";
  }

  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function SegmentedDateInput({
  locale,
  name,
  onChange,
  value = "",
}: SegmentedDateInputProps) {
  const initialParts = useMemo(() => parseDateValue(value), [value]);
  const [parts, setParts] = useState<DateParts>(initialParts);
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const restoreParts = useEffectEvent((nextValue: string) => {
    setParts(parseDateValue(nextValue));
  });

  useEffect(() => {
    startTransition(() => {
      restoreParts(value);
    });
  }, [value]);

  const submittedValue = useMemo(() => buildSubmittedValue(parts), [parts]);

  useEffect(() => {
    onChange?.(submittedValue);
  }, [onChange, submittedValue]);

  function updatePart(key: keyof DateParts, nextValue: string) {
    const digits = nextValue.replace(/\D/g, "");
    const maxLength = key === "year" ? 4 : 2;
    const normalizedValue = digits.slice(0, maxLength);

    setParts((current) => ({
      ...current,
      [key]: normalizedValue,
    }));

    if (normalizedValue.length === maxLength) {
      if (key === "day") {
        monthRef.current?.focus();
      } else if (key === "month") {
        yearRef.current?.focus();
      }
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    key: keyof DateParts,
  ) {
    if (event.key !== "Backspace") {
      return;
    }

    const valueForKey = parts[key];

    if (valueForKey) {
      return;
    }

    if (key === "month") {
      dayRef.current?.focus();
    } else if (key === "year") {
      monthRef.current?.focus();
    }
  }

  const labels =
    locale === "it"
      ? {
          day: "Giorno",
          month: "Mese",
          year: "Anno",
        }
      : {
          day: "Day",
          month: "Month",
          year: "Year",
        };

  return (
    <>
      <input type="hidden" name={name} value={submittedValue} />
      <div className="grid grid-cols-[minmax(0,0.9fr)_auto_minmax(0,0.9fr)_auto_minmax(0,1.2fr)] items-center gap-2">
        <input
          ref={dayRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-day"
          placeholder="DD"
          aria-label={labels.day}
          value={parts.day}
          onChange={(event) => updatePart("day", event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, "day")}
          maxLength={2}
          className="input-field text-center tracking-[0.12em]"
        />
        <span aria-hidden="true" className="text-lg text-[var(--muted)]">/</span>
        <input
          ref={monthRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-month"
          placeholder="MM"
          aria-label={labels.month}
          value={parts.month}
          onChange={(event) => updatePart("month", event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, "month")}
          maxLength={2}
          className="input-field text-center tracking-[0.12em]"
        />
        <span aria-hidden="true" className="text-lg text-[var(--muted)]">/</span>
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="bday-year"
          placeholder="YYYY"
          aria-label={labels.year}
          value={parts.year}
          onChange={(event) => updatePart("year", event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, "year")}
          maxLength={4}
          className="input-field text-center tracking-[0.12em]"
        />
      </div>
    </>
  );
}
