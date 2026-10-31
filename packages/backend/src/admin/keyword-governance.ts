import { randomBytes } from "node:crypto";
import { z } from "zod";
import { CATEGORIES } from "@aihot/industry/taxonomy";
import { sql } from "../db.ts";
import { stableJson, sha256 } from "../lib/ids.ts";
import { BUSINESS_PROFILE, invalidateBusinessProfileCache } from "../editorial/business.ts";
import { loadBusinessSelectionPolicy } from "../editorial/business-selection-policy.ts";
import { audit } from "./auth.ts";
import { businessProfile, BusinessProfileSchema, rollbackBusinessProfile, type BusinessProfile } from "./business-matching.ts";

type Kind = "positive" | "negative";
type Role = "serviceAction" | "method" | "deliverable" | "negative";
type Suggestion = { kind: Kind; term: string; normalized: string; variants: string[]; capabilityId: string; role: Role; evidenceSource: "title" | "body"; evidence: string };
type FeedbackSource = { id: number; article_id: string; label: "relevant" | "irrelevant" | "unknown"; capability_ids: string[]; original_result: Record<string, any> | null; title: string; excerpt: string | null; body_text: string | null; created_by: string };
type PreservedProfileDraftPointer = { versionId: string; revision: number };
type GovernanceDraft = { profile_version_id: string; name: string; base_profile_version_id: string | null; term_ids: number[]; official_change_ids: number[]; preserved_profile_draft_pointer: PreservedProfileDraftPointer | null; context_id: string | null; replay_result: any; replayed_at: Date | null; status: string; created_by: string; created_at: Date };

const ReviewTermSchema = z.object({
  action: z.enum(["accept", "edit", "reject"]),
  term: z.string().trim().min(1).max(80).optional(),
  variants: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  capabilityId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).optional(),
  role: z.enum(["serviceAction", "method", "deliverable", "negative"]).optional(),
  note: z.string().max(500).optional(),
}).strict();

const DraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  termIds: z.array(z.number().int().positive()).max(200).default([]),
  officialChangeIds: z.array(z.number().int().positive()).max(200).default([]),
  contextId: z.string().max(64).nullable().optional(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();

const OfficialChangeSchema = z.object({
  kind: z.enum(["positive", "negative"]),
  term: z.string().trim().min(1).max(80),
  capabilityId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  role: z.enum(["serviceAction", "method", "deliverable", "negative"]),
  action: z.enum(["keep", "deactivate", "replace"]),
  replacementTerm: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(500),
}).strict();

const genericTerms = new Set(["采购", "采购项目", "项目", "项目采购", "服务", "采购服务", "服务项目", "招标", "招标公告", "公开招标", "竞争性磋商", "系统", "平台", "建设", "运维", "维护", "开发", "实施", "运营", "供应", "工作"]);

export function normalizeKeywordTerm(value: string) {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function groupKeywordRows(rows: any[], chosenIds: number[] = []) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const normalized = row.normalizedTerm ?? normalizeKeywordTerm(row.term);
    const key = `${row.kind}:${normalized}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...row, normalizedTerm: normalized }]);
  }
  return [...groups.values()].map((group) => {
    const chosen = group.find((item) => chosenIds.includes(Number(item.id))) ?? group[0];
    const variants = [...new Set(group.flatMap((item) => [item.term, ...(item.variants as string[] ?? [])]))]
      .filter((value) => normalizeKeywordTerm(value) !== chosen.normalizedTerm);
    return {
      ...chosen,
      variants,
      termIds: group.map((item) => Number(item.id)),
      capabilityIds: [...new Set(group.map((item) => item.capabilityId))],
    };
  });
}

function id(prefix: string) {
  return `${prefix}-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
}

function contains(text: string, phrase: string) {
  return text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase());
}

function termsInCapability(capability: BusinessProfile["capabilities"][number], kind: Kind) {
  return kind === "negative"
    ? capability.negativeKeywords
    : [...capability.serviceTerms, ...capability.methodTerms, ...capability.deliverableTerms];
}

function officialTerms(profile: BusinessProfile) {
  return profile.capabilities.filter((capability) => capability.enabled).flatMap((capability) => [
    ...capability.serviceTerms.map((term) => ({ kind: "positive" as const, term, role: "serviceAction" as const })),
    ...capability.methodTerms.map((term) => ({ kind: "positive" as const, term, role: "method" as const })),
    ...capability.deliverableTerms.map((term) => ({ kind: "positive" as const, term, role: "deliverable" as const })),
    ...capability.negativeKeywords.map((term) => ({ kind: "negative" as const, term, role: "negative" as const })),
  ].map((item) => ({ ...item, capabilityId: capability.id, capabilityName: capability.name, normalizedTerm: normalizeKeywordTerm(item.term) })));
}

function collectSuggestions(input: {
  row: FeedbackSource;
  profile: BusinessProfile;
  highFloor: number;
}): Suggestion[] {
  const { row, profile } = input;
  if (row.label === "unknown" || !row.capability_ids.length) return [];
  const output = row.original_result?.output ?? {};
  const score = Number(output.businessScore?.total ?? output.businessMatch?.businessScore?.total ?? output.scoreBreakdown?.business ?? -1);
  const kind: Kind = row.label === "irrelevant" ? "negative" : "positive";
  if (kind === "negative" && score < input.highFloor) return [];
  const selected = new Set(row.capability_ids);
  const capabilities = profile.capabilities.filter((capability) => capability.enabled && selected.has(capability.id));
  const body = row.body_text || row.excerpt || "";
  const allText = `${row.title}\n${body}`;
  const proposals = new Map<string, Suggestion>();
  const add = (phrase: unknown, capability: BusinessProfile["capabilities"][number], role: Role, group: string, variants: string[]) => {
    const term = typeof phrase === "string" ? phrase.trim().replace(/\s+/g, " ") : "";
    if (term.length < 2 || term.length > 80 || genericTerms.has(term.toLocaleLowerCase()) || !contains(allText, term)) return;
    const officialTerms = termsInCapability(capability, kind);
    if (officialTerms.some((official) => normalizeKeywordTerm(official) === normalizeKeywordTerm(term))) return;
    const titleHit = contains(row.title, term);
    const source = titleHit ? row.title : body;
    const at = source.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    const evidence = source.slice(Math.max(0, at - 70), Math.min(source.length, at + term.length + 70)).trim();
    const normalized = normalizeKeywordTerm(group || term);
    const key = `${kind}:${capability.id}:${normalized}`;
    const existing = proposals.get(key);
    if (existing) {
      existing.variants = [...new Set([...existing.variants, term, ...variants].filter((value) => normalizeKeywordTerm(value) !== existing.normalized))];
      return;
    }
    proposals.set(key, {
      kind,
      term: group || term,
      normalized,
      variants: [...new Set(variants.filter((value) => normalizeKeywordTerm(value) !== normalized && !officialTerms.some((official) => normalizeKeywordTerm(official) === normalizeKeywordTerm(value))))],
      capabilityId: capability.id,
      role: kind === "negative" ? "negative" : role,
      evidenceSource: titleHit ? "title" : "body",
      evidence,
    });
  };

  const projects = output.businessMatch?.projects;
  if (Array.isArray(projects)) for (const project of projects) for (const task of project?.tasks ?? []) {
    const taskMatches = new Set((task?.matches ?? []).map((match: any) => String(match?.capabilityId ?? "")));
    const taskEntries: Array<{ phrase: unknown; role: Role }> = [
      { phrase: task?.name, role: "serviceAction" },
      { phrase: task?.action, role: "serviceAction" },
      ...(Array.isArray(task?.methods) ? task.methods.map((phrase: unknown) => ({ phrase, role: "method" as const })) : []),
      ...(Array.isArray(task?.deliverables) ? task.deliverables.map((phrase: unknown) => ({ phrase, role: "deliverable" as const })) : []),
    ];
    for (const capability of capabilities) {
      if (kind === "negative" && !taskMatches.has(capability.id)) continue;
      for (const entry of taskEntries) {
        const phrase = typeof entry.phrase === "string" ? entry.phrase.trim().replace(/\s+/g, " ") : "";
        add(phrase, capability, entry.role, phrase, []);
      }
    }
  }

  if (kind === "negative") for (const capability of capabilities) {
    for (const term of [...capability.serviceTerms, ...capability.methodTerms, ...capability.deliverableTerms]) {
      if (contains(allText, term)) add(term, capability, "negative", term, []);
    }
  }
  return [...proposals.values()].filter((item) => item.normalized);
}

async function storeSuggestions(row: FeedbackSource, suggestions: Suggestion[], actor: string) {
  if (!suggestions.length) return 0;
  return sql.begin(async (tx) => {
    let inserted = 0;
    for (const suggestion of suggestions) {
      const [term] = await tx<{ id: number }[]>`
        INSERT INTO business_keyword_terms (kind, term, normalized_term, variants, capability_id, role)
        VALUES (${suggestion.kind}, ${suggestion.term}, ${suggestion.normalized}, ${suggestion.variants}, ${suggestion.capabilityId}, ${suggestion.role})
        ON CONFLICT (kind, capability_id, normalized_term) DO UPDATE SET
          variants = ARRAY(SELECT DISTINCT value FROM unnest(business_keyword_terms.variants || EXCLUDED.variants) AS value WHERE value <> business_keyword_terms.term),
          updated_at = now()
        RETURNING id`;
      const phrases = [...new Set([suggestion.term, ...suggestion.variants])].filter((phrase) => normalizeKeywordTerm(phrase));
      for (const phrase of phrases) {
        const titleHit = contains(row.title, phrase);
        const source = titleHit ? row.title : row.body_text || row.excerpt || "";
        const at = source.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
        const evidence = at < 0 ? suggestion.evidence : source.slice(Math.max(0, at - 70), Math.min(source.length, at + phrase.length + 70)).trim();
        await tx`INSERT INTO business_keyword_candidates
          (article_id, feedback_id, kind, phrase, capability_id, role, evidence_source, evidence, created_by, term_id)
          VALUES (${row.article_id}, ${row.id}, ${suggestion.kind}, ${phrase}, ${suggestion.capabilityId}, ${suggestion.role}, ${titleHit ? "title" : "body"}, ${evidence}, ${actor}, ${term!.id})
          ON CONFLICT (article_id, kind, phrase, capability_id) DO UPDATE SET
            feedback_id = EXCLUDED.feedback_id, evidence_source = EXCLUDED.evidence_source, evidence = EXCLUDED.evidence, term_id = EXCLUDED.term_id`;
        inserted += 1;
      }
    }
    return inserted;
  });
}

