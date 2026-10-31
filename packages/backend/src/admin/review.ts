import { SELECTION } from "@aihot/industry/selection";
import { AWARD_RESULT_TITLE_PATTERN } from "@aihot/industry/taxonomy";
import { loadBusinessProfile, type BusinessProfile } from "../editorial/business.ts";
import { loadBusinessSelectionPolicy } from "../editorial/business-selection-policy.ts";
import { sql, type Db } from "../db.ts";
import { keywordGovernanceBatchOutcomes } from "./keyword-governance-flow.ts";
import { recordCollectionBatchFeedback } from "../content/collection-batch.ts";
import { audit } from "./auth.ts";
import { assessQualificationRequirements, listBusinessQualifications } from "./qualifications.ts";

type ReviewFilter = "calibration-all" | "priority" | "high-keyword" | "high-no-keyword" | "low-keyword" | "low-no-keyword" | "article" | "all" | "keyword" | "keyword-and-negative" | "ai-rejected" | "prefilter-402" | "prefilter-402-keyword" | "unreviewed" | "unknown" | "unanalyzed";
type KeywordRule = { term: string; capabilityId: string; capabilityName: string; role: string };
type CollectionBatch = { slot: string; sourceCount: number; foundCount: number; newCount: number; failedCount: number; runningCount: number };
type CollectionBatchReviewStats = { retainedCount: number; passCount: number; unknownCount: number; unanalyzedCount: number };
type ReviewDbRow = {
  article_id: string; title: string; url: string; source_name: string; source_tier: string; discovered_at: Date; published_at: Date | null;
  body_status: string; excerpt: string | null; body_preview: string; review_text: string; title_zh: string | null; summary_zh: string | null; category: string | null;
  positive_hits: string[]; negative_hits: string[]; prefilter_402_failed: boolean;
  relevance: string | null; score: number | null; selected: boolean | null; model: string | null; prompt_version: string | null;
  published_selected: boolean; manual_selected: boolean; override_version: number; publication_visibility: string | null;
  reason_zh: string | null; analysis_output: Record<string, any> | null;
  human_label: string | null; human_capability_ids: string[] | null; human_evidence_quality: string | null; human_note: string | null; human_reviewed_at: Date | null;
  human_history: Array<{ label: string; capabilityIds: string[]; evidenceQuality: string | null; note: string | null; createdAt: Date }>;
  business_score?: number;
  total?: number;
};

type LowScoreCandidate = { article_id: string; title: string; score: number; relevance: string; output: Record<string, any> | null; total: number };
const LOW_SCORE_IRRELEVANCE_THRESHOLD = 25;
const LOW_NO_KEYWORD_DAILY_SAMPLE_LIMIT = 5;

async function lowScoreCandidates(db: Db, days: number, positiveTerms: string[], negativeTerms: string[], limit: number, batchSlot?: string) {
  const batchClause = batchSlot
    ? sql`AND EXISTS (SELECT 1 FROM collection_batch_articles cba WHERE cba.batch_slot = ${batchSlot} AND cba.article_id = a.id)`
    : sql``;
  return db<LowScoreCandidate[]>`
    WITH base AS (
      SELECT a.id AS article_id, a.title, lower(concat_ws(' ', a.title, a.excerpt, a.body_text)) AS searchable,
             an.relevance, an.output,
             coalesce(an.score, nullif(an.output->'scoreBreakdown'->>'total', '')::numeric,
                      nullif(an.output->>'score', '')::numeric, -1) AS score,
             coalesce(nullif(an.output->'businessScore'->>'total', '')::numeric,
                      nullif(an.output->'businessMatch'->'businessScore'->>'total', '')::numeric,
                      nullif(an.output->'scoreBreakdown'->>'business', '')::numeric, -1) AS business_score,
             upper(coalesce(an.output->'businessMatch'->>'label', an.output->'prefilter'->>'label', '')) AS ai_label
      FROM articles a
      JOIN LATERAL (SELECT origin, relevance, score, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
      WHERE a.discovered_at >= now() - (${days} * interval '1 day')
        AND an.origin = 'model'
        AND an.relevance IN ('block', 'unknown')
        AND coalesce(an.output->'businessMatch'->>'label', an.output->'prefilter'->>'label', '') <> 'PASS'
        AND coalesce(an.score, nullif(an.output->'scoreBreakdown'->>'total', '')::numeric,
                     nullif(an.output->>'score', '')::numeric, -1) >= 0
        AND coalesce(an.score, nullif(an.output->'scoreBreakdown'->>'total', '')::numeric,
                     nullif(an.output->>'score', '')::numeric, -1) < ${LOW_SCORE_IRRELEVANCE_THRESHOLD}
        AND coalesce(nullif(an.output->'businessScore'->>'total', '')::numeric,
                     nullif(an.output->'businessMatch'->'businessScore'->>'total', '')::numeric,
                     nullif(an.output->'scoreBreakdown'->>'business', '')::numeric, -1) = 0
        AND NOT EXISTS (SELECT 1 FROM business_matching_feedback fb WHERE fb.article_id = a.id)
        AND a.title !~ ${AWARD_RESULT_TITLE_PATTERN.source}
        AND coalesce(an.output->>'itemType', '') <> 'award_result'
        ${batchClause}
    ), matched AS (
      SELECT base.*,
        coalesce((SELECT count(*) FROM unnest(${positiveTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), 0) AS positive_hits,
        coalesce((SELECT count(*) FROM unnest(${negativeTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), 0) AS negative_hits
      FROM base
    )
    SELECT article_id, title, score, relevance, output, count(*) OVER()::int AS total
    FROM matched
    WHERE positive_hits = 0 AND negative_hits = 0
    ORDER BY score DESC, article_id DESC
    LIMIT ${limit}`;
}

