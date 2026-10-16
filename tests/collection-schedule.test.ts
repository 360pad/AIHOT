import assert from "node:assert/strict";
import test from "node:test";
import { nextScheduledAt, normalizeCollectionTimes, scheduleOf, scheduleWindow } from "@aihot/backend/sources/schedule";

test("collection schedule defaults to the two Beijing tender windows", () => {
  assert.deepEqual(scheduleOf(null), { times: ["08:00", "17:00"], timezone: "Asia/Shanghai" });
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
