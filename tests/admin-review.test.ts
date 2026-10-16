import "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { listArticleReviews } from "@aihot/backend/admin/review";

const T = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SOURCE = `review-filter-${T}`;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${SOURCE}, 'Review filter test', 'rss', 'T1', 'editorial', '2100-01-01')`;
});

after(async () => {
  await closeDb();
});

test("the review table exposes prefilter HTTP 402 failures and keeps all-history days=0", async () => {
  const articleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-filter-${T}`, title: `地下管线三维探测复核 ${T}`,
    bodyText: "采购地下管线三维探测及空间数据建库服务。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  await sql`UPDATE articles SET discovered_at = now() - interval '400 days' WHERE id = ${articleId}`;
  const [receipt] = await sql<{ id: number }[]>`
    INSERT INTO receipts (logical_key, service, purpose, subject, status, error)
    VALUES (${`review-filter-${T}`}, 'llm', 'prefilter_article', ${`article:${articleId}@1`}, 'failed', 'HTTP 402: test fixture')
    RETURNING id`;
  await sql`INSERT INTO receipt_attempts (receipt_id, attempt, service, status, error)
    VALUES (${receipt!.id}, 1, 'llm', 'failed', 'HTTP 402: test fixture')`;

  const result = await listArticleReviews({ q: T, filter: "prefilter-402", days: 0 });
  assert.equal(result.days, 0);
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.article_id, articleId);
  assert.equal(result.rows[0]?.prefilter_402_failed, true);

  const candidates = await listArticleReviews({ q: T, filter: "prefilter-402-keyword", days: 0 });
  assert.equal(candidates.total, 1);
  assert.ok(candidates.rows[0]?.positiveHits.length);
  assert.equal(candidates.rows[0]?.negativeHits.length, 0);
});

test("UNKNOWN decisions remain in the unreviewed queue and have a dedicated manual-review filter", async () => {
  const articleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-unknown-${T}`, title: `待人工判读项目 ${T}`,
    bodyText: "网页解析未能取得采购范围。", bodyStatus: "unconfirmed", via: "fetch",
  } as never)).articleId;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
    VALUES (${articleId}, 1, 'model', 'unknown', false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "网页正文未解析，标题未说明采购对象" } })})`;

  const queue = await listArticleReviews({ q: T, days: 0 });
  assert.equal(queue.filter, "unreviewed");
  assert.ok(queue.rows.some((row) => row.article_id === articleId));
  assert.equal("body_text" in queue.rows.find((row) => row.article_id === articleId)!, false, "full article bodies stay in the database and are never copied into the review-list response");
  const unknown = await listArticleReviews({ q: T, filter: "unknown", days: 0 });
  assert.equal(unknown.total, 1);
  assert.equal(unknown.rows[0]?.relevance, "unknown");
});

test("review rows show summary and extracted tender basics without returning full article text", async () => {
  const articleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-facts-${T}`, title: `招标项目基本信息复核 ${T}`,
    excerpt: "这是公告摘要。", bodyText: "采购人：南京市水务局。采购预算：200万元。项目实施地点：南京市。投标截止时间前应完成电子保函提交。投标文件递交截止时间：2026年11月4日09:30。采购方式：公开招标。正文较长，供列表裁剪。",
    bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, output)
    VALUES (${articleId}, 1, 'model', 'pass', 'smart-water', '招标项目', '采购南京市水务局的水利信息化项目。', ${sql.json({
      itemType: "tender_notice",
      businessMatch: { organizations: [{ name: "南京市水务局", role: "purchaser" }] },
    })})`;

  const result = await listArticleReviews({ q: T, filter: "all", days: 0 });
  const row = result.rows.find((item) => item.article_id === articleId)!;
  assert.equal(row.summary_zh, "采购南京市水务局的水利信息化项目。");
  assert.equal(row.category, "smart-water");
  assert.equal(row.procurementFacts.buyer, "南京市水务局");
  assert.equal(row.procurementFacts.budget, "采购预算：200万元");
  assert.equal(row.procurementFacts.location, "项目实施地点：南京市");
  assert.equal(row.procurementFacts.deadline, "投标文件递交截止时间：2026年11月4日09:30");
  assert.equal(row.procurementFacts.method, "公开招标");
  assert.equal("body_text" in row, false);
  assert.equal("review_text" in row, false);
});
