import assert from "node:assert/strict";
import test from "node:test";
import { explicitProcurementDeadline, procurementDeadlinePassed } from "@aihot/backend/editorial/deadline";

test("reads Chinese procurement cutoffs with whitespace and defaults date-only deadlines to end of day", () => {
  const material = { title: "咨询服务", bodyText: "投标截止时间为 202 6 年 10 月 10 日 10 时 00 分。" };
  assert.equal(explicitProcurementDeadline(material)?.toISOString(), "2026-10-10T02:00:00.000Z");
  assert.equal(explicitProcurementDeadline({ title: "招标", bodyText: "开标时间：2026年10月10日10:30。" })?.toISOString(), "2026-10-10T02:30:00.000Z");
  assert.equal(explicitProcurementDeadline({ title: "招标", bodyText: "投标截止时间：2026年10月10日。" })?.toISOString(), "2026-10-10T15:59:59.999Z");
});

test("compares a cutoff against the supplied clock and ignores unlabelled dates", () => {
  const now = new Date("2026-10-21T08:00:00.000Z");
  assert.equal(procurementDeadlinePassed({ title: "招标", bodyText: "投标截止时间为2026年10月10日10时。" }, now), true);
  assert.equal(procurementDeadlinePassed({ title: "招标", bodyText: "预计2026年10月10日发布。" }, now), false);
  assert.equal(procurementDeadlinePassed({ title: "招标", bodyText: "投标截止时间为2026年10月21日。" }, now), false);
});