export async function collectBusinessKeywordSamples(actor: string) {
  const [profileState, policy] = await Promise.all([businessProfile(), loadBusinessSelectionPolicy()]);
  const profile = profileState.currentProfile?.profile;
  if (!profile) throw new Error("正式业务词库暂不可用");
  const rows = await sql<FeedbackSource[]>`
    SELECT fb.id, fb.article_id, fb.label, fb.capability_ids, fb.original_result, fb.created_by,
           a.title, a.excerpt, a.body_text
      FROM business_matching_feedback fb JOIN articles a ON a.id = fb.article_id
     WHERE fb.label IN ('relevant', 'irrelevant')
       AND fb.keyword_extracted_at IS NULL
     ORDER BY fb.created_at DESC LIMIT 5000`;
  let evidenceCount = 0;
  for (const row of rows) {
    evidenceCount += await storeSuggestions(row, collectSuggestions({ row, profile, highFloor: policy.reviewHighFloor }), actor);
    await sql`UPDATE business_matching_feedback SET keyword_extracted_at = now() WHERE id = ${row.id} AND keyword_extracted_at IS NULL`;
  }
  await audit(actor, "business.keyword.samples.collect", "business-keyword-governance", "汇总已有人工判读样本中的 AI 词条建议", null, { feedbackCount: rows.length, evidenceCount });
  return { feedbackCount: rows.length, evidenceCount };
}

