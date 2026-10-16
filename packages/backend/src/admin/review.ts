import { SELECTION } from "@aihot/industry/selection";
import { loadBusinessProfile, type BusinessProfile } from "../editorial/business.ts";
import { loadScoringPolicy } from "../editorial/scoring-policy.ts";
import { sql } from "../db.ts";

type ReviewFilter = "all" | "keyword" | "keyword-and-negative" | "ai-rejected" | "prefilter-402" | "prefilter-402-keyword" | "unreviewed" | "unknown";
type KeywordRule = { term: string; capabilityId: string; capabilityName: string; role: string };
type ReviewDbRow = {
  article_id: string; title: string; url: string; source_name: string; source_tier: string; discovered_at: Date; published_at: Date | null;
  body_status: string; excerpt: string | null; body_preview: string; review_text: string; title_zh: string | null; summary_zh: string | null; category: string | null;
  positive_hits: string[]; negative_hits: string[]; prefilter_402_failed: boolean;
  relevance: string | null; score: number | null; selected: boolean | null; model: string | null; prompt_version: string | null;
  reason_zh: string | null; analysis_output: Record<string, any> | null;
  human_label: string | null; human_capability_ids: string[] | null; human_evidence_quality: string | null; human_note: string | null; human_reviewed_at: Date | null;
  human_history: Array<{ label: string; capabilityIds: string[]; evidenceQuality: string | null; note: string | null; createdAt: Date }>;
  total?: number;
};

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
      ["object", capability.semanticRoles.objects],
    ] as const;
    for (const [role, terms] of roles) for (const term of terms) if (term.trim()) positive.push({ term, capabilityId: capability.id, capabilityName: capability.name, role });
    const negativeTerms = capability.reviewNegativeTerms.length ? capability.reviewNegativeTerms : capability.negativeExamples;
    for (const term of negativeTerms) if (term.trim()) negative.push({ term, capabilityId: capability.id, capabilityName: capability.name, role: "negative" });
  }
  const dedupe = (rules: KeywordRule[]) => rules.filter((rule, index) => rules.findIndex((other) => other.capabilityId === rule.capabilityId && other.role === rule.role && other.term.toLocaleLowerCase() === rule.term.toLocaleLowerCase()) === index);
  return { positive: dedupe(positive), negative: dedupe(negative) };
}

