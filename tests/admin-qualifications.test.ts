import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { assessQualificationRequirements, createBusinessQualification, deleteBusinessQualification, listBusinessQualifications, updateBusinessQualification } from "@aihot/backend/admin/qualifications";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

after(async () => { await closeDb(); });

test("qualification lists support create, edit, duplicate prevention and removal", async () => {
  const actor = "test:admin-qualifications";
  const name = `测绘资质（乙级）-${suffix}`;
  const created = await createBusinessQualification({ category: "company", name }, actor);
  assert.equal(created?.category, "company");
  assert.equal(created?.name, name);
  assert.ok((await listBusinessQualifications("company")).rows.some((item) => item.id === created?.id));
  await assert.rejects(createBusinessQualification({ category: "company", name: `测绘资质（乙级）-${suffix}` }, actor), /已在清单中/);

  const updated = await updateBusinessQualification(created!.id, { name: `测绘资质甲级-${suffix}` }, actor);
  assert.equal(updated?.name, `测绘资质甲级-${suffix}`);
  assert.deepEqual(await deleteBusinessQualification(created!.id, actor), { id: created!.id });
  assert.equal((await listBusinessQualifications("company")).rows.some((item) => item.id === created!.id), false);
  assert.equal(await updateBusinessQualification(created!.id, { name: "不应恢复" }, actor), null);

  const [auditCount] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM audit_log WHERE actor = ${actor} AND subject = ${`qualification:${created!.id}`}`;
  assert.equal(auditCount?.count, 3);
});

test("qualification comparison keeps company and personnel lists separate and recognizes common certificate names", () => {
  const result = assessQualificationRequirements([
    { kind: "company", requirement: "测绘资质（乙级）", evidenceIds: ["e1"] },
    { kind: "personnel", requirement: "一级建造师", evidenceIds: ["e2"] },
    { kind: "company", requirement: "甲级测绘资质", evidenceIds: ["e3"] },
  ], [
    { id: 1, category: "company", name: "测绘资质乙级" },
    { id: 2, category: "personnel", name: "一建" },
  ]);
  assert.equal(result[0]?.matchedName, "测绘资质乙级");
  assert.equal(result[1]?.matchedName, "一建");
  assert.equal(result[2]?.matchedName, null);
});