export async function listBusinessKeywordSamples(input: { q?: string; label?: string; page?: number }) {
  const term = (input.q ?? "").trim().slice(0, 160);
  const label = input.label === "relevant" || input.label === "irrelevant" ? input.label : null;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = 20;
  const rows = await sql<any[]>`
    WITH latest AS (
      SELECT DISTINCT ON (fb.article_id) fb.id AS "feedbackId", fb.article_id AS "articleId", fb.label, fb.capability_ids AS "capabilityIds",
             fb.note, fb.created_at AS "reviewedAt", fb.keyword_extracted_at AS "extractedAt", fb.original_result AS "originalResult",
             a.title, a.url, a.published_at AS "publishedAt", a.excerpt, left(coalesce(a.body_text, ''), 2200) AS "bodyPreview",
             an.relevance AS "aiRelevance", an.score AS "aiScore", an.output AS "analysisOutput"
        FROM business_matching_feedback fb JOIN articles a ON a.id = fb.article_id
        LEFT JOIN LATERAL (SELECT relevance, score, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
       WHERE fb.label IN ('relevant', 'irrelevant')
         AND (${label}::text IS NULL OR fb.label = ${label})
         AND (${term} = '' OR a.title ILIKE ${`%${term}%`} OR coalesce(a.excerpt, '') ILIKE ${`%${term}%`} OR coalesce(a.body_text, '') ILIKE ${`%${term}%`})
       ORDER BY fb.article_id, fb.created_at DESC, fb.id DESC
    )
    SELECT latest.*, count(*) OVER()::int AS total,
           (SELECT count(*)::int FROM business_keyword_candidates c WHERE c.feedback_id = latest."feedbackId") AS "extractedTermCount",
           (SELECT count(DISTINCT (t.kind, t.normalized_term))::int FROM business_keyword_candidates c
             JOIN business_keyword_terms t ON t.id = c.term_id WHERE c.feedback_id = latest."feedbackId") AS "extractedGroupCount"
      FROM latest ORDER BY "reviewedAt" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const total = Number(rows[0]?.total ?? 0);
  const [counts] = await sql<any[]>`
    SELECT count(DISTINCT article_id)::int AS "sampleCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'relevant')::int AS "relevantCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'irrelevant')::int AS "irrelevantCount",
           count(*) FILTER (WHERE keyword_extracted_at IS NULL)::int AS "uncollectedFeedbackCount"
      FROM business_matching_feedback WHERE label IN ('relevant', 'irrelevant')`;
  return { rows, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), counts: counts ?? {} };
}

export async function getBusinessKeywordSample(feedbackId: number) {
  const [row] = await sql<any[]>`
    SELECT fb.id AS "feedbackId", fb.article_id AS "articleId", fb.label, fb.capability_ids AS "capabilityIds", fb.note,
           fb.created_at AS "reviewedAt", fb.keyword_extracted_at AS "extractedAt", fb.original_result AS "originalResult", a.title, a.url, a.published_at AS "publishedAt",
           a.excerpt, a.body_text AS "bodyText", an.relevance AS "aiRelevance", an.score AS "aiScore", an.output AS "analysisOutput"
      FROM business_matching_feedback fb JOIN articles a ON a.id = fb.article_id
      LEFT JOIN LATERAL (SELECT relevance, score, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
     WHERE fb.id = ${feedbackId} AND fb.label IN ('relevant', 'irrelevant')`;
  if (!row) return null;
  const state = await businessProfile();
  const profile = state.currentProfile?.profile;
  if (!profile) throw new Error("正式业务词库暂不可用");
  const text = `${row.title}\n${row.excerpt ?? ""}\n${row.bodyText ?? ""}`;
  const hits = profile.capabilities.filter((capability: BusinessProfile["capabilities"][number]) => capability.enabled).flatMap((capability: BusinessProfile["capabilities"][number]) => [
    ...termsInCapability(capability, "positive").filter((phrase) => contains(text, phrase)).map((phrase) => ({ phrase, kind: "positive", capabilityId: capability.id, capabilityName: capability.name, conflict: row.label === "irrelevant" })),
    ...termsInCapability(capability, "negative").filter((phrase) => contains(text, phrase)).map((phrase) => ({ phrase, kind: "negative", capabilityId: capability.id, capabilityName: capability.name, conflict: row.label === "relevant" })),
  ]);
  const extractedTerms = await sql`
    SELECT t.kind, t.normalized_term AS "normalizedTerm", min(t.term) AS phrase,
           ARRAY(SELECT DISTINCT c2.phrase
             FROM business_keyword_candidates c2 JOIN business_keyword_terms t2 ON t2.id = c2.term_id
            WHERE c2.feedback_id = ${feedbackId} AND t2.kind = t.kind AND t2.normalized_term = t.normalized_term
              AND lower(regexp_replace(trim(c2.phrase), '[[:space:][:punct:]]', '', 'g')) <> t.normalized_term
            ORDER BY c2.phrase) AS variants,
           count(*)::int AS "evidenceCount",
           array_agg(DISTINCT t.capability_id ORDER BY t.capability_id) AS "capabilityIds"
      FROM business_keyword_candidates c JOIN business_keyword_terms t ON t.id = c.term_id
     WHERE c.feedback_id = ${feedbackId}
     GROUP BY t.kind, t.normalized_term ORDER BY t.kind, phrase`;
  return { ...row, officialHits: hits, extractedTerms };
}

export async function businessKeywordHitFrequency(input: { q?: string; kind?: string; period?: string }) {
  const state = await businessProfile();
  const profile = state.currentProfile?.profile;
  if (!profile) throw new Error("正式业务词库暂不可用");
  const query = (input.q ?? "").trim().slice(0, 100).toLocaleLowerCase();
  const kind = input.kind === "positive" || input.kind === "negative" ? input.kind : null;
  const period = input.period === "7d" ? "7d" : input.period === "all" ? "all" : "30d";
  const now = new Date();
  const periodDays = period === "7d" ? 7 : period === "30d" ? 30 : null;
  const trendDays = periodDays ?? 30;
  const currentStart = new Date(now.getTime() - trendDays * 24 * 60 * 60_000);
  const previousStart = new Date(now.getTime() - trendDays * 2 * 24 * 60 * 60_000);
  const rangeStart = period === "all" ? null : currentStart;
  const dateFilter = rangeStart ? sql`coalesce(a.published_at, a.discovered_at) >= ${rangeStart}` : sql`true`;
  const grouped = new Map<string, { kind: Kind; term: string; normalizedTerm: string; phrases: string[]; capabilityNames: string[]; roles: string[] }>();
  for (const item of officialTerms(profile)) {
    const key = `${item.kind}:${item.normalizedTerm}`;
    const group = grouped.get(key) ?? { kind: item.kind, term: item.term, normalizedTerm: item.normalizedTerm, phrases: [], capabilityNames: [], roles: [] };
    group.phrases.push(item.term);
    group.capabilityNames.push(item.capabilityName);
    group.roles.push(item.role);
    grouped.set(key, group);
  }
  const terms = [...grouped.values()].filter((item) => (!query || `${item.term} ${item.phrases.join(" ")} ${item.capabilityNames.join(" ")}`.toLocaleLowerCase().includes(query)) && (!kind || item.kind === kind))
    .map((item) => ({ ...item, phrases: [...new Set(item.phrases)], capability_names: [...new Set(item.capabilityNames)], roles: [...new Set(item.roles)] }))
    .map(({ kind: termKind, term, normalizedTerm, phrases, capability_names, roles }) => ({ kind: termKind, term, normalized_term: normalizedTerm, phrases, capability_names, roles }));
  const [summary] = await sql<any[]>`
    WITH latest_feedback AS (
      SELECT DISTINCT ON (article_id) article_id, label
        FROM business_matching_feedback
       WHERE label IN ('relevant', 'irrelevant') AND article_id IS NOT NULL
       ORDER BY article_id, created_at DESC, id DESC
    )
    SELECT count(DISTINCT a.id)::int AS "articleCount",
           count(DISTINCT a.id) FILTER (WHERE fb.label = 'relevant')::int AS "reviewedRelevantCount",
           count(DISTINCT a.id) FILTER (WHERE fb.label = 'irrelevant')::int AS "reviewedIrrelevantCount",
           count(DISTINCT a.id) FILTER (WHERE p.selected)::int AS "selectedCount"
      FROM articles a
      LEFT JOIN latest_feedback fb ON fb.article_id = a.id
      LEFT JOIN publications p ON p.article_id = a.id
     WHERE ${dateFilter}`;
  const termsWithCounts = terms.length ? await sql<any[]>`
    WITH keywords AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms as never)})
        AS x(kind text, term text, normalized_term text, phrases text[], capability_names text[], roles text[])
    ), latest_feedback AS (
      SELECT DISTINCT ON (article_id) article_id, label
        FROM business_matching_feedback
       WHERE label IN ('relevant', 'irrelevant') AND article_id IS NOT NULL
       ORDER BY article_id, created_at DESC, id DESC
    ), hits AS (
      SELECT k.kind, k.term, k.normalized_term, k.capability_names, k.roles,
             CASE WHEN p.category = ANY(${CATEGORIES.map((category) => category.key)}::text[]) THEN p.category ELSE 'unclassified' END AS category,
             a.id AS article_id, fb.label, p.selected
        FROM keywords k
        LEFT JOIN articles a ON ${dateFilter} AND EXISTS (SELECT 1 FROM unnest(k.phrases) phrase
          WHERE strpos(lower(concat_ws(' ', a.title, a.excerpt, a.body_text)), lower(phrase)) > 0)
        LEFT JOIN latest_feedback fb ON fb.article_id = a.id
        LEFT JOIN publications p ON p.article_id = a.id
    )
    SELECT kind, term, normalized_term AS "normalizedTerm", category,
           array_to_string(capability_names, '、') AS "capabilityName", roles,
           count(DISTINCT article_id)::int AS "hitArticleCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'relevant')::int AS "relevantHitCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'irrelevant')::int AS "irrelevantHitCount",
           count(DISTINCT article_id) FILTER (WHERE selected)::int AS "selectedHitCount"
      FROM hits
     GROUP BY kind, term, normalized_term, category, capability_names, roles
     ORDER BY count(DISTINCT article_id) DESC, term, "capabilityName"` : [];
  const trendRows = terms.length ? await sql<any[]>`
    WITH keywords AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms as never)})
        AS x(kind text, term text, normalized_term text, phrases text[], capability_names text[], roles text[])
    ), matched AS (
      SELECT k.kind, k.normalized_term, a.id AS article_id, p.selected,
             coalesce(a.published_at, a.discovered_at) AS matched_at,
             (coalesce(a.published_at, a.discovered_at) AT TIME ZONE 'Asia/Shanghai')::date AS match_day,
             CASE WHEN p.category = ANY(${CATEGORIES.map((category) => category.key)}::text[]) THEN p.category ELSE 'unclassified' END AS category
        FROM keywords k
        JOIN articles a ON coalesce(a.published_at, a.discovered_at) >= ${previousStart}
          AND EXISTS (SELECT 1 FROM unnest(k.phrases) phrase
            WHERE strpos(lower(concat_ws(' ', a.title, a.excerpt, a.body_text)), lower(phrase)) > 0)
        LEFT JOIN publications p ON p.article_id = a.id
    )
    SELECT category,
           (GROUPING(match_day) = 1) AS summary,
           CASE WHEN GROUPING(match_day) = 1 THEN NULL ELSE to_char(match_day, 'YYYY-MM-DD') END AS date,
           count(DISTINCT (kind, normalized_term, article_id)) FILTER (WHERE matched_at >= ${currentStart})::int AS "currentHitCount",
           count(DISTINCT (kind, normalized_term, article_id)) FILTER (WHERE matched_at < ${currentStart})::int AS "previousHitCount",
           count(DISTINCT (kind, normalized_term, article_id)) FILTER (WHERE matched_at >= ${currentStart} AND selected)::int AS "currentSelectedHitCount",
           count(DISTINCT (kind, normalized_term, article_id)) FILTER (WHERE matched_at < ${currentStart} AND selected)::int AS "previousSelectedHitCount"
      FROM matched
     GROUP BY GROUPING SETS ((category, match_day), (category))
     ORDER BY category, summary DESC, date` : [];
  const chinaDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const firstTrendDay = new Date(`${chinaDay(currentStart)}T00:00:00.000Z`);
  const lastTrendDay = new Date(`${chinaDay(now)}T00:00:00.000Z`);
  const trendDates: string[] = [];
  for (let day = firstTrendDay; day <= lastTrendDay; day = new Date(day.getTime() + 24 * 60 * 60_000)) trendDates.push(day.toISOString().slice(0, 10));
  const categories = [
    ...CATEGORIES.map(({ key, label }) => ({ key, label })),
    ...(termsWithCounts.some((item) => item.category === "unclassified" && item.hitArticleCount > 0) ? [{ key: "unclassified", label: "未分类" }] : []),
  ];
  return { summary: summary ?? {}, terms: termsWithCounts, categories, period, rangeStart: rangeStart?.toISOString() ?? null, profileVersionId: state.current?.versionId ?? state.currentProfile?.id ?? null,
    trend: { dates: trendDates, summary: trendRows.filter((row) => row.summary), daily: trendRows.filter((row) => !row.summary) } };
}

export async function listBusinessKeywordOfficialConflicts() {
  const state = await businessProfile();
  const profile = state.currentProfile?.profile;
  if (!profile) throw new Error("正式业务词库暂不可用");
  const terms = officialTerms(profile).map(({ kind, term, normalizedTerm, capabilityId, capabilityName, role }) => ({
    kind, term, normalized_term: normalizedTerm, capability_id: capabilityId, capability_name: capabilityName, role,
  }));
  if (!terms.length) return [];
  return sql<any[]>`
    WITH keywords AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms as never)})
        AS x(kind text, term text, normalized_term text, capability_id text, capability_name text, role text)
    ), labeled AS (
      SELECT DISTINCT ON (fb.article_id) fb.id AS feedback_id, fb.article_id, fb.label, fb.created_at AS reviewed_at,
             a.title, a.url, a.excerpt, a.body_text, an.relevance AS ai_relevance, an.score AS ai_score,
             coalesce(an.output -> 'businessScore' ->> 'total', an.output -> 'businessMatch' -> 'businessScore' ->> 'total',
               an.output -> 'scoreBreakdown' ->> 'business', an.score::text) AS ai_business_score
        FROM business_matching_feedback fb JOIN articles a ON a.id = fb.article_id
        LEFT JOIN LATERAL (SELECT relevance, score, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
       WHERE fb.label IN ('relevant', 'irrelevant')
       ORDER BY fb.article_id, fb.created_at DESC, fb.id DESC
    ), hits AS (
      SELECT k.*, l.feedback_id, l.article_id, l.label, l.reviewed_at, l.title, l.url, l.ai_relevance, l.ai_score, l.ai_business_score, resolved.resolved_at,
             ((k.kind = 'positive' AND l.label = 'irrelevant') OR (k.kind = 'negative' AND l.label = 'relevant')) AS conflict,
             row_number() OVER (PARTITION BY k.kind, k.capability_id, k.normalized_term,
               ((k.kind = 'positive' AND l.label = 'irrelevant') OR (k.kind = 'negative' AND l.label = 'relevant'))
               ORDER BY l.reviewed_at DESC) AS evidence_rank
        FROM keywords k JOIN labeled l
          ON strpos(lower(concat_ws(' ', l.title, l.excerpt, l.body_text)), lower(k.term)) > 0
      LEFT JOIN (
        SELECT kind, capability_id, normalized_term, max(created_at) AS resolved_at
          FROM business_keyword_official_changes WHERE action = 'keep' AND status = 'resolved'
         GROUP BY kind, capability_id, normalized_term
      ) resolved ON resolved.kind = k.kind AND resolved.capability_id = k.capability_id AND resolved.normalized_term = k.normalized_term
       WHERE NOT EXISTS (
         SELECT 1 FROM business_keyword_official_changes change
          WHERE change.kind = k.kind AND change.capability_id = k.capability_id
            AND change.normalized_term = k.normalized_term AND change.status IN ('candidate', 'staged')
       )
    )
    SELECT kind, term, normalized_term AS "normalizedTerm", capability_id AS "capabilityId",
           capability_name AS "capabilityName", role,
           count(DISTINCT article_id)::int AS "hitArticleCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'relevant')::int AS "relevantHitCount",
           count(DISTINCT article_id) FILTER (WHERE label = 'irrelevant')::int AS "irrelevantHitCount",
           count(DISTINCT article_id) FILTER (WHERE conflict AND (resolved_at IS NULL OR reviewed_at > resolved_at))::int AS "conflictCount",
      coalesce(jsonb_agg(jsonb_build_object('articleId', article_id, 'feedbackId', feedback_id, 'title', title, 'url', url, 'label', label,
             'aiRelevance', ai_relevance, 'aiScore', ai_business_score)
             ORDER BY reviewed_at DESC) FILTER (WHERE conflict AND (resolved_at IS NULL OR reviewed_at > resolved_at) AND evidence_rank <= 3), '[]'::jsonb) AS examples
      FROM hits
     GROUP BY kind, term, normalized_term, capability_id, capability_name, role
    HAVING count(*) FILTER (WHERE conflict AND (resolved_at IS NULL OR reviewed_at > resolved_at)) > 0
     ORDER BY "conflictCount" DESC, "hitArticleCount" DESC, term`;
}

export async function keywordBatchFlowCounts(input: { slot: string; start: Date; end: Date; legacy: boolean }) {
  const profile = (await businessProfile()).currentProfile?.profile;
  const terms = profile ? officialTerms(profile).map(({ kind, term, capabilityId }) => ({ kind, term, capabilityId })) : [];
  const [row] = await sql<any[]>`
    WITH batch_articles AS (
      SELECT article_id FROM collection_batch_articles
       WHERE batch_slot = ${input.slot} AND ${!input.legacy}
      UNION
      SELECT data->>'articleId' AS article_id
        FROM pgboss.job
       WHERE ${input.legacy}
         AND name IN ('content.analyze', 'content.extract-body')
         AND data ? 'articleId'
         AND created_on >= ${input.start} AND created_on < ${input.end}
       GROUP BY data->>'articleId'
    ), latest_feedback AS (
      SELECT DISTINCT ON (fb.article_id) fb.id AS feedback_id, fb.article_id, fb.label,
             fb.note, a.title, a.excerpt, a.body_text
        FROM business_matching_feedback fb
        JOIN batch_articles b ON b.article_id = fb.article_id
        JOIN articles a ON a.id = fb.article_id
       WHERE fb.label IN ('relevant', 'irrelevant')
       ORDER BY fb.article_id, fb.created_at DESC, fb.id DESC
    ), official_terms AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms as never)})
        AS x(kind text, term text, capability_id text)
    ), per_sample AS (
      SELECT l.article_id,
             coalesce(bool_or(t.term IS NOT NULL), false) AS has_hit,
             coalesce(bool_or((t.kind = 'positive' AND l.label = 'irrelevant') OR (t.kind = 'negative' AND l.label = 'relevant')), false) AS has_conflict,
             coalesce(bool_or((t.kind = 'positive' AND l.label = 'relevant') OR (t.kind = 'negative' AND l.label = 'irrelevant')), false) AS has_consistent
        FROM latest_feedback l
        LEFT JOIN official_terms t ON strpos(lower(concat_ws(' ', l.title, l.excerpt, l.body_text)), lower(t.term)) > 0
       GROUP BY l.article_id
    ), candidates AS (
      SELECT count(DISTINCT (c.kind, c.capability_id, lower(regexp_replace(trim(c.phrase), '[[:space:][:punct:]]', '', 'g')))) FILTER (WHERE c.kind = 'positive')::int AS positive,
             count(DISTINCT (c.kind, c.capability_id, lower(regexp_replace(trim(c.phrase), '[[:space:][:punct:]]', '', 'g')))) FILTER (WHERE c.kind = 'negative')::int AS negative,
             count(DISTINCT c.article_id) FILTER (WHERE c.kind = 'negative' AND l.label = 'irrelevant')::int AS "negativeSamples",
             count(DISTINCT c.article_id)::int AS samples
        FROM business_keyword_candidates c
        JOIN latest_feedback l ON l.feedback_id = c.feedback_id
    ), candidate_articles AS (
      SELECT DISTINCT c.article_id
        FROM business_keyword_candidates c
        JOIN latest_feedback l ON l.feedback_id = c.feedback_id
    ), sample_paths AS (
      SELECT p.article_id, p.has_hit, ca.article_id IS NOT NULL AS has_candidate
        FROM per_sample p LEFT JOIN candidate_articles ca ON ca.article_id = p.article_id
    )
    SELECT (SELECT count(*)::int FROM latest_feedback) AS "traceableSamples",
           (SELECT count(*) FILTER (WHERE label = 'relevant')::int FROM latest_feedback) AS "labeledRelevant",
           (SELECT count(*) FILTER (WHERE label = 'irrelevant')::int FROM latest_feedback) AS "labeledIrrelevant",
           (SELECT count(*) FILTER (WHERE has_hit)::int FROM per_sample) AS "formalHitSamples",
           (SELECT count(*) FILTER (WHERE label = 'irrelevant' AND note LIKE '低分批量判读：%')::int FROM latest_feedback) AS "lowScoreIrrelevantSamples",
           (SELECT count(*) FILTER (WHERE has_conflict)::int FROM per_sample) AS "conflictSamples",
           (SELECT count(*) FILTER (WHERE has_consistent AND NOT has_conflict)::int FROM per_sample) AS "consistentSamples",
           (SELECT count(*) FILTER (WHERE NOT has_hit)::int FROM per_sample) AS "noFormalHitSamples",
           (SELECT count(*) FILTER (WHERE has_conflict AND has_consistent)::int FROM per_sample) AS "mixedSamples",
           candidates.positive AS "positiveCandidateCount",
           candidates.negative AS "negativeCandidateCount",
           candidates."negativeSamples" AS "negativeCandidateSamples",
           candidates.samples AS "candidateSamples",
           (SELECT count(*) FILTER (WHERE has_hit AND has_candidate)::int FROM sample_paths) AS "formalAndCandidateSamples",
           (SELECT count(*) FILTER (WHERE has_hit AND NOT has_candidate)::int FROM sample_paths) AS "formalOnlySamples",
           (SELECT count(*) FILTER (WHERE NOT has_hit AND has_candidate)::int FROM sample_paths) AS "candidateOnlySamples",
           (SELECT count(*) FILTER (WHERE NOT has_hit AND NOT has_candidate)::int FROM sample_paths) AS "neitherSamples"
      FROM candidates`;
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)]));
}

const flowDrillFilters = {
  samples: sql`true`,
  relevant: sql`label = 'relevant'`,
  irrelevant: sql`label = 'irrelevant'`,
  formalHit: sql`has_hit`,
  conflict: sql`has_conflict`,
  consistent: sql`has_consistent AND NOT has_conflict`,
  noFormalHit: sql`NOT has_hit`,
  formalAndCandidate: sql`has_hit AND has_candidate`,
  formalOnly: sql`has_hit AND NOT has_candidate`,
  candidateOnly: sql`NOT has_hit AND has_candidate`,
  neither: sql`NOT has_hit AND NOT has_candidate`,
  candidateSamples: sql`has_candidate`,
  noCandidateSamples: sql`NOT has_candidate`,
  negativeCandidateSamples: sql`has_negative_candidate AND label = 'irrelevant'`,
  irrelevantWithoutCandidate: sql`label = 'irrelevant' AND NOT has_negative_candidate`,
  lowScoreIrrelevant: sql`label = 'irrelevant' AND note LIKE '低分批量判读：%'`,
} as const;

export type KeywordFlowDrillMetric = keyof typeof flowDrillFilters;

function drillFact(text: string, labels: string[], pattern: RegExp) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const labelPattern = new RegExp(`(${escaped})\\s*[：:]?`, "gu");
  for (const match of text.matchAll(labelPattern)) {
    const value = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 180)
      .split(/[。；;\n]/u, 1)[0]?.match(pattern)?.[0];
    if (value) return `${match[1]}：${value.replace(/\s+/g, " ").replace(/\.\s+(?=\d)/g, ".").trim()}`;
  }
  return null;
}

export async function keywordBatchFlowDocuments(input: {
  slot: string;
  start: Date;
  end: Date;
  legacy: boolean;
  metric: KeywordFlowDrillMetric;
  page?: number;
}) {
  const profile = (await businessProfile()).currentProfile?.profile;
  const terms = profile ? officialTerms(profile).map(({ kind, term, capabilityId }) => ({ kind, term, capabilityId })) : [];
  const condition = flowDrillFilters[input.metric];
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = 50;
  const rows = await sql<any[]>`
    WITH batch_articles AS (
      SELECT article_id FROM collection_batch_articles
       WHERE batch_slot = ${input.slot} AND ${!input.legacy}
      UNION
      SELECT data->>'articleId' AS article_id
        FROM pgboss.job
       WHERE ${input.legacy}
         AND name IN ('content.analyze', 'content.extract-body')
         AND data ? 'articleId'
         AND created_on >= ${input.start} AND created_on < ${input.end}
       GROUP BY data->>'articleId'
    ), latest_feedback AS (
      SELECT DISTINCT ON (fb.article_id) fb.id AS feedback_id, fb.article_id, fb.label,
             fb.note, a.title, a.excerpt, a.body_text, a.published_at, a.discovered_at
        FROM business_matching_feedback fb
        JOIN batch_articles b ON b.article_id = fb.article_id
        JOIN articles a ON a.id = fb.article_id
       WHERE fb.label IN ('relevant', 'irrelevant')
       ORDER BY fb.article_id, fb.created_at DESC, fb.id DESC
    ), official_terms AS (
      SELECT * FROM jsonb_to_recordset(${sql.json(terms as never)})
        AS x(kind text, term text, capability_id text)
    ), per_sample AS (
      SELECT l.*,
             coalesce(bool_or(t.term IS NOT NULL), false) AS has_hit,
             coalesce(bool_or((t.kind = 'positive' AND l.label = 'irrelevant') OR (t.kind = 'negative' AND l.label = 'relevant')), false) AS has_conflict,
             coalesce(bool_or((t.kind = 'positive' AND l.label = 'relevant') OR (t.kind = 'negative' AND l.label = 'irrelevant')), false) AS has_consistent
        FROM latest_feedback l
        LEFT JOIN official_terms t ON strpos(lower(concat_ws(' ', l.title, l.excerpt, l.body_text)), lower(t.term)) > 0
       GROUP BY l.feedback_id, l.article_id, l.label, l.note, l.title, l.excerpt, l.body_text, l.published_at, l.discovered_at
    ), candidate_articles AS (
      SELECT c.article_id,
             bool_or(c.kind = 'positive') AS has_positive_candidate,
             bool_or(c.kind = 'negative') AS has_negative_candidate
        FROM business_keyword_candidates c
        JOIN latest_feedback l ON l.feedback_id = c.feedback_id
       GROUP BY c.article_id
    ), sample_paths AS (
      SELECT p.*, ca.article_id IS NOT NULL AS has_candidate,
             coalesce(ca.has_positive_candidate, false) AS has_positive_candidate,
             coalesce(ca.has_negative_candidate, false) AS has_negative_candidate
        FROM per_sample p LEFT JOIN candidate_articles ca ON ca.article_id = p.article_id
    ), filtered AS (
      SELECT *, count(*) OVER()::int AS total
        FROM sample_paths
       WHERE ${condition}
       ORDER BY coalesce(published_at, discovered_at) DESC, article_id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    )
    SELECT article_id AS "articleId", title, excerpt, body_text AS "bodyText", total
      FROM filtered`;
  const total = Number(rows[0]?.total ?? 0);
  return {
    metric: input.metric,
    page,
    pageSize,
    total,
    rows: rows.map((row) => {
      const text = [row.title, row.excerpt, row.bodyText].filter(Boolean).join("\n");
      return {
        articleId: row.articleId,
        title: row.title,
        openingTime: drillFact(text, ["投标文件递交截止时间", "递交投标文件截止时间", "响应文件提交截止时间", "响应文件递交截止时间", "提交响应文件截止时间", "投标截止时间", "开标时间", "报名截止时间"], /20\d{2}\s*(?:年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*(?:日|号)?)?|[-/.]\s*\d{1,2}(?:\s*[-/.]\s*\d{1,2})?)(?:\s*(?:上午|下午)?\s*(?:\d{1,2}\s*(?:时|点)(?:\s*\d{1,2}\s*分)?|\d{1,2}:\d{2}))?/u),
        amount: drillFact(text, ["采购预算", "项目预算金额", "预算金额", "项目预算", "最高投标限价", "最高限价"], /(?:(?:人民币|RMB|¥|￥)\s*)?\d[\d,]*(?:\.\s*\d+)?\s*(?:亿元|万元|元|%|％)|百分之\s*\d+(?:\.\d+)?/iu),
      };
    }),
  };
}

export async function listBusinessKeywordOfficialChanges(status = "candidate") {
  const validStatus = ["candidate", "staged", "published", "rejected"].includes(status) ? status : "candidate";
  return sql<any[]>`SELECT id, kind, term, normalized_term AS "normalizedTerm", capability_id AS "capabilityId",
      role, action, replacement_term AS "replacementTerm", status, profile_version_id AS "profileVersionId",
      review_note AS "reviewNote", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM business_keyword_official_changes WHERE status = ${validStatus} ORDER BY created_at DESC, id DESC`;
}

export async function createBusinessKeywordOfficialChange(input: unknown, actor: string) {
  const parsed = OfficialChangeSchema.parse(input);
  if ((parsed.kind === "negative") !== (parsed.role === "negative")) throw new Error("词条极性与角色不一致");
  if (parsed.action === "replace" && !parsed.replacementTerm) throw new Error("请输入替换后的正式词");
  if (parsed.action !== "replace" && parsed.replacementTerm) throw new Error("该操作不能填写替换词");
  const profile = (await businessProfile()).currentProfile?.profile;
  const capability = profile?.capabilities.find((item) => item.id === parsed.capabilityId);
  if (!capability || !termsInCapability(capability, parsed.kind).some((term) => normalizeKeywordTerm(term) === normalizeKeywordTerm(parsed.term))) {
    throw new Error("该正式词已不存在或已变化，请刷新后重试");
  }
  if (parsed.action === "replace" && normalizeKeywordTerm(parsed.replacementTerm!) === normalizeKeywordTerm(parsed.term)) throw new Error("替换词与原词相同");
  const normalized = normalizeKeywordTerm(parsed.term);
  const [existing] = await sql<any[]>`SELECT id FROM business_keyword_official_changes
    WHERE kind = ${parsed.kind} AND capability_id = ${parsed.capabilityId} AND normalized_term = ${normalized}
      AND status IN ('candidate', 'staged') ORDER BY id DESC LIMIT 1`;
  if (existing) throw new Error("该正式词已有待配置变更");
  const [change] = await sql<any[]>`INSERT INTO business_keyword_official_changes
    (kind, term, normalized_term, capability_id, role, action, replacement_term, review_note, created_by, status)
    VALUES (${parsed.kind}, ${parsed.term}, ${normalized}, ${parsed.capabilityId}, ${parsed.role}, ${parsed.action},
      ${parsed.replacementTerm ?? null}, ${parsed.reason}, ${actor}, ${parsed.action === "keep" ? "resolved" : "candidate"})
    RETURNING id, kind, term, capability_id AS "capabilityId", action, replacement_term AS "replacementTerm", status`;
  await audit(actor, "business.keyword-official-change.create", `business-keyword-official-change:${change.id}`, parsed.reason, null, change);
  return change;
}

export async function keywordGovernanceOverview() {
  const [overview] = await sql<Record<string, number>[]>`
    WITH evidenced_terms AS (
      SELECT DISTINCT t.kind, t.normalized_term, t.status
        FROM business_keyword_terms t
       WHERE EXISTS (
         SELECT 1 FROM business_keyword_candidates c JOIN business_keyword_terms linked ON linked.id = c.term_id
          WHERE linked.kind = t.kind AND linked.normalized_term = t.normalized_term
       )
    )
    SELECT (SELECT count(DISTINCT article_id)::int FROM business_matching_feedback WHERE label IN ('relevant', 'irrelevant')) AS "labeledSamples",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'pending') AS "pendingTerms",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'candidate') AS "candidateTerms",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'staged') AS "stagedTerms",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'published') AS "publishedTerms",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'pending' AND kind = 'positive') AS "pendingPositive",
           (SELECT count(*)::int FROM evidenced_terms WHERE status = 'pending' AND kind = 'negative') AS "pendingNegative",
           (SELECT count(*)::int FROM business_matching_feedback WHERE label IN ('relevant', 'irrelevant') AND keyword_extracted_at IS NULL) AS "uncollectedFeedback"`;
  return overview ?? { labeledSamples: 0, pendingTerms: 0, candidateTerms: 0, stagedTerms: 0, publishedTerms: 0, pendingPositive: 0, pendingNegative: 0, uncollectedFeedback: 0 };
}

export async function listBusinessKeywordTerms(input: { status: string; kind?: string; q?: string; feedbackId?: number }) {
  const status = ["pending", "candidate", "staged", "published", "rejected"].includes(input.status) ? input.status : "pending";
  const kind = input.kind === "positive" || input.kind === "negative" ? input.kind : null;
  const q = (input.q ?? "").trim().slice(0, 100);
  const feedbackId = Number.isSafeInteger(input.feedbackId) && Number(input.feedbackId) > 0 ? Number(input.feedbackId) : null;
  return sql`
    WITH stats AS (
      SELECT t.kind, t.normalized_term, count(DISTINCT c.article_id)::int AS "sourceCount",
             count(DISTINCT c.article_id) FILTER (WHERE fb.label = 'relevant')::int AS "relevantCount",
             count(DISTINCT c.article_id) FILTER (WHERE fb.label = 'irrelevant')::int AS "irrelevantCount",
             count(DISTINCT c.article_id) FILTER (WHERE c.created_at >= now() - interval '30 days')::int AS "recentCount",
             count(DISTINCT c.article_id) FILTER (WHERE c.created_at >= now() - interval '60 days' AND c.created_at < now() - interval '30 days')::int AS "previousCount",
             max(c.created_at) AS "lastSeen"
        FROM business_keyword_candidates c JOIN business_keyword_terms t ON t.id = c.term_id
        LEFT JOIN business_matching_feedback fb ON fb.id = c.feedback_id
       GROUP BY t.kind, t.normalized_term
    ), groups AS (
      SELECT kind, normalized_term, status, array_agg(id ORDER BY id) AS "termIds",
             array_agg(DISTINCT capability_id ORDER BY capability_id) AS "capabilityIds"
        FROM business_keyword_terms
       WHERE status IN ('pending', 'candidate', 'staged', 'published', 'rejected')
       GROUP BY kind, normalized_term, status
    )
    SELECT representative.id, g.kind, representative.term,
           ARRAY(SELECT DISTINCT phrase FROM business_keyword_terms t
             CROSS JOIN LATERAL unnest(t.variants || ARRAY[t.term]) AS item(phrase)
            WHERE t.kind = g.kind AND t.normalized_term = g.normalized_term AND t.status = g.status
              AND lower(regexp_replace(trim(phrase), '[[:space:][:punct:]]', '', 'g')) <> g.normalized_term
            ORDER BY phrase) AS variants,
           representative.capability_id AS "capabilityId", g."capabilityIds", representative.role, g.status,
           representative.context_id AS "contextId", representative.profile_version_id AS "profileVersionId", representative.created_at AS "createdAt",
           g."termIds", coalesce(s."sourceCount", 0)::int AS "sourceCount", coalesce(s."relevantCount", 0)::int AS "relevantCount",
           coalesce(s."irrelevantCount", 0)::int AS "irrelevantCount", coalesce(s."recentCount", 0)::int AS "recentCount",
           coalesce(s."previousCount", 0)::int AS "previousCount", s."lastSeen"
      FROM groups g
      LEFT JOIN stats s ON s.kind = g.kind AND s.normalized_term = g.normalized_term
      JOIN LATERAL (
        SELECT t.id, t.term, t.capability_id, t.role, t.context_id, t.profile_version_id, t.created_at, t.updated_at
          FROM business_keyword_terms t
          LEFT JOIN stats term_stats ON term_stats.kind = t.kind AND term_stats.normalized_term = t.normalized_term
         WHERE t.kind = g.kind AND t.normalized_term = g.normalized_term AND t.status = g.status
         ORDER BY coalesce(term_stats."sourceCount", 0) DESC, t.updated_at DESC, t.id DESC LIMIT 1
      ) representative ON true
     WHERE g.status = ${status} AND (${kind}::text IS NULL OR g.kind = ${kind})
       AND (g.status = 'rejected' OR coalesce(s."sourceCount", 0) > 0)
       AND (${feedbackId}::bigint IS NULL OR EXISTS (
         SELECT 1 FROM business_keyword_candidates c JOIN business_keyword_terms linked ON linked.id = c.term_id
          WHERE c.feedback_id = ${feedbackId} AND linked.kind = g.kind
            AND linked.normalized_term = g.normalized_term AND linked.status = g.status
       ))
       AND (${q} = '' OR EXISTS (SELECT 1 FROM business_keyword_terms t
         WHERE t.kind = g.kind AND t.normalized_term = g.normalized_term AND t.status = g.status
           AND (t.term ILIKE ${`%${q}%`} OR EXISTS (SELECT 1 FROM unnest(t.variants) v WHERE v ILIKE ${`%${q}%`})) ))
     ORDER BY coalesce(s."sourceCount", 0) DESC, representative.updated_at DESC, representative.id DESC LIMIT 300`;
}

export async function getBusinessKeywordTerm(termId: number) {
  const [term] = await sql<any[]>`SELECT t.id, t.kind, t.term, t.normalized_term AS "normalizedTerm", t.variants,
      t.capability_id AS "capabilityId", t.role, t.status, t.context_id AS "contextId", t.review_note AS "reviewNote",
      ARRAY(SELECT id FROM business_keyword_terms grouped WHERE grouped.kind = t.kind AND grouped.normalized_term = t.normalized_term
        AND grouped.status IN ('pending', 'candidate') ORDER BY id) AS "termIds",
      ARRAY(SELECT DISTINCT capability_id FROM business_keyword_terms grouped WHERE grouped.kind = t.kind AND grouped.normalized_term = t.normalized_term
        AND grouped.status IN ('pending', 'candidate') ORDER BY capability_id) AS "capabilityIds",
      ARRAY(SELECT DISTINCT phrase FROM business_keyword_terms grouped CROSS JOIN LATERAL unnest(grouped.variants || ARRAY[grouped.term]) AS item(phrase)
        WHERE grouped.kind = t.kind AND grouped.normalized_term = t.normalized_term AND grouped.status IN ('pending', 'candidate')
          AND lower(regexp_replace(trim(phrase), '[[:space:][:punct:]]', '', 'g')) <> t.normalized_term ORDER BY phrase) AS variants
    FROM business_keyword_terms t WHERE t.id = ${termId}`;
  if (!term) return null;
  const evidence = await sql`
    SELECT DISTINCT ON (a.id) c.id, c.phrase, c.evidence_source AS "evidenceSource", c.evidence, c.created_at AS "createdAt",
           a.id AS "articleId", a.title, a.url, a.excerpt, left(coalesce(a.body_text, ''), 1500) AS "bodyPreview",
           fb.label AS "humanLabel", an.relevance AS "aiRelevance", an.score AS "aiScore", an.output AS "analysisOutput"
      FROM business_keyword_candidates c JOIN business_keyword_terms grouped ON grouped.id = c.term_id JOIN articles a ON a.id = c.article_id
      LEFT JOIN business_matching_feedback fb ON fb.id = c.feedback_id
      LEFT JOIN LATERAL (SELECT relevance, score, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
     WHERE grouped.kind = ${term.kind} AND grouped.normalized_term = ${term.normalizedTerm}
     ORDER BY a.id, c.created_at DESC, c.id DESC LIMIT 30`;
  const [stats] = await sql<any[]>`SELECT count(DISTINCT c.article_id)::int AS "sourceCount",
      count(DISTINCT c.article_id) FILTER (WHERE fb.label = 'relevant')::int AS "relevantCount",
      count(DISTINCT c.article_id) FILTER (WHERE fb.label = 'irrelevant')::int AS "irrelevantCount"
    FROM business_keyword_candidates c JOIN business_keyword_terms grouped ON grouped.id = c.term_id
    LEFT JOIN business_matching_feedback fb ON fb.id = c.feedback_id
   WHERE grouped.kind = ${term.kind} AND grouped.normalized_term = ${term.normalizedTerm}`;
  return { ...term, ...stats, evidence };
}

export async function reviewBusinessKeywordTerm(termId: number, input: unknown, actor: string) {
  const parsed = ReviewTermSchema.parse(input);
  const result = await sql.begin(async (tx) => {
    const [term] = await tx<any[]>`SELECT t.* FROM business_keyword_terms t
      WHERE t.id = ${termId} AND EXISTS (
        SELECT 1 FROM business_keyword_candidates c JOIN business_keyword_terms linked ON linked.id = c.term_id
         WHERE linked.kind = t.kind AND linked.normalized_term = t.normalized_term
      ) FOR UPDATE`;
    if (!term || term.status !== "pending") return null;
    const group = await tx<any[]>`SELECT * FROM business_keyword_terms
      WHERE kind = ${term.kind} AND normalized_term = ${term.normalized_term} AND status IN ('pending', 'candidate') FOR UPDATE`;
    const groupIds = group.map((item) => Number(item.id));
    if (parsed.action === "reject") {
      await tx`UPDATE business_keyword_terms SET status = 'rejected', reviewed_by = ${actor}, reviewed_at = now(), review_note = ${parsed.note ?? null}, updated_at = now() WHERE id = ANY(${groupIds})`;
      await tx`UPDATE business_keyword_candidates SET status = 'rejected', reviewed_by = ${actor}, reviewed_at = now(), review_note = ${parsed.note ?? null} WHERE term_id = ANY(${groupIds}) AND status IN ('pending', 'staged')`;
      return { status: "rejected", before: group, after: { id: termId, termIds: groupIds, status: "rejected" } };
    }
    const nextTerm = parsed.action === "edit" ? parsed.term?.trim() : term.term;
    const capabilityId = parsed.action === "edit" ? parsed.capabilityId ?? term.capability_id : term.capability_id;
    const role = parsed.action === "edit" ? parsed.role ?? term.role : term.role;
    const kind = term.kind as Kind;
    if (!nextTerm) throw new Error("标准化词语不能为空");
    if ((kind === "negative") !== (role === "negative")) throw new Error("负向候选需使用负向词类型，正向候选需选择正向词类型");
    const normalized = normalizeKeywordTerm(nextTerm);
    const [same] = await tx<any[]>`SELECT * FROM business_keyword_terms WHERE kind = ${kind} AND capability_id = ${capabilityId}
      AND normalized_term = ${normalized} AND NOT (id = ANY(${groupIds})) AND status IN ('pending', 'candidate') FOR UPDATE`;
    const allRows = [...group, ...(same ? [same] : [])];
    const canonical = same ?? group.find((item) => Number(item.id) === termId) ?? term;
    const canonicalId = Number(canonical.id);
    const allIds = [...new Set(allRows.map((item) => Number(item.id)))];
    const variants = [...new Set<string>([
      ...allRows.flatMap((item) => [item.term, ...(item.variants as string[] ?? [])]),
      ...(parsed.variants ?? []),
    ].map((value) => value.trim()).filter((value) => value && normalizeKeywordTerm(value) !== normalized))];
    await tx`UPDATE business_keyword_candidates SET term_id = ${canonicalId}
      WHERE term_id = ANY(${allIds})`;
    await tx`UPDATE business_keyword_terms SET term = ${nextTerm}, normalized_term = ${normalized}, variants = ${variants},
      capability_id = ${capabilityId}, role = ${role}, status = 'candidate', reviewed_by = ${actor}, reviewed_at = now(),
      review_note = ${parsed.note ?? null}, updated_at = now() WHERE id = ${canonicalId}`;
    await tx`UPDATE business_keyword_terms SET status = 'rejected', reviewed_by = ${actor}, reviewed_at = now(),
      review_note = ${`合并到词条 ${canonicalId}`}, updated_at = now() WHERE id = ANY(${allIds}) AND id <> ${canonicalId}`;
    return { status: "candidate", before: allRows, after: { id: canonicalId, termIds: allIds, term: nextTerm, variants, capabilityId, role, status: "candidate" } };
  });
  if (!result) return null;
  await audit(actor, `business.keyword-term.${parsed.action}`, `business-keyword-term:${termId}`, parsed.note ?? null, result.before, result.after);
  return result.after;
}

export function appendCandidateTerms(profileInput: BusinessProfile, terms: Array<{ kind: Kind; term: string; variants?: string[]; role: Role; capabilityId: string }>) {
  const profile = BusinessProfileSchema.parse(profileInput);
  const next = structuredClone(profile);
  for (const term of terms) {
    const capability = next.capabilities.find((item) => item.id === term.capabilityId);
    if (!capability) throw new Error(`业务能力不存在：${term.capabilityId}`);
    const target = term.kind === "negative" ? capability.negativeKeywords
      : term.role === "method" ? capability.methodTerms
      : term.role === "deliverable" ? capability.deliverableTerms : capability.serviceTerms;
    for (const phrase of [...new Set([term.term, ...(term.variants ?? [])])]) {
      if (!target.some((value) => normalizeKeywordTerm(value) === normalizeKeywordTerm(phrase))) target.push(phrase);
    }
  }
  return BusinessProfileSchema.parse(next);
}

export function applyOfficialKeywordChanges(profileInput: BusinessProfile, changes: Array<{ kind: Kind; term: string; capability_id: string; role: Role; action: "deactivate" | "replace"; replacement_term: string | null }>) {
  const next = BusinessProfileSchema.parse(structuredClone(profileInput));
  for (const change of changes) {
    const capability = next.capabilities.find((item) => item.id === change.capability_id);
    if (!capability) throw new Error(`业务能力不存在：${change.capability_id}`);
    const buckets = [capability.serviceTerms, capability.methodTerms, capability.deliverableTerms, capability.negativeKeywords];
    for (const bucket of buckets) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (normalizeKeywordTerm(bucket[i]) === normalizeKeywordTerm(change.term)) bucket.splice(i, 1);
      }
    }
    if (change.action === "replace" && change.replacement_term) {
      const target = change.kind === "negative" ? capability.negativeKeywords
        : change.role === "method" ? capability.methodTerms
        : change.role === "deliverable" ? capability.deliverableTerms : capability.serviceTerms;
      if (!target.some((item) => normalizeKeywordTerm(item) === normalizeKeywordTerm(change.replacement_term!))) target.push(change.replacement_term);
    }
  }
  return BusinessProfileSchema.parse(next);
}

export function toAihotBusinessJson(profileInput: BusinessProfile, profileVersion: string) {
  const profile = BusinessProfileSchema.parse(profileInput);
  const priorityToLevel = { "重点": "core", "常规": "regular", "观察": "watch" } as const;
  return {
    ...BUSINESS_PROFILE,
    profileVersion,
    contexts: profile.contexts,
    capabilities: BUSINESS_PROFILE.capabilities.map((base) => {
      const capability = profile.capabilities.find((item) => item.id === base.id);
      if (!capability) return base;
      return {
        ...base,
        name: capability.name,
        businessCategory: capability.businessCategory,
        level: priorityToLevel[capability.priority],
        enabled: capability.enabled,
        description: capability.description,
        semanticRoles: {
          serviceActions: capability.serviceTerms,
          methods: capability.methodTerms,
          deliverables: capability.deliverableTerms,
          objects: capability.contextTerms,
        },
        positiveExamples: capability.positiveExamples,
        negativeExamples: capability.negativeExamples,
        reviewNegativeTerms: capability.negativeKeywords,
        boundaries: { ...base.boundaries, include: capability.boundaries },
      };
    }),
  };
}

export async function createBusinessKeywordDraft(input: unknown, actor: string) {
  const parsed = DraftSchema.parse(input);
  const state = await businessProfile();
  const currentVersion = state.current?.versionId ?? "";
  const currentDraft = state.draft?.versionId ?? currentVersion;
  const expectedRevision = state.draft?.revision ?? 0;
  if (parsed.expectedRevision !== expectedRevision) throw new Error("配置草稿已变化，请刷新后重试");
  const [currentDraftGovernance] = currentDraft !== currentVersion
    ? await sql<GovernanceDraft[]>`SELECT * FROM business_keyword_governance_drafts WHERE profile_version_id = ${currentDraft}`
    : [];
  if (currentDraftGovernance && currentDraftGovernance.status !== "published") throw new Error("请先完成现有关键词治理草稿");
  const preservedProfileDraft = state.draft && state.draft.versionId !== currentVersion && !currentDraftGovernance
    ? { versionId: state.draft.versionId, revision: state.draft.revision }
    : null;
  const selectedIds = [...new Set(parsed.termIds)];
  const selectedChangeIds = [...new Set(parsed.officialChangeIds)];
  if (!selectedIds.length && !selectedChangeIds.length) throw new Error("至少选择一项候选词或正式词调整");
  const profileBase = (preservedProfileDraft ? state.currentProfile?.profile : state.draftProfile?.profile) ?? state.currentProfile?.profile;
  if (!profileBase) throw new Error("正式词库暂不可用");
  const selectedRows = await sql<any[]>`SELECT t.id, t.kind, t.normalized_term AS "normalizedTerm"
    FROM business_keyword_terms t WHERE t.id = ANY(${selectedIds}) AND t.status = 'candidate' AND EXISTS (
      SELECT 1 FROM business_keyword_candidates c JOIN business_keyword_terms linked ON linked.id = c.term_id
       WHERE linked.kind = t.kind AND linked.normalized_term = t.normalized_term
    )`;
  if (selectedRows.length !== selectedIds.length) throw new Error("所选候选词已变化，请刷新候选词池");
  const selectedChanges = await sql<any[]>`SELECT * FROM business_keyword_official_changes
    WHERE id = ANY(${selectedChangeIds}) AND status = 'candidate'`;
  if (selectedChanges.length !== selectedChangeIds.length) throw new Error("所选正式词调整已变化，请刷新候选词池");
  const rows = await sql<any[]>`SELECT t.id, t.kind, t.normalized_term AS "normalizedTerm", t.term, t.variants, t.role,
      t.capability_id AS "capabilityId", t.context_id AS "contextId"
    FROM business_keyword_terms t
   WHERE t.status = 'candidate' AND EXISTS (
     SELECT 1 FROM business_keyword_terms selected
      WHERE selected.id = ANY(${selectedIds}) AND selected.status = 'candidate'
        AND selected.kind = t.kind AND selected.normalized_term = t.normalized_term
   )`;
  const groupedTerms = groupKeywordRows(rows, selectedIds);
  const terms = groupedTerms.map(({ id, kind, term, variants, role, capabilityId }) => ({ id, kind, term, variants, role, capabilityId }));
  const groupIds = groupedTerms.flatMap((group) => group.termIds);
  if (parsed.contextId && !profileBase.contexts.some((context: BusinessProfile["contexts"][number]) => context.id === parsed.contextId)) throw new Error("请选择现有行业范围");
  const withCandidates = appendCandidateTerms(profileBase, terms);
  const profile = applyOfficialKeywordChanges(withCandidates, selectedChanges);
  const contentHash = sha256(stableJson(profile));
  const versionId = id("bp-keyword");
  const revision = expectedRevision + 1;
  const result = await sql.begin(async (tx) => {
    const [draftRow] = await tx<{ value: { versionId: string; revision: number } }[]>`SELECT value FROM settings WHERE key = 'business_profile.draft' FOR UPDATE`;
    if ((draftRow?.value.revision ?? 0) !== parsed.expectedRevision) throw new Error("配置草稿已变化，请刷新后重试");
    if (draftRow?.value.versionId !== currentDraft) throw new Error("业务配置草稿已变化，请刷新后重试");
    if (draftRow?.value.versionId && draftRow.value.versionId !== currentVersion && !preservedProfileDraft) {
      await tx`UPDATE business_keyword_terms SET status = 'candidate', profile_version_id = NULL, updated_at = now()
        WHERE status = 'staged' AND profile_version_id = ${draftRow.value.versionId}`;
      await tx`UPDATE business_keyword_official_changes SET status = 'candidate', profile_version_id = NULL, updated_at = now()
        WHERE status = 'staged' AND profile_version_id = ${draftRow.value.versionId}`;
      await tx`UPDATE business_keyword_governance_drafts SET status = 'draft' WHERE profile_version_id = ${draftRow.value.versionId} AND status <> 'published'`;
    }
    await tx`INSERT INTO business_profile_versions (id, content_hash, profile, status, created_by)
      VALUES (${versionId}, ${contentHash}, ${tx.json(profile as never)}, 'draft', ${actor})`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES ('business_profile.draft', ${tx.json({ versionId, revision })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await tx`INSERT INTO business_keyword_governance_drafts
      (profile_version_id, name, base_profile_version_id, term_ids, context_id, created_by, official_change_ids, preserved_profile_draft_pointer)
      VALUES (${versionId}, ${parsed.name}, ${currentVersion || null}, ${terms.map((term: any) => Number(term.id))}, ${parsed.contextId ?? null}, ${actor}, ${selectedChangeIds}, ${preservedProfileDraft ? tx.json(preservedProfileDraft as never) : null})`;
    await tx`UPDATE business_keyword_terms SET status = 'staged', profile_version_id = ${versionId}, updated_at = now()
      WHERE id = ANY(${groupIds})`;
    await tx`UPDATE business_keyword_terms SET context_id = ${parsed.contextId ?? null}
      WHERE id = ANY(${groupIds})`;
    await tx`UPDATE business_keyword_candidates SET status = 'staged', profile_version_id = ${versionId}
      WHERE term_id = ANY(${groupIds})`;
    await tx`UPDATE business_keyword_official_changes SET status = 'staged', profile_version_id = ${versionId}, updated_at = now()
      WHERE id = ANY(${selectedChangeIds})`;
    return { versionId, revision, contentHash };
  });
  await audit(actor, "business.keyword-draft.create", `business-profile:${versionId}`, `创建关键词治理草稿：${parsed.name}`, currentDraft, { ...result, termIds: parsed.termIds, contextId: parsed.contextId ?? null });
  return { ...result, name: parsed.name, contextId: parsed.contextId ?? null, termCount: terms.length, officialChangeCount: selectedChanges.length };
}

function evaluateProfile(profile: BusinessProfile, text: string, capabilityIds: string[]) {
  const allowed = new Set(capabilityIds);
  const capabilities = profile.capabilities.filter((capability) => !allowed.size || allowed.has(capability.id));
  const positive = capabilities.flatMap((capability) => [...capability.serviceTerms, ...capability.methodTerms, ...capability.deliverableTerms].filter((term) => contains(text, term)));
  const negative = capabilities.flatMap((capability) => capability.negativeKeywords.filter((term) => contains(text, term)));
  return { positive: [...new Set(positive)], negative: [...new Set(negative)] };
}

export async function replayBusinessKeywordDraft(actor: string) {
  const state = await businessProfile();
  const profileVersionId = state.draft?.versionId;
  const revision = state.draft?.revision ?? 0;
  const current = state.currentProfile?.profile;
  const draft = state.draftProfile?.profile;
  if (!profileVersionId || !current || !draft) throw new Error("正式词库或草稿暂不可用");
  const [meta] = await sql<GovernanceDraft[]>`SELECT * FROM business_keyword_governance_drafts WHERE profile_version_id = ${profileVersionId}`;
  if (!meta) throw new Error("当前草稿不是关键词治理草稿");
  const feedback = await sql<any[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (fb.article_id) fb.article_id AS "articleId", fb.label, fb.capability_ids AS "capabilityIds",
             fb.created_at AS "reviewedAt", a.title, a.excerpt, a.body_text AS "bodyText"
        FROM business_matching_feedback fb JOIN articles a ON a.id = fb.article_id
       WHERE fb.label IN ('relevant', 'irrelevant')
       ORDER BY fb.article_id, fb.created_at DESC, fb.id DESC
    ) labeled ORDER BY "reviewedAt" DESC LIMIT 10000`;
  const relevant = feedback.filter((row) => row.label === "relevant");
  const irrelevant = feedback.filter((row) => row.label === "irrelevant");
  const evaluated = feedback.map((row) => {
    const text = `${row.title}\n${row.excerpt ?? ""}\n${row.bodyText ?? ""}`;
    const before = evaluateProfile(current, text, row.capabilityIds ?? []);
    const after = evaluateProfile(draft, text, row.capabilityIds ?? []);
    return { ...row, before, after };
  });
  const byLabel = (label: string) => evaluated.filter((row) => row.label === label);
  const rate = (rows: any[], predicate: (row: any) => boolean) => rows.length ? predicateCount(rows, predicate) / rows.length : null;
  const relatedRows = byLabel("relevant");
  const unrelatedRows = byLabel("irrelevant");
  const changed = evaluated.filter((row) => stableJson(row.before) !== stableJson(row.after));
  const metrics = {
    sampleCount: feedback.length,
    relatedCount: relevant.length,
    unrelatedCount: irrelevant.length,
    relatedPositiveHitBefore: rate(relatedRows, (row) => row.before.positive.length > 0),
    relatedPositiveHitAfter: rate(relatedRows, (row) => row.after.positive.length > 0),
    unrelatedNegativeHitBefore: rate(unrelatedRows, (row) => row.before.negative.length > 0),
    unrelatedNegativeHitAfter: rate(unrelatedRows, (row) => row.after.negative.length > 0),
    relatedNegativeConflictAfter: relatedRows.filter((row) => row.after.negative.length > 0).length,
    changedCount: changed.length,
    examples: changed.slice(0, 30).map((row) => ({ articleId: row.articleId, title: row.title, label: row.label, before: row.before, after: row.after })),
  };
  const [draftRow] = await sql<GovernanceDraft[]>`UPDATE business_keyword_governance_drafts SET replay_result = ${sql.json(metrics as never)}, replayed_at = now()
    WHERE profile_version_id = ${profileVersionId} RETURNING *`;
  await audit(actor, "business.keyword-draft.replay", `business-profile:${profileVersionId}`, "对历史人工判读样本执行关键词命中回放", null, { profileVersionId, revision, ...metrics });
  return { draft: draftRow, metrics };
}