function lowScoreWindow(days: number) {
  const value = Number(days);
  if (!Number.isInteger(value) || value < 1 || value > 30) throw Object.assign(new Error("批量范围须为近 1–30 天"), { statusCode: 400 });
  return value;
}

async function lowScoreTerms() {
  const profile = await loadBusinessProfile();
  const terms = keywordRules(profile);
  return {
    positive: [...new Set(terms.positive.map((rule) => rule.term.toLocaleLowerCase()))],
    negative: [...new Set(terms.negative.map((rule) => rule.term.toLocaleLowerCase()))],
  };
}

export async function lowScoreIrrelevancePreview(daysInput = 1, batchSlot?: string) {
  const days = lowScoreWindow(daysInput);
  const terms = await lowScoreTerms();
  const [rows, batchRows] = await Promise.all([
    lowScoreCandidates(sql, days, terms.positive, terms.negative, 8),
    batchSlot ? lowScoreCandidates(sql, days, terms.positive, terms.negative, 1, batchSlot) : Promise.resolve([]),
  ]);
  return {
    days,
    threshold: LOW_SCORE_IRRELEVANCE_THRESHOLD,
    total: Number(rows[0]?.total ?? 0),
    selectedBatchSlot: batchSlot ?? null,
    selectedBatchTotal: batchSlot ? Number(batchRows[0]?.total ?? 0) : null,
    rows: rows.map(({ total: _total, ...row }) => row),
  };
}

export async function bulkMarkLowScoreIrrelevant(input: { days?: number; expectedCount?: number }, actor: string) {
  const days = lowScoreWindow(input.days ?? 1);
  const expectedCount = Number(input.expectedCount);
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) throw Object.assign(new Error("请先预览符合条件的文章"), { statusCode: 400 });
  const terms = await lowScoreTerms();
  const inserted = await sql.begin(async (tx) => {
    const candidates = await lowScoreCandidates(tx, days, terms.positive, terms.negative, Number.MAX_SAFE_INTEGER);
    if (candidates.length !== expectedCount) throw Object.assign(new Error("符合条件的文章数量已变化，请刷新预览后重试"), { statusCode: 409 });
    const marked: string[] = [];
    for (const row of candidates) {
      const [saved] = await tx<{ article_id: string; id: number }[]>`
        INSERT INTO business_matching_feedback
          (article_id, label, capability_ids, participation, evidence_quality, note, original_result, created_by, keyword_extracted_at)
        SELECT ${row.article_id}, 'irrelevant', ARRAY[]::text[], 'unknown', 'limited',
               ${`低分批量判读：总分低于 ${LOW_SCORE_IRRELEVANCE_THRESHOLD}、业务分为 0、无正负关键词命中、AI 未判相关。`},
               ${tx.json({ title: row.title, relevance: row.relevance, score: row.score, output: row.output } as never)}, ${actor}, now()
        WHERE NOT EXISTS (SELECT 1 FROM business_matching_feedback WHERE article_id = ${row.article_id})
        RETURNING article_id, id`;
      if (saved) {
        marked.push(saved.article_id);
        await recordCollectionBatchFeedback({ articleId: saved.article_id, feedbackId: saved.id, label: "irrelevant", actor }, tx);
      }
    }
    return marked;
  });
  await audit(actor, "business.matching.feedback.bulk", "low-score-review", "批量标记低分且无业务词命中的 AI 非相关文章", null, {
    days, threshold: LOW_SCORE_IRRELEVANCE_THRESHOLD, markedCount: inserted.length, articleIds: inserted.slice(0, 200), articleIdsTruncated: inserted.length > 200,
  });
  return { markedCount: inserted.length, days, threshold: LOW_SCORE_IRRELEVANCE_THRESHOLD };
}

