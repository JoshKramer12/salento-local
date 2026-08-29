import type { BusinessHour } from "@prisma/client";

import type { Locale } from "@/lib/i18n";

type BusinessHourRow = Pick<BusinessHour, "closed" | "dayOfWeek" | "endTime" | "startTime">;

export type ResolvedBusinessHoursDay = {
  closed: boolean;
  dayOfWeek: number;
  intervals: string[];
};

const dayTokenToIndex: Record<string, number> = {
  fr: 4,
  mo: 0,
  sa: 5,
  su: 6,
  th: 3,
  tu: 1,
  we: 2,
};

const localizedDayLabels: Record<Locale, string[]> = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  it: ["Lunedi", "Martedi", "Mercoledi", "Giovedi", "Venerdi", "Sabato", "Domenica"],
};

function normalizeTime(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24) {
    return null;
  }

  if (hour === 24 && minute !== 0) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeInterval(value: string) {
  const match = value.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);

  if (!match) {
    return null;
  }

  const start = normalizeTime(match[1]);
  const end = normalizeTime(match[2]);

  if (!start || !end) {
    return null;
  }

  return `${start}-${end}`;
}

function expandDayExpression(value: string) {
  const indexes = new Set<number>();

  for (const token of value.split(",")) {
    const normalizedToken = token.trim();

    if (!normalizedToken || normalizedToken === "PH") {
      continue;
    }

    const range = normalizedToken.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/i);

    if (range) {
      const startIndex = dayTokenToIndex[range[1].toLowerCase()];
      const endIndex = dayTokenToIndex[range[2].toLowerCase()];

      if (startIndex <= endIndex) {
        for (let index = startIndex; index <= endIndex; index += 1) {
          indexes.add(index);
        }
      } else {
        for (let index = startIndex; index < 7; index += 1) {
          indexes.add(index);
        }

        for (let index = 0; index <= endIndex; index += 1) {
          indexes.add(index);
        }
      }

      continue;
    }

    const singleIndex = dayTokenToIndex[normalizedToken.toLowerCase()];

    if (singleIndex !== undefined) {
      indexes.add(singleIndex);
    }
  }

  return Array.from(indexes).sort((left, right) => left - right);
}

function createEmptySchedule() {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    closed: false,
    dayOfWeek,
    intervals: [] as string[],
  }));
}

export function getLocalizedWeekdayLabel(dayOfWeek: number, locale: Locale = "it") {
  return localizedDayLabels[locale][dayOfWeek] ?? localizedDayLabels[locale][0];
}

export function resolveStructuredBusinessHours(hours: BusinessHourRow[]) {
  if (!hours.length) {
    return null;
  }

  const schedule = createEmptySchedule();

  for (const hour of hours) {
    const row = schedule[hour.dayOfWeek];

    if (!row) {
      continue;
    }

    if (hour.closed) {
      row.closed = true;
      row.intervals = [];
      continue;
    }

    const start = normalizeTime(hour.startTime);
    const end = normalizeTime(hour.endTime);

    if (start && end) {
      row.closed = false;
      row.intervals = [`${start}-${end}`];
    }
  }

  return schedule.map((row) => ({
    ...row,
    closed: row.closed || row.intervals.length === 0,
  }));
}

