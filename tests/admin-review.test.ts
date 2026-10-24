import "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { bulkMarkLowScoreIrrelevant, listArticleReviews, lowScoreIrrelevancePreview } from "@aihot/backend/admin/review";
import { getBusinessSelectionPolicy } from "@aihot/backend/admin/business-selection-policy";
import { businessProfile, listBusinessKeywordCandidates, saveBusinessMatchingFeedback } from "@aihot/backend/admin/business-matching";

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

test("the manual-review queue can filter independently by human label status", async () => {
  const marker = `人工标记筛选-${T}`;
  const create = async (suffix: string) => {
    const articleId = (await upsertMaterial({
      sourceId: SOURCE, url: `https://example.org/review-human-status-${suffix}-${T}`, title: `${marker} ${suffix}`,
      bodyText: "采购任务说明待人工确认。", bodyStatus: "ok", via: "fetch",
    } as never)).articleId;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
      VALUES (${articleId}, 1, 'model', 'unknown', false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "测试人工标记筛选" } })})`;
    return articleId;
  };
  const unmarkedId = await create("未标记");
  const markedId = await create("已标记");
  await sql`INSERT INTO business_matching_feedback (article_id, label, created_by)
    VALUES (${markedId}, 'relevant', 'admin-review-test')`;

  const unmarked = await listArticleReviews({ q: marker, filter: "unreviewed", days: 0, humanStatus: "unmarked" });
  assert.deepEqual(unmarked.rows.map((row) => row.article_id), [unmarkedId]);
  const marked = await listArticleReviews({ q: marker, filter: "unreviewed", days: 0, humanStatus: "marked" });
  assert.deepEqual(marked.rows.map((row) => row.article_id), [markedId]);
  const all = await listArticleReviews({ q: marker, filter: "unreviewed", days: 0, humanStatus: "all" });
  assert.equal(all.total, 2);
});

test("the default manual queue includes only UNKNOWN and PASS in the configured review band", async () => {
  const policy = await getBusinessSelectionPolicy();
  const create = async (name: string, score: number, selected: boolean) => {
    const articleId = (await upsertMaterial({
      sourceId: SOURCE, url: `https://example.org/review-band-${name}-${T}`, title: `${name} ${T}`,
      bodyText: "公告包含一项明确采购任务。", bodyStatus: "ok", via: "fetch",
    } as never)).articleId;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
      VALUES (${articleId}, 1, 'model', 'pass', ${score}, ${selected}, ${sql.json({
        businessScore: { total: score, dimensions: { taskFit: { score, reason: "测试" } } },
        selectionPolicy: { featuredThreshold: policy.featuredThreshold, reviewFloor: policy.reviewFloor },
      })})`;
    return articleId;
  };
  const lowId = await create("低于复核线", Math.max(0, policy.reviewFloor - 1), false);
  const reviewableId = await create("达到复核线", policy.reviewFloor, false);
  const selectedId = await create("已经精选", policy.featuredThreshold, true);
  const staleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-band-stale-${T}`, title: `旧规则下达门槛未精选 ${T}`,
    bodyText: "本次任务与企业能力直接匹配。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
    VALUES (${staleId}, 1, 'model', 'pass', ${policy.featuredThreshold + 3}, false, ${sql.json({
      deadlineStatus: "unknown",
      businessMatch: { label: "PASS", selectionPolicy: { featuredThreshold: policy.featuredThreshold } },
    })})`;

  const queue = await listArticleReviews({ q: T, filter: "unreviewed", days: 0 });
  const ids = new Set(queue.rows.map((row) => row.article_id));
  assert.equal(ids.has(lowId), false);
  assert.equal(ids.has(reviewableId), true);
  assert.equal(ids.has(selectedId), false);
  assert.equal(ids.has(staleId), false, "a PASS already above the stored featured threshold is not left in human review");
  const all = await listArticleReviews({ q: T, filter: "all", days: 0 });
  assert.equal(all.rows.find((row) => row.article_id === staleId)?.selected, true);
  const rejected = await listArticleReviews({ q: T, filter: "ai-rejected", days: 0 });
  assert.equal(rejected.rows.some((row) => row.article_id === staleId), false);
});

test("context-only terms do not appear as positive keyword hits", async () => {
  const articleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-context-${T}`, title: `公共资源交易中心采购公告 ${T}`,
    bodyText: "交易平台发布采购公告。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
    VALUES (${articleId}, 1, 'model', 'unknown', false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "仅能确认是交易公告" } })})`;

  const all = await listArticleReviews({ q: T, filter: "all", days: 0 });
  const row = all.rows.find((item) => item.article_id === articleId)!;
  assert.deepEqual(row.positiveHits, []);
  const keyword = await listArticleReviews({ q: T, filter: "keyword", days: 0 });
  assert.equal(keyword.rows.some((item) => item.article_id === articleId), false);
});

test("an exact collection hour scopes the review queue and reports that batch's counts", async () => {
  const articleId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-batch-${T}`, title: `采集批次复核 ${T}`,
    bodyText: "本轮采集的测试文章。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const daysAgo = 2 + Math.floor(Math.random() * 42);
  const wallClock = new Date(Date.now() - daysAgo * 86_400_000);
  wallClock.setUTCHours(8, 0, 0, 0);
  const slot = `${wallClock.toISOString().slice(0, 10)}T08`;
  const startedAt = new Date(wallClock.getTime() - 8 * 60 * 60_000);
  const finishedAt = new Date(startedAt.getTime() + 2 * 60_000);
  await sql`UPDATE articles SET discovered_at = ${new Date(startedAt.getTime() + 60_000)} WHERE id = ${articleId}`;
  await sql`INSERT INTO fetch_runs (source_id, started_at, finished_at, status, found_count, new_count)
    VALUES (${SOURCE}, ${startedAt}, ${finishedAt}, 'ok', 12, 1)`;

  const result = await listArticleReviews({ q: T, filter: "all", days: 1, runSlot: slot });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0]?.article_id, articleId);
  assert.equal(result.selectedCollectionBatch?.sourceCount, 1);
  assert.equal(result.selectedCollectionBatch?.foundCount, 12);
  assert.equal(result.selectedCollectionBatch?.newCount, 1);
});