function predicateCount(rows: any[], predicate: (row: any) => boolean) {
  return rows.filter(predicate).length;
}

export async function publishBusinessKeywordDraft(input: { expectedRevision: number; reason: string }, actor: string) {
  if (!input.reason.trim()) throw new Error("发布原因不能为空");
  const state = await businessProfile();
  const pointer = state.draft;
  if (!pointer || pointer.revision !== input.expectedRevision) throw new Error("关键词草稿已变化，请刷新后重试");
  const [metadata] = await sql<GovernanceDraft[]>`SELECT * FROM business_keyword_governance_drafts WHERE profile_version_id = ${pointer.versionId} FOR UPDATE`;
  if (!metadata || !metadata.replayed_at || !metadata.replay_result) throw new Error("请先完成历史样本回放，再发布正式词库");
  const currentId = state.current?.versionId ?? null;
  let rebasedDraft: { oldVersionId: string; versionId: string; revision: number; contentHash: string; profile: BusinessProfile } | null = null;
  if (metadata.preserved_profile_draft_pointer) {
    const [preserved] = await sql<{ id: string; status: string; profile: BusinessProfile }[]>`SELECT id, status, profile FROM business_profile_versions WHERE id = ${metadata.preserved_profile_draft_pointer.versionId}`;
    if (!preserved || preserved.status !== "draft") throw new Error("保留的业务配置草稿已变化，无法安全发布纠错");
    const changes = await sql<any[]>`SELECT kind, term, capability_id, role, action, replacement_term
      FROM business_keyword_official_changes WHERE id = ANY(${metadata.official_change_ids}) AND action IN ('deactivate', 'replace')`;
    const profile = applyOfficialKeywordChanges(preserved.profile, changes);
    rebasedDraft = {
      oldVersionId: preserved.id,
      versionId: id("bp-rebased"),
      revision: pointer.revision + 1,
      contentHash: sha256(stableJson(profile)),
      profile,
    };
  }
  await sql.begin(async (tx) => {
    const [fresh] = await tx<{ value: { versionId: string; revision: number } }[]>`SELECT value FROM settings WHERE key = 'business_profile.draft' FOR UPDATE`;
    if (fresh?.value.versionId !== pointer.versionId || fresh?.value.revision !== input.expectedRevision) throw new Error("关键词草稿已变化，请刷新后重试");
    if (currentId && currentId !== pointer.versionId) await tx`UPDATE business_profile_versions SET status = 'superseded' WHERE id = ${currentId}`;
    await tx`UPDATE business_profile_versions SET status = 'published', published_at = coalesce(published_at, now()) WHERE id = ${pointer.versionId}`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES ('business_profile.current', ${tx.json({ versionId: pointer.versionId, revision: pointer.revision })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await tx`UPDATE business_keyword_terms SET status = 'candidate', profile_version_id = NULL, updated_at = now() WHERE status = 'published'`;
    await tx`UPDATE business_keyword_terms SET status = 'published', updated_at = now()
      WHERE status = 'staged' AND profile_version_id = ${pointer.versionId}`;
    await tx`UPDATE business_keyword_candidates SET status = 'accepted', reviewed_by = ${actor}, reviewed_at = now()
      WHERE status = 'staged' AND profile_version_id = ${pointer.versionId}`;
    await tx`UPDATE business_keyword_official_changes SET status = 'published', updated_at = now()
      WHERE status = 'staged' AND profile_version_id = ${pointer.versionId}`;
    await tx`UPDATE business_keyword_governance_drafts SET status = 'published' WHERE profile_version_id = ${pointer.versionId}`;
    if (rebasedDraft) {
      const [preserved] = await tx<{ status: string }[]>`SELECT status FROM business_profile_versions WHERE id = ${rebasedDraft.oldVersionId} FOR UPDATE`;
      if (preserved?.status !== "draft") throw new Error("保留的业务配置草稿已变化，无法安全发布纠错");
      await tx`INSERT INTO business_profile_versions (id, content_hash, profile, status, created_by)
        VALUES (${rebasedDraft.versionId}, ${rebasedDraft.contentHash}, ${tx.json(rebasedDraft.profile as never)}, 'draft', ${actor})`;
      await tx`UPDATE business_keyword_terms SET profile_version_id = ${rebasedDraft.versionId}, updated_at = now()
        WHERE status = 'staged' AND profile_version_id = ${rebasedDraft.oldVersionId}`;
      await tx`UPDATE business_keyword_candidates SET profile_version_id = ${rebasedDraft.versionId}
        WHERE status = 'staged' AND profile_version_id = ${rebasedDraft.oldVersionId}`;
      await tx`UPDATE business_profile_versions SET status = 'superseded' WHERE id = ${rebasedDraft.oldVersionId}`;
      await tx`INSERT INTO settings (key, value, updated_by) VALUES ('business_profile.draft', ${tx.json({ versionId: rebasedDraft.versionId, revision: rebasedDraft.revision })}, ${actor})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    }
  });
  await audit(actor, "business.keyword-draft.publish", `business-profile:${pointer.versionId}`, input.reason, currentId, { versionId: pointer.versionId, revision: pointer.revision, replayedAt: metadata.replayed_at, preservedDraftVersionId: rebasedDraft?.versionId ?? null });
  if (rebasedDraft) await audit(actor, "business.profile.draft.rebase", `business-profile:${rebasedDraft.versionId}`, "将已发布的正式词纠错同步到保留的业务配置草稿", rebasedDraft.oldVersionId, { versionId: rebasedDraft.versionId, revision: rebasedDraft.revision, contentHash: rebasedDraft.contentHash });
  invalidateBusinessProfileCache();
  return { versionId: pointer.versionId, revision: pointer.revision, published: true, preservedDraftVersionId: rebasedDraft?.versionId ?? null };
}

export async function keywordGovernanceDraft() {
  const profile = await businessProfile();
  const draftVersionId = profile.draft?.versionId;
  const [metadata] = draftVersionId ? await sql<GovernanceDraft[]>`SELECT * FROM business_keyword_governance_drafts WHERE profile_version_id = ${draftVersionId}` : [];
  const officialChanges = metadata?.official_change_ids?.length
    ? await sql<any[]>`SELECT id, kind, term, capability_id AS "capabilityId", action, replacement_term AS "replacementTerm"
        FROM business_keyword_official_changes WHERE id = ANY(${metadata.official_change_ids}) ORDER BY id`
    : [];
  return { ...profile, governanceDraft: metadata ?? null, officialChanges, jsonPreview: profile.draftProfile?.profile ? toAihotBusinessJson(profile.draftProfile.profile, draftVersionId ?? profile.draftProfile.id) : null };
}

export async function keywordGovernanceLibrary() {
  const profile = await businessProfile();
  const currentVersionId = profile.current?.versionId ?? profile.currentProfile?.id ?? "seed-local";
  const [counts] = await sql<Record<string, number>[]>`
    SELECT count(*) FILTER (WHERE t.kind = 'positive')::int AS "positiveCount",
           count(*) FILTER (WHERE t.kind = 'negative')::int AS "negativeCount"
      FROM business_keyword_terms t WHERE t.status = 'published'`;
  const currentJson = profile.currentProfile?.profile ? toAihotBusinessJson(profile.currentProfile.profile, currentVersionId) : BUSINESS_PROFILE;
  const versions = profile.history.map((version) => ({ ...version, aihotJson: toAihotBusinessJson(version.profile, version.id) }));
  return { ...profile, currentJson, versions, counts };
}

export async function rollbackBusinessKeywordLibrary(versionId: string, reason: string, actor: string) {
  const result = await rollbackBusinessProfile(versionId, reason, actor);
  if (!result) return null;
  const state = await businessProfile();
  const profile = state.currentProfile?.profile;
  if (!profile) return result;
  const active = profile.capabilities.flatMap((capability) => [
    ...capability.serviceTerms.map((term) => ({ kind: "positive", term, capabilityId: capability.id })),
    ...capability.methodTerms.map((term) => ({ kind: "positive", term, capabilityId: capability.id })),
    ...capability.deliverableTerms.map((term) => ({ kind: "positive", term, capabilityId: capability.id })),
    ...capability.negativeKeywords.map((term) => ({ kind: "negative", term, capabilityId: capability.id })),
  ]);
  await sql.begin(async (tx) => {
    await tx`UPDATE business_keyword_terms SET status = 'candidate', profile_version_id = NULL, updated_at = now() WHERE status = 'published'`;
    for (const item of active) await tx`UPDATE business_keyword_terms SET status = 'published', profile_version_id = ${versionId}, updated_at = now()
      WHERE kind = ${item.kind} AND capability_id = ${item.capabilityId} AND normalized_term = ${normalizeKeywordTerm(item.term)}`;
  });
  return result;
}

export const keywordGovernanceHelpers = { collectSuggestions, evaluateProfile, appendCandidateTerms, applyOfficialKeywordChanges, toAihotBusinessJson, groupKeywordRows };
