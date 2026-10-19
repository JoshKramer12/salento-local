export type CopyableHoursDay = {
  day: string;
  open1: string;
  close1: string;
  open2: string;
  close2: string;
  closed: boolean;
  split: boolean;
};

export function isCompleteCopySource(day: CopyableHoursDay) {
  return day.closed || Boolean(day.open1 && day.close1 && (!day.split || (day.open2 && day.close2)));
}

export function hasConfiguredHours(day: CopyableHoursDay) {
  return day.closed || day.split || Boolean(day.open1 || day.close1 || day.open2 || day.close2);
}

export function countConfiguredDestinations<T extends CopyableHoursDay>(
  hours: T[], destinationDays: ReadonlySet<string>,
) {
  return hours.filter((day) => destinationDays.has(day.day) && hasConfiguredHours(day)).length;
}

export function copyHoursToDays<T extends CopyableHoursDay>(
  hours: T[],
  sourceDay: string,
  destinationDays: ReadonlySet<string>,
): T[] {
  const source = hours.find((day) => day.day === sourceDay);
  if (!source || !isCompleteCopySource(source)) return hours;

  return hours.map((day) =>
    day.day === sourceDay || !destinationDays.has(day.day)
      ? day
      : {
          ...day,
          open1: source.closed ? "" : source.open1,
          close1: source.closed ? "" : source.close1,
          open2: source.closed || !source.split ? "" : source.open2,
          close2: source.closed || !source.split ? "" : source.close2,
          closed: source.closed,
          split: source.closed ? false : source.split,
        },
  );
}