test("the review queue collapses same-source duplicate listings with identical notice content", async () => {
  const title = `合肥交易中心重复公告 ${T}`;
  const bodyText = "档案管理咨询服务采购公告正文完全相同。";
  const firstId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://ggzy.hefei.gov.cn/jyxx/002001/002001001/20261019/notice.html?biaoduanguid=first`,
    identityKey: `test-duplicate-first-${T}`, title, bodyText, bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const secondId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://ggzy.hefei.gov.cn/jyxx/002001/002001001/20261019/notice.html?biaoduanguid=second`,
    identityKey: `test-duplicate-second-${T}`, title, bodyText, bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  assert.equal(secondId, firstId, "an exact duplicate is collapsed at ingestion to the canonical article");
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
    VALUES (${firstId}, 1, 'model', 'unknown', false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "test duplicate" } })}),
           (${secondId}, 1, 'model', 'unknown', false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "test duplicate" } })})`;

  const result = await listArticleReviews({ q: T, filter: "all", days: 0 });
  assert.equal(result.rows.some((row) => row.article_id === firstId), true);
  assert.equal(result.rows.filter((row) => row.article_id === firstId).length, 1);
});

test("the default manual queue omits unprocessed and BLOCK records", async () => {
  const noAnalysisId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-unprocessed-${T}`, title: `未分析记录 ${T}`,
    bodyText: "等待后台处理。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const blockId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-block-${T}`, title: `无关采购记录 ${T}`,
    bodyText: "采购食堂外包服务。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const awardId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-award-${T}`, title: `档案扫描项目中标结果公告 ${T}`,
    bodyText: "档案扫描服务中标结果。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const contractId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-contract-${T}`, title: `移动警务系统采购项目合同公示 ${T}`,
    bodyText: "合同公示。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  const typedAwardId = (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/review-award-type-${T}`, title: `交易公告标题 ${T}`,
    bodyText: "采购公告正文。", bodyStatus: "ok", via: "fetch",
  } as never)).articleId;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, selected, output)
    VALUES (${blockId}, 1, 'model', 'block', false, ${sql.json({ prefilter: { label: "BLOCK", reason: "采购内容与业务能力无关" } })})`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
    VALUES (${awardId}, 1, 'model', 'pass', 92, false, ${sql.json({ prefilter: { label: "PASS", reason: "测试历史评分" }, itemType: "award_result" })})`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
    VALUES (${contractId}, 1, 'model', 'unknown', 12, false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "标题识别为合同公示" } })})`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
    VALUES (${typedAwardId}, 1, 'model', 'unknown', 12, false, ${sql.json({ prefilter: { label: "UNKNOWN", reason: "测试公告类别兜底" }, itemType: "award_result" })})`;

  const result = await listArticleReviews({ q: T, filter: "unreviewed", days: 0 });
  assert.equal(result.rows.some((row) => row.article_id === noAnalysisId), false);
  assert.equal(result.rows.some((row) => row.article_id === blockId), false);
  assert.equal(result.rows.some((row) => row.article_id === contractId), false);
  assert.equal(result.rows.some((row) => row.article_id === typedAwardId), false);
  const unprocessed = await listArticleReviews({ q: T, filter: "unanalyzed", days: 0 });
  assert.equal(unprocessed.rows.some((row) => row.article_id === noAnalysisId), true);
  const all = await listArticleReviews({ q: T, filter: "all", days: 0 });
  assert.equal(all.rows.some((row) => row.article_id === awardId), false, "award-result notices stay out of the AI/manual review table");
  assert.equal(all.rows.some((row) => row.article_id === contractId), false, "contract notices stay out of the AI/manual review table");
  assert.equal(all.rows.some((row) => row.article_id === typedAwardId), false, "award item types stay out even when the title is generic");
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

