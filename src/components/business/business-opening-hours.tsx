import type { Locale } from "@/lib/i18n";
import {
  formatOpeningHoursFallback,
  getBusinessHoursStatus,
  getLocalizedWeekdayLabel,
  type ResolvedBusinessHoursDay,
} from "@/lib/business-hours";

type BusinessOpeningHoursProps = {
  locale?: Locale;
  openingHoursText?: string | null;
  schedule: ResolvedBusinessHoursDay[] | null;
};

export function BusinessOpeningHours({
  locale = "it",
  openingHoursText,
  schedule,
}: BusinessOpeningHoursProps) {
  const status = getBusinessHoursStatus(schedule);
  const copy =
    locale === "it"
      ? {
          closed: "Chiuso",
          closedNow: "Chiuso ora",
          openNow: "Aperto ora",
          subtitle:
            "Orari leggibili e facili da controllare prima di chiamare o partire.",
          title: "Orari di apertura",
        }
      : {
          closed: "Closed",
          closedNow: "Closed now",
          openNow: "Open now",
          subtitle: "Readable opening times before you call or head over.",
          title: "Opening hours",
        };

  return (
    <section className="rounded-[1.7rem] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_10px_26px_rgba(66,51,31,0.05)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-3xl text-[var(--foreground)]">{copy.title}</h2>
        {status ? (
          <span className={status.isOpen ? "pill-success" : "pill-warning"}>
            {status.isOpen ? copy.openNow : copy.closedNow}
          </span>
        ) : null}
      </div>
      {schedule?.length ? (
        <div className="mt-5 divide-y divide-[rgba(232,222,208,0.7)] rounded-[1.25rem] bg-[color:rgba(247,244,239,0.76)] px-3">
          {schedule.map((day) => {
            const isToday = day.dayOfWeek === status?.todayIndex;
            const hoursLabel = day.closed ? copy.closed : day.intervals.join(" / ");

            return (
              <div
                key={day.dayOfWeek}
                className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 px-2 py-2.5 text-sm sm:px-3 ${
                  isToday ? "rounded-lg bg-[rgba(42,98,87,0.08)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--foreground)]">
                    {getLocalizedWeekdayLabel(day.dayOfWeek, locale)}
                  </span>
                  {isToday ? (
                    <span className="text-[0.68rem] font-semibold text-[var(--primary)]">
                      {locale === "it" ? "Oggi" : "Today"}
                    </span>
                  ) : null}
                </div>
                <div className="text-right text-sm text-[var(--muted-strong)]">{hoursLabel.replaceAll("-", " – ")}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-[1.25rem] bg-[color:rgba(247,244,239,0.76)] p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-[var(--muted-strong)]">
            {formatOpeningHoursFallback(openingHoursText, locale)}
          </pre>
        </div>
      )}
    </section>
  );
}
