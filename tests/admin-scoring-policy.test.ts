import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { getScoringPolicy, updateScoringPolicy } from "@aihot/backend/admin/scoring-policy";

after(async () => {
  await closeDb();
});

test("admin scoring policy saves, audits and rejects invalid weights", async () => {
  const before = await getScoringPolicy();
  const reason = `test scoring policy ${Date.now()}`;
  const actor = "test:admin-scoring-policy";
  const next = { weights: { fit: 55, region: 30, deadline: 15 }, dueSoonDays: 5 };
  try {
    const saved = await updateScoringPolicy({ ...next, reason }, actor);
    assert.deepEqual({ weights: saved.weights, dueSoonDays: saved.dueSoonDays }, next);
    assert.ok(saved.updatedAt);
    assert.deepEqual(await getScoringPolicy().then(({ weights, dueSoonDays }) => ({ weights, dueSoonDays })), next);
    const [entry] = await sql<{ actor: string; action: string; reason: string; after: { weights: typeof next.weights; dueSoonDays: number } }[]>`
      SELECT actor, action, reason, after FROM audit_log WHERE subject = 'settings:editorial.scoring_policy' AND reason = ${reason}`;
    assert.deepEqual([entry?.actor, entry?.action, entry?.after], [actor, "settings.scoring_policy", next]);
    await assert.rejects(updateScoringPolicy({ weights: { fit: 60, region: 25, deadline: 10 }, dueSoonDays: 4, reason }, actor), /合计必须为 100/);
    assert.deepEqual(await getScoringPolicy().then(({ weights, dueSoonDays }) => ({ weights, dueSoonDays })), next);
  } finally {
    await updateScoringPolicy({ weights: before.weights, dueSoonDays: before.dueSoonDays, reason: "restore test setting" }, actor);
  }
});