test("review cohorts use business score and sample low-score no-keyword records once per day", async () => {
  const cohort = `review-cohort-${T}`;
  const rules = await listArticleReviews({ q: T, filter: "all", days: 0 });
  const positiveTerm = rules.rules.positive[0]?.term;
  assert.ok(positiveTerm, "test profile has a positive business term");
  const policy = await getBusinessSelectionPolicy();
  const create = async (name: string, score: number, title: string, relevance: "pass" | "block") => {
    const articleId = (await upsertMaterial({
      sourceId: SOURCE, url: `https://example.org/review-cohort-${name}-${T}`, title: `${title} ${name} ${cohort}`,
      bodyText: `公告正文：${title}`, bodyStatus: "ok", via: "fetch",
    } as never)).articleId;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
      VALUES (${articleId}, 1, 'model', ${relevance}, ${score}, false, ${sql.json({
        businessScore: { total: score, dimensions: { taskFit: { score, reason: "测试" } } },
        scoreBreakdown: { business: score, total: score },
      })})`;
    return articleId;
  };
  const highHit = await create("高分有词", policy.reviewHighFloor, `项目采购${positiveTerm}`, "block");
  const highNoHit = await create("高分无词", policy.reviewHighFloor, "外墙维修服务采购", "pass");
  const lowHit = await create("低分有词", Math.max(0, policy.reviewHighFloor - 1), `项目采购${positiveTerm}`, "block");
  const lowNoHit = await create("低分无词", Math.max(0, policy.reviewHighFloor - 1), "食堂餐饮外包服务", "block");

  const idsFor = async (filter: string) => new Set((await listArticleReviews({ q: cohort, filter, days: 0 })).rows.map((row) => row.article_id));
  assert.ok((await idsFor("high-keyword")).has(highHit));
  assert.ok((await idsFor("high-no-keyword")).has(highNoHit));
  assert.ok((await idsFor("low-keyword")).has(lowHit));
  const sample = await listArticleReviews({ q: cohort, filter: "low-no-keyword", days: 0 });
  const repeated = await listArticleReviews({ q: cohort, filter: "low-no-keyword", days: 0 });
  assert.equal(sample.sampleEligibleTotal, 1);
  assert.equal(sample.total, 1);
  assert.deepEqual(sample.rows.map((row) => row.article_id), repeated.rows.map((row) => row.article_id));
  const priority = await idsFor("priority");
  assert.ok(priority.has(highHit));
  assert.ok(priority.has(highNoHit));
  assert.ok(priority.has(lowHit));
  assert.equal(priority.has(lowNoHit), false);
});

test("human article labels create grounded keyword candidates with the negative score gate", async () => {
  const profile = await businessProfile();
  const capabilityId = profile.draftProfile!.profile.capabilities.find((item) => item.enabled)!.id;
  const makeArticle = async (name: string, phrase: string, score: number, aiMatched = true) => {
    const articleId = (await upsertMaterial({
      sourceId: SOURCE, url: `https://example.org/review-candidate-${name}-${T}`, title: `${phrase} ${name} ${T}`,
      bodyText: `采购任务为${phrase}，以原文作为候选词证据。`, bodyStatus: "ok", via: "fetch",
    } as never)).articleId;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
      VALUES (${articleId}, 1, 'model', 'pass', ${score}, false, ${sql.json({
        businessScore: { total: score },
        businessMatch: { projects: [{ tasks: [{ name: phrase, action: "采购", matches: aiMatched ? [{ capabilityId }] : [] }] }] },
      })})`;
    return articleId;
  };
  const relevantPhrase = `候选正向词-${T}`;
  const relevantId = await makeArticle("正向", relevantPhrase, 20, false);
  await saveBusinessMatchingFeedback({ articleId: relevantId, label: "relevant", capabilityIds: [capabilityId] }, "test:keyword-candidate");
  const [positive] = await sql<{ phrase: string; kind: string; evidence_source: string; evidence: string }[]>`
    SELECT phrase, kind, evidence_source, evidence FROM business_keyword_candidates WHERE article_id = ${relevantId}`;
  assert.deepEqual([positive?.phrase, positive?.kind, positive?.evidence_source], [relevantPhrase, "positive", "title"]);
  assert.ok(positive?.evidence.includes(relevantPhrase));
  const generic = await sql`SELECT id FROM business_keyword_candidates WHERE article_id = ${relevantId} AND phrase = '采购'`;
  assert.equal(generic.length, 0);

  const highFloor = (await getBusinessSelectionPolicy()).reviewHighFloor;
  const negativePhrase = `候选负向词-${T}`;
  const irrelevantHighId = await makeArticle("高分无关", negativePhrase, highFloor);
  await saveBusinessMatchingFeedback({ articleId: irrelevantHighId, label: "irrelevant", capabilityIds: [capabilityId] }, "test:keyword-candidate");
  const [negative] = await sql<{ phrase: string; kind: string }[]>`
    SELECT phrase, kind FROM business_keyword_candidates WHERE article_id = ${irrelevantHighId}`;
  assert.deepEqual([negative?.phrase, negative?.kind], [negativePhrase, "negative"]);

  const lowPhrase = `低分不建负向-${T}`;
  const irrelevantLowId = await makeArticle("低分无关", lowPhrase, Math.max(0, highFloor - 1));
  await saveBusinessMatchingFeedback({ articleId: irrelevantLowId, label: "irrelevant", capabilityIds: [capabilityId] }, "test:keyword-candidate");
  const [lowCandidate] = await sql<{ id: number }[]>`SELECT id FROM business_keyword_candidates WHERE article_id = ${irrelevantLowId}`;
  assert.equal(lowCandidate, undefined);
  const pending = await listBusinessKeywordCandidates();
  assert.ok(pending.rows.some((candidate: any) => candidate.articleId === relevantId));
});

test("low-score bulk review marks only unlabelled zero-business-score articles without keyword hits", async () => {
  const before = await lowScoreIrrelevancePreview(1);
  const create = async (name: string, input: { score: number; business: number; label?: string; relevance?: string; keyword?: boolean; marked?: boolean }) => {
    const title = `${input.keyword ? "测绘" : "低分批量"} ${name} ${T}`;
    const articleId = (await upsertMaterial({
      sourceId: SOURCE, url: `https://example.org/review-low-bulk-${name}-${T}`, title,
      bodyText: "本项目的正文材料用于验证低分批量人工判读。", bodyStatus: "ok", via: "fetch",
    } as never)).articleId;
    const label = input.label ?? "UNKNOWN";
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, score, selected, output)
      VALUES (${articleId}, 1, 'model', ${input.relevance ?? "unknown"}, ${input.score}, false, ${sql.json({
        prefilter: { label }, businessMatch: { label }, businessScore: { total: input.business },
        scoreBreakdown: { total: input.score, business: input.business },
      })})`;
    if (input.marked) await sql`INSERT INTO business_matching_feedback (article_id, label, created_by) VALUES (${articleId}, 'relevant', 'test:low-score-bulk')`;
    return articleId;
  };
  const eligibleId = await create("符合", { score: 15, business: 0 });
  const keywordId = await create("命中词", { score: 15, business: 0, keyword: true });
  const thresholdId = await create("边界二十分", { score: 20, business: 0 });
  const businessScoreId = await create("业务分非零", { score: 15, business: 1 });
  const aiRelevantId = await create("AI判相关", { score: 15, business: 0, label: "PASS", relevance: "pass" });
  const alreadyMarkedId = await create("已标注", { score: 15, business: 0, marked: true });

  const preview = await lowScoreIrrelevancePreview(1);
  assert.equal(preview.total, before.total + 1);
  const result = await bulkMarkLowScoreIrrelevant({ days: 1, expectedCount: preview.total }, "test:low-score-bulk");
  assert.equal(result.markedCount, preview.total);
  const [feedback] = await sql<{ label: string; note: string; keyword_extracted_at: Date | null }[]>`
    SELECT label, note, keyword_extracted_at FROM business_matching_feedback WHERE article_id = ${eligibleId} ORDER BY id DESC LIMIT 1`;
  assert.equal(feedback?.label, "irrelevant");
  assert.match(feedback?.note ?? "", /总分低于 20/);
  assert.ok(feedback?.keyword_extracted_at, "bulk labels should not create keyword candidates later");
  const [analysis] = await sql<{ relevance: string }[]>`SELECT relevance FROM analyses WHERE article_id = ${eligibleId} ORDER BY id DESC LIMIT 1`;
  assert.equal(analysis?.relevance, "unknown", "bulk human labels keep the original AI result");
  const candidates = await sql`SELECT id FROM business_keyword_candidates WHERE article_id = ${eligibleId}`;
  assert.equal(candidates.length, 0);

  const after = await lowScoreIrrelevancePreview(1);
  assert.equal(after.total, 0);
  for (const id of [keywordId, thresholdId, businessScoreId, aiRelevantId, alreadyMarkedId]) {
    const count = await sql`SELECT id FROM business_matching_feedback WHERE article_id = ${id} AND label = 'irrelevant'`;
    assert.equal(count.length, 0);
  }
});
