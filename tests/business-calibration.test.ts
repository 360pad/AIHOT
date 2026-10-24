import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { BUSINESS_PROFILE, businessCalibrationExamples } from "@aihot/backend/editorial/business";

const sourceId = `test-business-learning-${Date.now().toString(36)}`;

after(async () => {
  await sql`DELETE FROM business_matching_feedback WHERE article_id IN (SELECT id FROM articles WHERE source_id = ${sourceId})`;
  await sql`DELETE FROM articles WHERE source_id = ${sourceId}`;
  await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  await closeDb();
});

test("manual labels are reused for semantic cases without literal keyword overlap and preserve candidate capability phrases", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${sourceId}, 'Business learning test', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: "https://example.invalid/human-labeled", title: "人工标定的堤防隐患探测采购任务", bodyText: "采购堤防内部隐患探测与成果报告。", bodyStatus: "ok", via: "fetch" } as never);
  const originalResult = {
    output: {
      businessMatch: {
        projects: [{ tasks: [{
          name: "堤防隐患探测",
          action: "探测",
          object: "堤防内部隐患",
          deliverables: ["成果报告"],
          matches: [],
        }] }],
      },
    },
  };
  await sql`INSERT INTO business_matching_feedback (article_id, label, capability_ids, original_result, created_by)
    VALUES (${articleId}, 'relevant', ARRAY['monitoring-integration'], ${sql.json(originalResult as never)}, 'test')`;
  const examples = await businessCalibrationExamples({ id: "semantic-target", title: "节制闸诊断与维修决策治理", bodyText: "采购闸门设备诊断及维修决策支持系统。", excerpt: null }, BUSINESS_PROFILE);
  const example = examples.find((item) => item.articleId === articleId);
  assert.ok(example, "no exact configured keyword overlap should not suppress labeled examples");
  assert.equal(example.label, "relevant");
  assert.ok(example.candidatePhrases.some((item) => item.phrase === "堤防隐患探测" && item.capabilityId === "monitoring-integration"));
});
