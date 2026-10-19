import type { Locale } from "@/lib/i18n";
import { isCompleteCopySource, type CopyableHoursDay } from "@/lib/opening-hours-copy";

export function getIncompleteHoursDays<T extends CopyableHoursDay>(hours: T[]) {
  return hours.filter((day) => !isCompleteCopySource(day));
}

export function formatIncompleteHoursMessage(dayNames: string[], locale: Locale) {
  if (dayNames.length === 0) return "";

  if (locale === "it") {
    const names = new Intl.ListFormat("it", { style: "long", type: "conjunction" })
      .format(dayNames.map((name) => name.toLocaleLowerCase("it")));
    return dayNames.length === 1
      ? `Gli orari di ${names} sono incompleti. Inserisci gli orari oppure seleziona 'Chiuso'.`
      : `Gli orari di ${names} sono incompleti. Inserisci gli orari oppure seleziona 'Chiuso' per questi giorni.`;
  }

  if (dayNames.length === 1) {
    return `${dayNames[0]}'s opening hours are incomplete. Enter the hours or mark the day as closed.`;
  }

  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(dayNames);
  return `Opening hours are incomplete for ${names}. Enter the hours or mark these days as closed.`;
}
