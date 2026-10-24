import assert from "node:assert/strict";
import test from "node:test";
import { nextScheduledAt, normalizeCalendarDates, normalizeCollectionTimes, scheduleOf, scheduleWindow } from "@aihot/backend/sources/schedule";

test("collection schedule defaults to the two Beijing tender windows", () => {
  const defaults = scheduleOf(null);
  assert.deepEqual(defaults.times, ["08:00", "17:00"]);
  assert.equal(defaults.timezone, "Asia/Shanghai");
  assert.equal(defaults.skipPublicHolidays, true);
  assert.equal(defaults.calendar.year, 2026);
  assert.deepEqual(normalizeCollectionTimes(["17:00", "08:00", "08:00"]), ["08:00", "17:00"]);
});

test("next tender collection follows the configured Beijing slots", () => {
  const beforeMorning = new Date("2026-10-14T07:30:00+08:00");
  const afterMorning = new Date("2026-10-14T08:01:00+08:00");
  const afterEvening = new Date("2026-10-14T18:00:00+08:00");
  assert.equal(nextScheduledAt(beforeMorning, ["08:00", "17:00"]).toISOString(), "2026-10-14T00:00:00.000Z");
  assert.equal(nextScheduledAt(afterMorning, ["08:00", "17:00"]).toISOString(), "2026-10-14T09:00:00.000Z");
  assert.equal(nextScheduledAt(afterEvening, ["08:00", "17:00"]).toISOString(), "2026-10-15T00:00:00.000Z");
});

test("the scheduler only opens a short window around a configured slot", () => {
  assert.equal(scheduleWindow(new Date("2026-10-14T08:01:00+08:00"), ["08:00", "17:00"]).active, true);
  assert.equal(scheduleWindow(new Date("2026-10-14T08:03:00+08:00"), ["08:00", "17:00"]).active, false);
});

test("statutory days off skip automatic tender runs while adjusted workdays run", () => {
  const schedule = scheduleOf(null);
  const holiday = new Date("2026-10-01T08:01:00+08:00");
  assert.equal(scheduleWindow(holiday, schedule.times, 60, schedule).active, false);
  assert.equal(nextScheduledAt(holiday, schedule.times, schedule).toISOString(), "2026-10-08T00:00:00.000Z");

  const adjustedWorkday = new Date("2026-10-10T08:01:00+08:00");
  assert.equal(scheduleWindow(adjustedWorkday, schedule.times, 60, schedule).active, true);
  assert.equal(nextScheduledAt(adjustedWorkday, schedule.times, schedule).toISOString(), "2026-10-10T09:00:00.000Z");
});

test("holiday date editing validates real dates in the selected year", () => {
  assert.deepEqual(normalizeCalendarDates(["2026-05-02", "2026-05-01", "2026-05-01"], 2026), ["2026-05-01", "2026-05-02"]);
  assert.throws(() => normalizeCalendarDates(["2026-02-30"], 2026), /有效日期/);
  assert.throws(() => normalizeCalendarDates(["2025-12-31"], 2026), /有效日期/);
});
