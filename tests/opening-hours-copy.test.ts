import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { copyHoursToDays, countConfiguredDestinations, hasConfiguredHours, isCompleteCopySource, type CopyableHoursDay } from "../src/lib/opening-hours-copy";

const empty = (day: string): CopyableHoursDay => ({
  day, open1: "", close1: "", open2: "", close2: "", closed: false, split: false,
});

test("copying Tuesday changes only selected days and remains a one-time edit", () => {
  const monday = { ...empty("monday"), closed: true };
  const tuesday = { ...empty("tuesday"), open1: "09:00", close1: "18:00" };
  const wednesday = { ...empty("wednesday"), open1: "10:00", close1: "16:00" };
  const sunday = { ...empty("sunday"), closed: true };
  const original = [monday, tuesday, wednesday, empty("thursday"), sunday];
  const copied = copyHoursToDays(original, "tuesday", new Set(["wednesday", "thursday"]));

  assert.deepEqual(copied[0], monday);
  assert.deepEqual(copied[1], tuesday);
  assert.deepEqual(copied[2], { ...tuesday, day: "wednesday" });
  assert.deepEqual(copied[3], { ...tuesday, day: "thursday" });
  assert.deepEqual(copied[4], sunday);
  assert.deepEqual(original[2], wednesday);
  tuesday.open1 = "11:00";
  assert.equal(copied[2].open1, "09:00");
});

test("closed days and both periods copy; no evening period clears old values", () => {
  const destination = { ...empty("friday"), open1: "08:00", close1: "12:00", open2: "16:00", close2: "21:00", split: true };
  const closed = copyHoursToDays([{ ...empty("monday"), closed: true }, destination], "monday", new Set(["friday"]))[1];
  assert.deepEqual(closed, { ...empty("friday"), closed: true });

  const split = { ...empty("tuesday"), open1: "09:00", close1: "13:00", open2: "17:00", close2: "22:00", split: true };
  assert.deepEqual(copyHoursToDays([split, destination], "tuesday", new Set(["friday"]))[1], { ...split, day: "friday" });

  const single = { ...empty("tuesday"), open1: "09:00", close1: "18:00", open2: "17:00", close2: "22:00" };
  assert.deepEqual(copyHoursToDays([single, destination], "tuesday", new Set(["friday"]))[1], { ...single, day: "friday", open2: "", close2: "" });
});

test("incomplete sources cannot copy and configured destinations require warning", () => {
  const partial = { ...empty("tuesday"), open1: "09:00" };
  const splitPartial = { ...partial, close1: "13:00", split: true, open2: "17:00" };
  assert.equal(isCompleteCopySource(partial), false);
  assert.equal(isCompleteCopySource(splitPartial), false);
  assert.equal(isCompleteCopySource({ ...splitPartial, close2: "21:00" }), true);
  assert.equal(isCompleteCopySource({ ...empty("monday"), closed: true }), true);
  assert.equal(hasConfiguredHours(empty("monday")), false);
  assert.equal(hasConfiguredHours({ ...empty("monday"), closed: true }), true);
  assert.equal(hasConfiguredHours(partial), true);
  assert.equal(countConfiguredDestinations([empty("monday"), partial], new Set(["monday"])), 0);
  assert.equal(countConfiguredDestinations([empty("monday"), partial], new Set(["tuesday"])), 1);
  const original = [partial, empty("wednesday")];
  assert.equal(copyHoursToDays(original, "tuesday", new Set(["wednesday"])), original);
});

test("copied hours survive the existing JSON draft round trip", () => {
  const hours = [empty("monday"), { ...empty("tuesday"), open1: "09:00", close1: "18:00" }, empty("wednesday")];
  const copied = copyHoursToDays(hours, "tuesday", new Set(["wednesday"]));
  assert.deepEqual(JSON.parse(JSON.stringify(copied)), copied);

  const form = readFileSync("src/components/account/publish-form.tsx", "utf8");
  assert.match(form, /openingHours: openingHoursValue/);
  assert.match(form, /setHours\(parseOpeningHours\(nextSubmission\.openingHours\)\)/);
  assert.match(form, /Copy to other days/);
  assert.match(form, /Copia su altri giorni/);
  assert.match(form, /Replace existing hours\?/);
  assert.match(form, /Sostituire gli orari esistenti\?/);
  assert.match(form, /setCopyDestinations\(new Set\(\)\)/);
  assert.match(form, /disabled=\{copyDestinations\.size === 0\}/);
  assert.match(form, /dialog\.showModal\(\)/);
  const cancelAction = form.slice(form.indexOf("function closeHoursCopy()"), form.indexOf("function confirmHoursCopy()"));
  assert.doesNotMatch(cancelAction, /setHours/);
  assert.match(form, /if \(overwriteCount > 0 && !copyReplacePending\)/);
});