function procurementFacts(text: string, analysisOutput: Record<string, any> | null) {
  const labeledFact = (labels: string[], valuePattern: RegExp) => {
    const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`(${escaped})\\s*[：:]?`, "gu");
    for (const match of text.matchAll(pattern)) {
      const value = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 180).split(/[。；;\n]/u, 1)[0]?.match(valuePattern)?.[0];
      if (value) return `${match[1]}：${value.replace(/\s+/g, " ").replace(/\.\s+(?=\d)/g, ".").trim()}`;
    }
    return null;
  };
  const budget = labeledFact(
    ["采购预算", "项目预算金额", "预算金额", "项目预算", "最高投标限价", "最高限价"],
    /(?:(?:人民币|RMB|¥|￥)\s*)?\d[\d,]*(?:\.\s*\d+)?\s*(?:亿元|万元|元|%|％)|百分之\s*\d+(?:\.\s*\d+)?/iu,
  );
  const deadline = labeledFact(
    ["投标文件递交截止时间", "递交投标文件截止时间", "响应文件提交截止时间", "响应文件递交截止时间", "提交响应文件截止时间", "投标截止时间", "开标时间", "报名截止时间"],
    /20\d{2}\s*(?:年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*(?:日|号)?)?|[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{1,2})?)(?:\s*(?:上午|下午)?\s*(?:\d{1,2}\s*(?:时|点)(?:\s*\d{1,2}\s*分)?|\d{1,2}:\d{2}))?/u,
  );
  const buyerFromText = labeledFact(["采购人名称", "采购人", "采购单位", "招标人"], /[^。；;，,\n]{2,70}/u);
  const organizations = analysisOutput?.businessMatch?.organizations;
  const buyer = Array.isArray(organizations)
    ? organizations.find((item) => item?.role === "purchaser" && typeof item.name === "string")?.name ?? null
    : null;
  return {
    buyer: buyer ?? buyerFromText?.replace(/\s+/g, " ").trim() ?? null,
    budget,
    location: labeledFact(["项目实施地点", "项目所在地", "建设地点", "项目地点", "服务地点", "交付地点", "实施地点"], /[^。；;\n]{2,70}/u),
    deadline,
    method: text.match(/公开招标|邀请招标|竞争性磋商|竞争性谈判|询价采购|单一来源采购|框架协议采购/u)?.[0] ?? null,
  };
}

function keywordRules(profile: BusinessProfile) {
  const positive: KeywordRule[] = [];
  const negative: KeywordRule[] = [];
  for (const capability of profile.capabilities.filter((item) => item.enabled)) {
    const roles = [
      ["serviceAction", capability.semanticRoles.serviceActions],
      ["method", capability.semanticRoles.methods],
      ["deliverable", capability.semanticRoles.deliverables],
    ] as const;
    for (const [role, terms] of roles) for (const term of terms) if (term.trim()) positive.push({ term, capabilityId: capability.id, capabilityName: capability.name, role });
    const negativeTerms = capability.reviewNegativeTerms.length ? capability.reviewNegativeTerms : capability.negativeExamples;
    for (const term of negativeTerms) if (term.trim()) negative.push({ term, capabilityId: capability.id, capabilityName: capability.name, role: "negative" });
  }
  const dedupe = (rules: KeywordRule[]) => rules.filter((rule, index) => rules.findIndex((other) => other.capabilityId === rule.capabilityId && other.role === rule.role && other.term.toLocaleLowerCase() === rule.term.toLocaleLowerCase()) === index);
  return { positive: dedupe(positive), negative: dedupe(negative) };
}

function collectionBatchWindow(slot: string | undefined) {
  if (!slot || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/.test(slot)) return null;
  const start = new Date(`${slot}:00:00+08:00`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start.getTime() + 60 * 60_000);
  return { start, end };
}

async function listCollectionBatches(): Promise<CollectionBatch[]> {
  const rows = await sql<Array<{ local_slot: string; source_count: number; found_count: number; new_count: number; failed_count: number; running_count: number }>>`
    SELECT to_char(date_trunc('hour', fr.started_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"HH24') AS local_slot,
           count(DISTINCT fr.source_id)::int AS source_count,
           coalesce(sum(fr.found_count), 0)::int AS found_count,
           coalesce(sum(fr.new_count), 0)::int AS new_count,
           count(*) FILTER (WHERE fr.status = 'failed')::int AS failed_count,
           count(*) FILTER (WHERE fr.status = 'running')::int AS running_count
    FROM fetch_runs fr JOIN sources s ON s.id = fr.source_id
    WHERE fr.started_at >= now() - interval '45 days' AND s.kind IN ('rss', 'web_list', 'json_list', 'x_search')
    GROUP BY 1 ORDER BY 1 DESC LIMIT 90`;
  return rows.map((row) => ({
    slot: row.local_slot,
    sourceCount: row.source_count,
    foundCount: row.found_count,
    newCount: row.new_count,
    failedCount: row.failed_count,
    runningCount: row.running_count,
  }));
}