export function parseOpeningHoursSummary(openingHoursText?: string | null) {
  if (!openingHoursText?.trim()) {
    return null;
  }

  const value = openingHoursText.trim();
  const normalizedValue = value.replace(/\s+/g, " ");

  if (/^24\s*\/\s*7$/i.test(normalizedValue)) {
    return createEmptySchedule().map((row) => ({
      ...row,
      intervals: ["00:00-24:00"],
    }));
  }

  const schedule = createEmptySchedule();
  const fallbackIntervals: string[] = [];
  let sawDaySpecificData = false;

  for (const segment of normalizedValue.split(";")) {
    const trimmedSegment = segment.trim();

    if (!trimmedSegment) {
      continue;
    }

    const match = trimmedSegment.match(
      /^((?:PH|Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:PH|Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.*)$/i,
    );

    const dayExpression = match?.[1] ?? null;
    const remainder = (match?.[2] ?? trimmedSegment).trim();
    const isClosedSegment = /^(closed|off|chiuso)$/i.test(remainder);
    const intervals = remainder
      .split(/\s*\/\s*/)
      .flatMap((part) => part.split(/\s*,\s*/))
      .map(normalizeInterval)
      .filter((interval): interval is string => Boolean(interval));

    if (dayExpression) {
      const dayIndexes = expandDayExpression(dayExpression);

      if (!dayIndexes.length) {
        continue;
      }

      sawDaySpecificData = true;

      for (const dayIndex of dayIndexes) {
        const row = schedule[dayIndex];

        if (isClosedSegment) {
          row.closed = true;
          row.intervals = [];
          continue;
        }

        if (!intervals.length) {
          continue;
        }

        row.closed = false;
        row.intervals.push(...intervals);
      }

      continue;
    }

    if (isClosedSegment) {
      continue;
    }

    if (!intervals.length) {
      return null;
    }

    fallbackIntervals.push(...intervals);
  }

  if (!sawDaySpecificData && !fallbackIntervals.length) {
    return null;
  }

  return schedule.map((row) => {
    const intervals = row.intervals.length
      ? Array.from(new Set(row.intervals))
      : fallbackIntervals.length
        ? Array.from(new Set(fallbackIntervals))
        : [];

    return {
      closed: row.closed || intervals.length === 0,
      dayOfWeek: row.dayOfWeek,
      intervals,
    };
  });
}

export function resolveBusinessHours(
  hours: BusinessHourRow[],
  openingHoursText?: string | null,
) {
  return resolveStructuredBusinessHours(hours) ?? parseOpeningHoursSummary(openingHoursText);
}

function parseMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  return hours * 60 + minutes;
}

export function getBusinessHoursStatus(
  schedule: ResolvedBusinessHoursDay[] | null,
  now = new Date(),
) {
  if (!schedule?.length) {
    return null;
  }

  const todayIndex = (now.getDay() + 6) % 7;
  const previousDayIndex = (todayIndex + 6) % 7;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIntervals = schedule[todayIndex]?.intervals ?? [];
  const previousDayIntervals = schedule[previousDayIndex]?.intervals ?? [];

  const isOpenToday = todayIntervals.some((interval) => {
    const [start, end] = interval.split("-");

    if (!start || !end) {
      return false;
    }

    const startMinutes = parseMinutes(start);
    const endMinutes = parseMinutes(end);

    if (endMinutes > startMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes;
  });

  const isOpenFromPreviousDay = previousDayIntervals.some((interval) => {
    const [start, end] = interval.split("-");

    if (!start || !end) {
      return false;
    }

    const startMinutes = parseMinutes(start);
    const endMinutes = parseMinutes(end);

    return endMinutes <= startMinutes && currentMinutes < endMinutes;
  });

  return {
    isOpen: isOpenToday || isOpenFromPreviousDay,
    todayIndex,
  };
}

export function getBusinessHoursStatusDetail(
  schedule: ResolvedBusinessHoursDay[] | null,
  now = new Date(),
) {
  const status = getBusinessHoursStatus(schedule, now);

  if (!status || !schedule?.length) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIntervals = schedule[status.todayIndex]?.intervals ?? [];
  const currentInterval = todayIntervals.find((interval) => {
    const [start, end] = interval.split("-");
    if (!start || !end) return false;

    const startMinutes = parseMinutes(start);
    const endMinutes = parseMinutes(end);
    return endMinutes > startMinutes
      ? currentMinutes >= startMinutes && currentMinutes < endMinutes
      : currentMinutes >= startMinutes;
  });

  if (status.isOpen && currentInterval) {
    return {
      ...status,
      closesAt: currentInterval.split("-")[1] ?? null,
      opensAt: null,
      opensDayOffset: null,
    };
  }

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const dayIndex = (status.todayIndex + dayOffset) % 7;
    const intervals = schedule[dayIndex]?.intervals ?? [];

    for (const interval of intervals) {
      const [start] = interval.split("-");
      if (!start) continue;

      if (dayOffset > 0 || parseMinutes(start) > currentMinutes) {
        return {
          ...status,
          closesAt: null,
          opensAt: start,
          opensDayOffset: dayOffset,
        };
      }
    }
  }

  return {
    ...status,
    closesAt: null,
    opensAt: null,
    opensDayOffset: null,
  };
}

export function formatOpeningHoursFallback(
  openingHoursText?: string | null,
  locale: Locale = "it",
) {
  if (!openingHoursText?.trim()) {
    return locale === "it" ? "Orari da confermare" : "Hours to confirm";
  }

  return openingHoursText
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("\n");
}