export async function listArticleReviews(input: { q?: string; filter?: string; days?: number; page?: number }) {
  const [profile, scoringPolicy] = await Promise.all([loadBusinessProfile(), loadScoringPolicy()]);
  const rules = keywordRules(profile);
  const positiveTerms = [...new Set(rules.positive.map((rule) => rule.term.toLocaleLowerCase()))];
  const negativeTerms = [...new Set(rules.negative.map((rule) => rule.term.toLocaleLowerCase()))];
  const filter: ReviewFilter = ["all", "keyword", "keyword-and-negative", "ai-rejected", "prefilter-402", "prefilter-402-keyword", "unreviewed", "unknown"].includes(input.filter ?? "") ? input.filter as ReviewFilter : "unreviewed";
  const requestedDays = Number(input.days ?? 30);
  const days = Number.isFinite(requestedDays) ? Math.max(0, Math.min(365, Math.floor(requestedDays))) : 30;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = 25;
  const term = (input.q ?? "").trim().slice(0, 200);
  let rows: ReviewDbRow[];
  let total: number;
  if (filter === "unreviewed" || filter === "all") {
    const dateClause = days === 0 ? sql`` : sql`AND a.discovered_at >= now() - (${days} * interval '1 day')`;
    const searchClause = term ? sql`AND (a.title ILIKE ${`%${term}%`} OR coalesce(a.excerpt, '') ILIKE ${`%${term}%`} OR coalesce(a.body_text, '') ILIKE ${`%${term}%`})` : sql``;
    const reviewClause = filter === "unreviewed" ? sql`AND NOT EXISTS (SELECT 1 FROM business_matching_feedback fb WHERE fb.article_id = a.id)` : sql``;
    const [count] = await sql<{ total: number }[]>`
      SELECT count(*)::int AS total FROM articles a WHERE true ${dateClause} ${searchClause} ${reviewClause}`;
    total = Number(count?.total ?? 0);
    const ids = await sql<{ article_id: string }[]>`
      SELECT a.id AS article_id FROM articles a WHERE true ${dateClause} ${searchClause} ${reviewClause}
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
               lower(concat_ws(' ', a.title, a.excerpt, a.body_text)) AS searchable, p.ordinality
        FROM page_ids p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = a.source_id
        LEFT JOIN failed_402 failed ON failed.article_id = a.id
        LEFT JOIN LATERAL (SELECT relevance, score, selected, model, prompt_version, reason_zh, title_zh, summary_zh, category, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
        LEFT JOIN LATERAL (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) fb ON true
      )
      SELECT base.article_id, base.title, base.url, base.source_name, base.source_tier, base.discovered_at, base.published_at,
        base.body_status, base.excerpt, base.body_preview, base.review_text, base.title_zh, base.summary_zh, base.category, base.prefilter_402_failed,
        base.relevance, base.score, base.selected, base.model, base.prompt_version, base.reason_zh, base.analysis_output,
        base.human_label, base.human_capability_ids, base.human_evidence_quality, base.human_note, base.human_reviewed_at, base.human_history,
        coalesce((SELECT array_agg(t) FROM unnest(${positiveTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS positive_hits,
        coalesce((SELECT array_agg(t) FROM unnest(${negativeTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS negative_hits
      FROM base ORDER BY base.ordinality` : [];
  } else {
    const matched = await sql<(ReviewDbRow & { total: number })[]>`
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
             fb.label AS human_label, fb.capability_ids AS human_capability_ids, fb.evidence_quality AS human_evidence_quality,
             fb.note AS human_note, fb.created_at AS human_reviewed_at,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('label', history.label, 'capabilityIds', history.capability_ids,
                     'evidenceQuality', history.evidence_quality, 'note', history.note, 'createdAt', history.created_at) ORDER BY history.created_at DESC), '[]'::jsonb)
                FROM (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 5) history) AS human_history,
             lower(concat_ws(' ', a.title, a.excerpt, a.body_text)) AS searchable
      FROM articles a JOIN sources s ON s.id = a.source_id
      LEFT JOIN prefilter_402 failed ON failed.article_id = a.id
      LEFT JOIN LATERAL (SELECT relevance, score, selected, model, prompt_version, reason_zh, title_zh, summary_zh, category, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
      LEFT JOIN LATERAL (SELECT label, capability_ids, evidence_quality, note, created_at FROM business_matching_feedback WHERE article_id = a.id ORDER BY created_at DESC LIMIT 1) fb ON true
      WHERE (${days} = 0 OR a.discovered_at >= now() - (${days} * interval '1 day'))
        AND (${filter} NOT IN ('prefilter-402', 'prefilter-402-keyword') OR failed.article_id IS NOT NULL)
        AND (${term} = '' OR a.title ILIKE ${`%${term}%`} OR coalesce(a.excerpt, '') ILIKE ${`%${term}%`} OR coalesce(a.body_text, '') ILIKE ${`%${term}%`})
    ), matched AS (
      SELECT base.*,
        coalesce((SELECT array_agg(t) FROM unnest(${positiveTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS positive_hits,
        coalesce((SELECT array_agg(t) FROM unnest(${negativeTerms}::text[]) t WHERE strpos(base.searchable, t) > 0), ARRAY[]::text[]) AS negative_hits
      FROM base
    ), filtered AS (
      SELECT * FROM matched WHERE
        ${filter} = 'all'
        OR (${filter} = 'keyword' AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'keyword-and-negative' AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) > 0)
        OR (${filter} = 'ai-rejected' AND (relevance IS NULL OR relevance <> 'pass' OR selected IS NOT TRUE))
        OR (${filter} = 'prefilter-402' AND prefilter_402_failed)
        OR (${filter} = 'prefilter-402-keyword' AND prefilter_402_failed AND cardinality(positive_hits) > 0 AND cardinality(negative_hits) = 0)
        OR (${filter} = 'unreviewed' AND human_label IS NULL)
        OR (${filter} = 'unknown' AND relevance = 'unknown' AND human_label IS NULL)
    )
      SELECT filtered.*, count(*) OVER()::int AS total FROM filtered
      ORDER BY discovered_at DESC, article_id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    rows = matched;
    total = Number(matched[0]?.total ?? 0);
  }
  const positiveByTerm = new Map<string, KeywordRule[]>();
  const negativeByTerm = new Map<string, KeywordRule[]>();
  for (const rule of rules.positive) positiveByTerm.set(rule.term.toLocaleLowerCase(), [...(positiveByTerm.get(rule.term.toLocaleLowerCase()) ?? []), rule]);
  for (const rule of rules.negative) negativeByTerm.set(rule.term.toLocaleLowerCase(), [...(negativeByTerm.get(rule.term.toLocaleLowerCase()) ?? []), rule]);
  const resultRows = rows.map(({ total: _total, positive_hits, negative_hits, review_text, ...row }) => ({
    ...row,
    procurementFacts: procurementFacts(review_text, row.analysis_output),
    positiveHits: positive_hits.flatMap((hit) => positiveByTerm.get(hit) ?? []),
    negativeHits: negative_hits.flatMap((hit) => negativeByTerm.get(hit) ?? []),
  }));
  return {
    page, pageSize, total, filter, days,
    profileVersion: profile.profileVersion,
    rules: {
      positive: rules.positive,
      negative: rules.negative,
      scoreThresholds: SELECTION.thresholds,
      scoreCalls: 2,
      understandFloor: SELECTION.understandFloor,
      dimensions: [
        { key: "fit", label: "业务匹配", weight: scoringPolicy.weights.fit },
        { key: "region", label: "地域匹配", weight: scoringPolicy.weights.region },
        { key: "deadline", label: "开标时效", weight: scoringPolicy.weights.deadline },
      ],
      dueSoonDays: scoringPolicy.dueSoonDays,
    },
    rows: resultRows,
  };
}