export async function listArticleReviews(input: { q?: string; filter?: string; humanStatus?: string; days?: number; page?: number; runSlot?: string; articleId?: string }) {
  const [profile, selectionPolicy, collectionBatches, qualificationList] = await Promise.all([loadBusinessProfile(), loadBusinessSelectionPolicy(), listCollectionBatches(), listBusinessQualifications()]);
  const rules = keywordRules(profile);
  const positiveTerms = [...new Set(rules.positive.map((rule) => rule.term.toLocaleLowerCase()))];
  const negativeTerms = [...new Set(rules.negative.map((rule) => rule.term.toLocaleLowerCase()))];
  const articleId = (input.articleId ?? "").trim().slice(0, 100);
  const requestedFilter = input.filter ?? "";
  const legacyFilters = ["all", "keyword", "keyword-and-negative", "ai-rejected", "prefilter-402", "prefilter-402-keyword", "unreviewed", "unknown", "unanalyzed"];
  const filter: ReviewFilter = articleId ? "article" : legacyFilters.includes(requestedFilter)
    ? "calibration-all"
    : ["calibration-all", "priority", "high-keyword", "high-no-keyword", "low-keyword", "low-no-keyword"].includes(requestedFilter)
      ? requestedFilter as ReviewFilter
      : "priority";
  const humanStatus = (articleId ? "all" : ["all", "marked", "unmarked"].includes(input.humanStatus ?? "") ? input.humanStatus : "unmarked") as "all" | "marked" | "unmarked";
  const requestedDays = Number(input.days ?? 30);
  const days = Number.isFinite(requestedDays) ? Math.max(0, Math.min(365, Math.floor(requestedDays))) : 30;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = 1;
  const term = (input.q ?? "").trim().slice(0, 200);
  const runSlot = input.runSlot && collectionBatches.some((batch) => batch.slot === input.runSlot) ? input.runSlot : "";
  const runWindow = collectionBatchWindow(runSlot);
  const awardTitlePattern = AWARD_RESULT_TITLE_PATTERN.source;
  const awardResultClause = articleId ? sql`` : sql`AND a.title !~ ${awardTitlePattern}
    AND coalesce((SELECT output->>'itemType' FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1), '') <> 'award_result'`;
  const effectiveAiSelection = sql`coalesce((SELECT CASE
      WHEN output->>'deadlineStatus' = 'passed' THEN false
      WHEN selected IS TRUE THEN true
      ELSE relevance = 'pass' AND score IS NOT NULL
        AND score >= NULLIF(output->'businessMatch'->'selectionPolicy'->>'featuredThreshold', '')::numeric
    END FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1), false)`;
  const duplicateContentClause = sql`AND (
    coalesce(a.body_text, '') = '' OR a.content_hash IS NULL OR NOT EXISTS (
      SELECT 1 FROM articles earlier
      WHERE earlier.source_id = a.source_id AND earlier.title = a.title
        AND earlier.content_hash = a.content_hash AND earlier.body_text = a.body_text
        AND earlier.body_text IS NOT NULL AND earlier.body_text <> ''
        AND earlier.title !~ ${awardTitlePattern}
        AND coalesce((SELECT output->>'itemType' FROM analyses WHERE article_id = earlier.id ORDER BY id DESC LIMIT 1), '') <> 'award_result'
        AND coalesce((SELECT relevance FROM analyses WHERE article_id = earlier.id ORDER BY id DESC LIMIT 1), '')
          = coalesce((SELECT relevance FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1), '')
        AND coalesce((SELECT score FROM analyses WHERE article_id = earlier.id ORDER BY id DESC LIMIT 1), -1)
          = coalesce((SELECT score FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1), -1)
        AND (EXISTS (SELECT 1 FROM business_matching_feedback WHERE article_id = earlier.id)
          = EXISTS (SELECT 1 FROM business_matching_feedback WHERE article_id = a.id))
        AND earlier.discovered_at >= a.discovered_at - interval '24 hours'
        AND (earlier.discovered_at < a.discovered_at OR (earlier.discovered_at = a.discovered_at AND earlier.id < a.id))
    )
  )`;
  const queryDays = articleId || runWindow ? 0 : days;
  const dateClause = queryDays === 0 ? sql`` : sql`AND a.discovered_at >= now() - (${queryDays} * interval '1 day')`;
  const selectedBatch = collectionBatches.find((batch) => batch.slot === runSlot) ?? null;
  const selectedBatchSummary = runWindow ? await keywordGovernanceBatchOutcomes(runSlot, selectedBatch?.newCount ?? 0) : null;
  const selectedBatchOutcomes = selectedBatchSummary?.outcomes ?? null;
  const hasTrackedBatch = !selectedBatchOutcomes?.legacy && Number(selectedBatchOutcomes?.insertedCount ?? 0) > 0;
  const batchClause = articleId ? sql`` : runWindow ? hasTrackedBatch
    ? sql`AND EXISTS (SELECT 1 FROM collection_batch_articles cba WHERE cba.batch_slot = ${runSlot} AND cba.article_id = a.id)`
    : sql`AND EXISTS (
      SELECT 1 FROM fetch_runs fr WHERE fr.source_id = a.source_id
        AND fr.started_at >= ${runWindow.start} AND fr.started_at < ${runWindow.end}
        AND a.discovered_at >= fr.started_at AND a.discovered_at <= coalesce(fr.finished_at, now())
    )` : sql``;
  const duplicateScopeClause = articleId || hasTrackedBatch ? sql`` : duplicateContentClause;
  const latestHumanLabel = sql`(SELECT fb.label FROM business_matching_feedback fb WHERE fb.article_id = a.id ORDER BY fb.created_at DESC, fb.id DESC LIMIT 1)`;
  const humanStatusClause = articleId ? sql`` : humanStatus === "marked"
    ? sql`AND ${latestHumanLabel} IN ('relevant', 'irrelevant')`
    : humanStatus === "unmarked"
      ? sql`AND coalesce(${latestHumanLabel}, '') NOT IN ('relevant', 'irrelevant')`
      : sql``;
  const selectedBatchReviewStats = Number(selectedBatchOutcomes?.insertedCount ?? 0) > 0 ? {
    retainedCount: Number(selectedBatchOutcomes?.retained ?? 0),
    passCount: Number(selectedBatchOutcomes?.pass ?? 0),
    unknownCount: Number(selectedBatchOutcomes?.unknown ?? 0),
    unanalyzedCount: Number(selectedBatchOutcomes?.unanalyzedCount ?? selectedBatchOutcomes?.queued ?? 0),
    manualReviewRequired: Number(selectedBatchOutcomes?.manualReviewRequired ?? 0),
    manualMarked: Number(selectedBatchOutcomes?.manualMarked ?? 0),
    manualPending: Number(selectedBatchOutcomes?.manualPending ?? 0),
  } : runWindow ? (await sql<CollectionBatchReviewStats[]>`
    SELECT count(*)::int AS "retainedCount",
           count(*) FILTER (WHERE an.relevance = 'pass')::int AS "passCount",
           count(*) FILTER (WHERE an.relevance = 'unknown')::int AS "unknownCount",
           count(*) FILTER (WHERE an.relevance IS NULL)::int AS "unanalyzedCount"
    FROM articles a
    LEFT JOIN LATERAL (SELECT relevance FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
    WHERE true ${batchClause} ${awardResultClause} ${duplicateScopeClause}`)[0] ?? { retainedCount: 0, passCount: 0, unknownCount: 0, unanalyzedCount: 0 } : null;
  let rows: ReviewDbRow[];
  let total: number;
  let humanLabelCounts = { relevant: 0, irrelevant: 0 };
  let sampleEligibleTotal: number | null = null;
  if (filter === "unreviewed" || filter === "all" || filter === "unanalyzed") {
    const searchClause = term ? sql`AND (a.title ILIKE ${`%${term}%`} OR coalesce(a.excerpt, '') ILIKE ${`%${term}%`} OR coalesce(a.body_text, '') ILIKE ${`%${term}%`})` : sql``;
    const reviewClause = filter === "unreviewed"
      ? sql`AND ((SELECT relevance FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) = 'unknown'
              OR ((SELECT relevance FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) = 'pass'
                AND ${effectiveAiSelection} IS NOT TRUE
                AND ((SELECT output->>'deadlineStatus' FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) IN ('due_soon', 'unknown')
                  OR coalesce(
                    (SELECT nullif(output->>'score', '')::int FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1),
                    (SELECT coalesce(output->'businessScore'->>'total', output->'businessMatch'->'businessScore'->>'total')::int
                     FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1), -1
                  ) >= ${selectionPolicy.reviewFloor})))`
      : filter === "unanalyzed"
        ? sql`AND NOT EXISTS (SELECT 1 FROM analyses WHERE article_id = a.id)`
        : sql``;
    const [count] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM articles a WHERE true ${dateClause} ${searchClause} ${reviewClause} ${humanStatusClause} ${batchClause}
        ${awardResultClause} ${duplicateScopeClause}`;
    total = Number(count?.total ?? 0);
    const ids = await sql<{ article_id: string }[]>`
      SELECT a.id AS article_id FROM articles a WHERE true ${dateClause} ${searchClause} ${reviewClause} ${humanStatusClause}
        ${batchClause} ${awardResultClause} ${duplicateScopeClause}
      ORDER BY a.discovered_at DESC, a.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    rows = ids.length ? await sql<ReviewDbRow[]>`
      WITH page_ids AS (
        SELECT article_id, ordinality FROM unnest(${ids.map((row) => row.article_id)}::text[]) WITH ORDINALITY AS p(article_id, ordinality)
      ), failed_402 AS (
        SELECT DISTINCT p.article_id
        FROM page_ids p
        JOIN receipts r ON r.subject = ('article:' || p.article_id) OR r.subject LIKE ('article:' || p.article_id || '@%')
        JOIN receipt_attempts attempt ON attempt.receipt_id = r.id
        WHERE r.purpose = 'prefilter_article' AND attempt.status = 'failed' AND attempt.error ILIKE '%402%'
      ), base AS (
        SELECT a.id AS article_id, a.title, a.url, s.name AS source_name, s.tier AS source_tier, a.discovered_at, a.published_at,
               a.body_status, a.excerpt, a.body_text, left(coalesce(a.body_text, ''), 900) AS body_preview,
               left(concat_ws(E'\\n', a.excerpt, a.body_text), 20000) AS review_text,
               (failed.article_id IS NOT NULL) AS prefilter_402_failed,
               an.relevance, an.score, an.selected, an.model, an.prompt_version, an.reason_zh, an.title_zh, an.summary_zh, an.category, an.output AS analysis_output,
               fb.label AS human_label, fb.capability_ids AS human_capability_ids, fb.evidence_quality AS human_evidence_quality,
               fb.note AS human_note, fb.created_at AS human_reviewed_at,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('label', history.label, 'capabilityIds', history.capability_ids,
                       'evidenceQuality', history.evidence_quality, 'note', history.note, 'createdAt', history.created_at) ORDER BY history.created_at DESC), '[]'::jsonb)
                  FROM (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 5) history) AS human_history,
               coalesce(pub.selected, false) AS published_selected, coalesce((ov.fields->>'manualSelected')::boolean, false) AS manual_selected,
               coalesce(ov.version, 0) AS override_version, pub.visibility AS publication_visibility,
               lower(concat_ws(' ', a.title, a.excerpt, a.body_text)) AS searchable, p.ordinality
        FROM page_ids p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = a.source_id
        LEFT JOIN failed_402 failed ON failed.article_id = a.id
        LEFT JOIN publications pub ON pub.article_id = a.id
        LEFT JOIN editorial_overrides ov ON ov.article_id = a.id
        LEFT JOIN LATERAL (SELECT relevance, score,
            CASE WHEN output->>'deadlineStatus' = 'passed' THEN false
                 WHEN selected IS TRUE THEN true
                 ELSE relevance = 'pass' AND score IS NOT NULL
                   AND score >= NULLIF(output->'businessMatch'->'selectionPolicy'->>'featuredThreshold', '')::numeric
            END AS selected,
            model, prompt_version, reason_zh, title_zh, summary_zh, category, output
          FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
        LEFT JOIN LATERAL (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) fb ON true
      )
      SELECT base.article_id, base.title, base.url, base.source_name, base.source_tier, base.discovered_at, base.published_at,
        base.body_status, base.excerpt, base.body_preview, base.review_text, base.title_zh, base.summary_zh, base.category, base.prefilter_402_failed,
        base.relevance, base.score, base.selected, base.model, base.prompt_version, base.reason_zh, base.analysis_output,
        base.published_selected, base.manual_selected, base.override_version, base.publication_visibility,
        base.human_label, base.human_capability_ids, base.human_evidence_quality, base.human_note, base.human_reviewed_at, base.human_history,
        coalesce((SELECT array_agg(t) FROM unnest(${positiveTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS positive_hits,
        coalesce((SELECT array_agg(t) FROM unnest(${negativeTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS negative_hits
      FROM base ORDER BY base.ordinality` : [];
  } else {
    const matched = await sql<(ReviewDbRow & { total: number; humanRelevantCount: number; humanIrrelevantCount: number })[]>`
    WITH prefilter_402 AS (
      SELECT DISTINCT split_part(replace(r.subject, 'article:', ''), '@', 1) AS article_id
      FROM receipts r JOIN receipt_attempts attempt ON attempt.receipt_id = r.id
      WHERE r.purpose = 'prefilter_article' AND attempt.status = 'failed' AND attempt.error ILIKE '%402%'
    ), base AS (
      SELECT a.id AS article_id, a.title, a.url, s.name AS source_name, s.tier AS source_tier, a.discovered_at, a.published_at,
             a.body_status, a.excerpt, left(coalesce(a.body_text, ''), 900) AS body_preview,
             left(concat_ws(E'\\n', a.excerpt, a.body_text), 20000) AS review_text,
             (failed.article_id IS NOT NULL) AS prefilter_402_failed,
             an.relevance, an.score, an.selected, an.model, an.prompt_version, an.reason_zh, an.title_zh, an.summary_zh, an.category, an.output AS analysis_output,
             coalesce(nullif(an.output->'businessScore'->>'total', '')::numeric,
                      nullif(an.output->'businessMatch'->'businessScore'->>'total', '')::numeric,
                      nullif(an.output->'scoreBreakdown'->>'business', '')::numeric, -1) AS business_score,
             fb.label AS human_label, fb.capability_ids AS human_capability_ids, fb.evidence_quality AS human_evidence_quality,
             fb.note AS human_note, fb.created_at AS human_reviewed_at,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('label', history.label, 'capabilityIds', history.capability_ids,
                     'evidenceQuality', history.evidence_quality, 'note', history.note, 'createdAt', history.created_at) ORDER BY history.created_at DESC), '[]'::jsonb)
                FROM (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 5) history) AS human_history,
             coalesce(pub.selected, false) AS published_selected, coalesce((ov.fields->>'manualSelected')::boolean, false) AS manual_selected,
             coalesce(ov.version, 0) AS override_version, pub.visibility AS publication_visibility,
             lower(concat_ws(' ', a.title, a.excerpt, a.body_text)) AS searchable
      FROM articles a JOIN sources s ON s.id = a.source_id
      LEFT JOIN prefilter_402 failed ON failed.article_id = a.id
      LEFT JOIN publications pub ON pub.article_id = a.id
      LEFT JOIN editorial_overrides ov ON ov.article_id = a.id
      LEFT JOIN LATERAL (SELECT relevance, score,
          CASE WHEN output->>'deadlineStatus' = 'passed' THEN false
               WHEN selected IS TRUE THEN true
               ELSE relevance = 'pass' AND score IS NOT NULL
                 AND score >= NULLIF(output->'businessMatch'->'selectionPolicy'->>'featuredThreshold', '')::numeric
          END AS selected,
          model, prompt_version, reason_zh, title_zh, summary_zh, category, output
        FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
      LEFT JOIN LATERAL (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) fb ON true
      WHERE (${queryDays} = 0 OR a.discovered_at >= now() - (${queryDays} * interval '1 day'))
        AND (${articleId} = '' OR a.id = ${articleId})
        ${humanStatusClause}
        ${batchClause}
        ${awardResultClause}
        ${duplicateScopeClause}
        AND (${filter} NOT IN ('prefilter-402', 'prefilter-402-keyword') OR failed.article_id IS NOT NULL)
        AND (${term} = '' OR a.title ILIKE ${`%${term}%`} OR coalesce(a.excerpt, '') ILIKE ${`%${term}%`} OR coalesce(a.body_text, '') ILIKE ${`%${term}%`})
    ), matched AS (
      SELECT base.*,
        coalesce((SELECT array_agg(t) FROM unnest(${positiveTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS positive_hits,
        coalesce((SELECT array_agg(t) FROM unnest(${negativeTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS negative_hits
      FROM base
    ), filtered AS (
      SELECT * FROM matched WHERE
        (${filter} = 'article' AND ${articleId} <> '')
        OR
        (${filter} = 'calibration-all' AND (relevance = 'unknown' OR business_score >= 0))
        OR
        ${filter} = 'all'
        OR (${filter} = 'keyword' AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'keyword-and-negative' AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) > 0)
        OR (${filter} = 'high-keyword' AND business_score >= ${selectionPolicy.reviewHighFloor} AND (cardinality(positive_hits) > 0 OR cardinality(negative_hits) > 0))
        OR (${filter} = 'high-no-keyword' AND business_score >= ${selectionPolicy.reviewHighFloor} AND cardinality(positive_hits) = 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'low-keyword' AND business_score >= 0 AND business_score < ${selectionPolicy.reviewHighFloor} AND (cardinality(positive_hits) > 0 OR cardinality(negative_hits) > 0))
        OR (${filter} = 'low-no-keyword' AND relevance <> 'unknown' AND business_score >= 0 AND business_score < ${selectionPolicy.reviewHighFloor} AND cardinality(positive_hits) = 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'priority' AND (relevance = 'unknown'
          OR business_score >= ${selectionPolicy.reviewHighFloor}
          OR (business_score >= 0 AND business_score < ${selectionPolicy.reviewHighFloor} AND (cardinality(positive_hits) > 0 OR cardinality(negative_hits) > 0))))
        OR (${filter} = 'ai-rejected' AND (relevance IS NULL OR relevance = 'unknown' OR (relevance = 'pass' AND selected IS NOT TRUE)))
        OR (${filter} = 'prefilter-402' AND prefilter_402_failed)
        OR (${filter} = 'prefilter-402-keyword' AND prefilter_402_failed AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'unreviewed' AND (relevance = 'unknown' OR (relevance = 'pass' AND selected IS NOT TRUE
          AND (coalesce((analysis_output->>'deadlineStatus'), '') IN ('due_soon', 'unknown') OR coalesce(score, -1) >= ${selectionPolicy.reviewFloor}))))
        OR (${filter} = 'unknown' AND relevance = 'unknown')
        OR (${filter} = 'unanalyzed' AND relevance IS NULL)
    )
      SELECT filtered.*, count(*) OVER()::int AS total,
             count(*) FILTER (WHERE human_label = 'relevant') OVER() AS "humanRelevantCount",
             count(*) FILTER (WHERE human_label = 'irrelevant') OVER() AS "humanIrrelevantCount"
      FROM filtered
      ORDER BY CASE WHEN ${filter} = 'low-no-keyword' THEN md5(article_id || (now() AT TIME ZONE 'Asia/Shanghai')::date::text) END,
               discovered_at DESC, article_id DESC
      LIMIT ${pageSize} OFFSET ${filter === "low-no-keyword" ? page - 1 : (page - 1) * pageSize}`;
    rows = matched;
    total = Number(matched[0]?.total ?? 0);
    humanLabelCounts = {
      relevant: Number(matched[0]?.humanRelevantCount ?? 0),
      irrelevant: Number(matched[0]?.humanIrrelevantCount ?? 0),
    };
    if (filter === "low-no-keyword") {
      sampleEligibleTotal = total;
      total = Math.min(total, LOW_NO_KEYWORD_DAILY_SAMPLE_LIMIT);
    }
  }
  const positiveByTerm = new Map<string, KeywordRule[]>();
  const negativeByTerm = new Map<string, KeywordRule[]>();
  for (const rule of rules.positive) positiveByTerm.set(rule.term.toLocaleLowerCase(), [...(positiveByTerm.get(rule.term.toLocaleLowerCase()) ?? []), rule]);
  for (const rule of rules.negative) negativeByTerm.set(rule.term.toLocaleLowerCase(), [...(negativeByTerm.get(rule.term.toLocaleLowerCase()) ?? []), rule]);
  const resultRows = rows.map(({ total: _total, business_score: _businessScore, positive_hits, negative_hits, review_text, ...row }) => ({
    ...row,
    procurementFacts: procurementFacts(review_text, row.analysis_output),
    positiveHits: positive_hits.flatMap((hit) => positiveByTerm.get(hit) ?? []),
    negativeHits: negative_hits.flatMap((hit) => negativeByTerm.get(hit) ?? []),
    qualificationExtractionAvailable: Array.isArray(row.analysis_output?.businessMatch?.qualificationRequirements),
    qualificationRequirements: assessQualificationRequirements(
      (Array.isArray(row.analysis_output?.businessMatch?.qualificationRequirements) ? row.analysis_output.businessMatch.qualificationRequirements : [])
        .filter((item: any) => (item?.kind === "company" || item?.kind === "personnel") && typeof item?.requirement === "string")
        .map((item: any) => ({ kind: item.kind, requirement: item.requirement, evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds.filter((id: unknown) => typeof id === "string") : [] })),
      qualificationList.rows,
    ).map((item) => ({
      ...item,
      evidence: (row.analysis_output?.businessMatch?.evidence ?? [])
        .filter((evidence: any) => item.evidenceIds.includes(evidence?.id) && evidence?.verified && typeof evidence?.quote === "string")
        .map((evidence: any) => evidence.quote),
    })),
  }));
  return {
    page, pageSize, total, filter: articleId ? "calibration-all" : filter, articleId: articleId || null, humanStatus, days, humanLabelCounts,
    sampleLimit: filter === "low-no-keyword" ? LOW_NO_KEYWORD_DAILY_SAMPLE_LIMIT : null,
    sampleEligibleTotal,
    profileVersion: profile.profileVersion,
    runSlot,
    collectionBatches,
    selectedCollectionBatch: selectedBatch ? { ...selectedBatch, ...selectedBatchReviewStats } : null,
    rules: {
      positive: rules.positive,
      negative: rules.negative,
      capabilities: profile.capabilities.filter((item) => item.enabled).map(({ id, name }) => ({ id, name })),
      scoreThresholds: SELECTION.thresholds,
      scoreCalls: 1,
      understandFloor: selectionPolicy.reviewFloor,
      weights: selectionPolicy.weights,
      dimensions: [
        { key: "taskFit", label: "采购任务与企业能力匹配", max: selectionPolicy.dimensions.taskFit.max },
        { key: "delivery", label: "交付内容吻合", max: selectionPolicy.dimensions.delivery.max },
        { key: "importance", label: "相关任务重要性", max: selectionPolicy.dimensions.importance.max },
      ],
      featuredThreshold: selectionPolicy.featuredThreshold,
      reviewFloor: selectionPolicy.reviewFloor,
      reviewHighFloor: selectionPolicy.reviewHighFloor,
      dueSoonDays: selectionPolicy.dueSoonDays,
    },
    rows: resultRows,
  };
}
