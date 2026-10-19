import assert from "node:assert/strict";
import test from "node:test";

import { formatIncompleteHoursMessage, getIncompleteHoursDays } from "../src/lib/opening-hours-feedback";
import type { CopyableHoursDay } from "../src/lib/opening-hours-copy";

const empty = (day: string): CopyableHoursDay => ({
  day, open1: "", close1: "", open2: "", close2: "", closed: false, split: false,
});

test("all seven days need hours or Closed before Continue", () => {
  const hours = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(empty);
  assert.equal(getIncompleteHoursDays(hours).length, 7);
  assert.deepEqual(getIncompleteHoursDays(hours.map((day) => ({ ...day, closed: true }))), []);
});

test("incomplete days include blanks and missing enabled evening fields, but exclude closed and complete days", () => {
  const hours = [
    { ...empty("monday"), closed: true },
    empty("tuesday"),
    { ...empty("wednesday"), open1: "09:00", close1: "18:00" },
    { ...empty("thursday"), open1: "09:00", close1: "13:00", split: true, open2: "17:00" },
    { ...empty("friday"), open1: "09:00", close1: "13:00", split: true, open2: "17:00", close2: "21:00" },
    { ...empty("saturday"), open1: "18:00", close1: "09:00" },
  ];
  assert.deepEqual(getIncompleteHoursDays(hours).map((day) => day.day), ["tuesday", "thursday"]);

  hours[1] = { ...hours[1], closed: true };
  hours[3] = { ...hours[3], close2: "21:00" };
  assert.deepEqual(getIncompleteHoursDays(hours), []);
});

test("English feedback names one or several incomplete days", () => {
  assert.equal(formatIncompleteHoursMessage(["Tuesday"], "en"),
    "Tuesday's opening hours are incomplete. Enter the hours or mark the day as closed.");
  assert.equal(formatIncompleteHoursMessage(["Tuesday", "Wednesday", "Friday"], "en"),
    "Opening hours are incomplete for Tuesday, Wednesday, and Friday. Enter the hours or mark these days as closed.");
});

test("Italian feedback names one or several incomplete days", () => {
  assert.equal(formatIncompleteHoursMessage(["Martedì"], "it"),
    "Gli orari di martedì sono incompleti. Inserisci gli orari oppure seleziona 'Chiuso'.");
  assert.equal(formatIncompleteHoursMessage(["Martedì", "Mercoledì", "Venerdì"], "it"),
    "Gli orari di martedì, mercoledì e venerdì sono incompleti. Inserisci gli orari oppure seleziona 'Chiuso' per questi giorni.");
  assert.equal(formatIncompleteHoursMessage([], "it"), "");
});
