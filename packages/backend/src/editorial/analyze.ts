// analyzeArticle: the judging and writing steps, each with its own prompt from the industry pack
// (industry/prompts/):
//   1. prefilter: one AI output determines task relevance, business and region scores, and deadline status;
//      expired material is discarded before writing or publication;
//   2. writing: the Chinese title, summary and reason by the content understanding for selected and
//      near-selected items, by the cheaper title/summary prompts for the rest;
//   3. structure (no reader-facing text): category, tags, subject companies and the fact frame the
//      topics and event grouping need; it runs beside writing.
// Material with only a title or a feed summary has its article page fetched before it is judged.
import { z } from "zod";
import { CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { CATEGORIES, isAwardResultTitle } from "@aihot/industry/taxonomy";
import { SELECTION } from "@aihot/industry/selection";
import { sql, type Tx } from "../db.ts";
import { chatJson, MODELS, type ContentPart } from "../providers/llm.ts";
import { completeReceipt, ProviderRejectedError } from "../providers/receipts.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { modelFor } from "./models.ts";
import { articleText } from "../content/quality.ts";
import { buildMaterial, firstImagePart, loadAnalyzeInput, type AnalyzeInputArticle } from "./input.ts";
import { pageFetchable } from "../content/extract.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import {
  buildArticlePrompt, buildLongTweetPrompt, buildShortTweetPrompt, finalizeCopy, isShortTweetInput, looksZh, MAX_BODY_CHARS, missingEvidence,
  needsShortTweetTranslation, parseTranslateOutput, PREFILTER_SYSTEM, prefilterSystem, prefilterUser, translateInputOf, UNDERSTAND_SYSTEM, understandSystem, understandUser,
  type IdentityGuard,
} from "./writing.ts";
import { CATEGORY_BY_ITEM_TYPE, CATEGORY_GUIDE, CATEGORY_TAGS, ENTITIES, ENTITY_TAGS, ITEM_TYPES, normalizeTags, TOPIC_TAGS } from "./vocabulary.ts";
import { businessCalibrationExamples, businessProfileVersion, loadBusinessProfile, loadBusinessProfileVersion, type BusinessCalibrationExample, type BusinessProfile } from "./business.ts";
import { businessPromptValues, promptText, promptVersion } from "./prompts.ts";
import { DEFAULT_SCORING_POLICY, loadScoringPolicy, weightedScore, type ScoringPolicy, type ScoringWeights } from "./scoring-policy.ts";
import { businessSelectionPolicyVersion, DEFAULT_BUSINESS_SELECTION_POLICY, deadlinePoints, loadBusinessSelectionPolicy, resolveBusinessJudgement, weightedOpportunityScore, type BusinessSelectionPolicy } from "./business-selection-policy.ts";

export { buildMaterial, loadAnalyzeInput, type AnalyzeInputArticle };

export const PROMPT_VERSIONS = {
  prefilter: `${promptVersion("prefilter")}+business@${businessProfileVersion()}`,
  score: `${promptVersion("selection-score")}+business@${businessProfileVersion()}`,
  understand: `${promptVersion("understand")}+business@${businessProfileVersion()}`,
  summarize: promptVersion("summarize-article", "summarize-article-empty", "summarize-short-post", "summarize-short-post-quoted", "summarize-long-post", "summarize-long-post-quoted", "identity-context"),
  structure: `${promptVersion("structure")}+business@${businessProfileVersion()}`,
} as const;
/** Every step's prompt, as stored on each judgement. */
export const ANALYZE_PROMPT_VERSION = Object.values(PROMPT_VERSIONS).join("+");

// ── Scoring ───────────────────────────────────────────────────────────────────────────────

/** Independent score calls per article; their sum decides, their mean (floored) is shown. */
export const SCORE_CALLS = 2;

/**
 * The thresholds on the mean score, per source tier (industry/selection.ts): selected when
 * score1 + score2 >= 2 × threshold. Tiers without a threshold are not scored for 精选.
 */
export function tierThreshold(tier: string): number | null {
  return SELECTION.thresholds[tier] ?? null;
}

/** Unselected items above this mean are written like selected ones. */
export const UNDERSTAND_FLOOR = SELECTION.understandFloor;

/**
 * Call parameters per score model. The GLM scorer runs at temperature 1 with high reasoning (the model
 * registry adds top_p and thinking) and up to 180 s per call.
 */
const SCORE_CALL: Record<string, { temperature: number; maxTokens: number; timeoutMs: number }> = {
  "glm-5.3-flash-selection": { temperature: 1, maxTokens: 65_536, timeoutMs: 180_000 },
};
const scoreCall = (model: string) => SCORE_CALL[model] ?? { temperature: 0.2, maxTokens: 1024, timeoutMs: 120_000 };

/** The score prompt: the industry's taste (industry/prompts/selection-score.md). */
const scorePolicyPromptValues = (policy: ScoringPolicy) => ({
  scoreWeights: `业务匹配 ${policy.weights.fit}%、地域匹配 ${policy.weights.region}%、开标时效 ${policy.weights.deadline}%`,
  dueSoonDays: String(policy.dueSoonDays),
});
export const SCORE_SYSTEM = promptText("selection-score", { ...businessPromptValues(), ...scorePolicyPromptValues(DEFAULT_SCORING_POLICY) });
const scoreSystem = (profile: BusinessProfile | undefined, policy: ScoringPolicy) => promptText("selection-score", { ...businessPromptValues(profile), ...scorePolicyPromptValues(policy) });

const ScoreAxisSchema = z.object({
  score: z.coerce.number().int().min(0).max(10),
  reason: z.string().trim().min(1).max(160),
});
const ScoreDimensionsSchema = z.object({
  fit: ScoreAxisSchema,
  region: ScoreAxisSchema,
  deadline: ScoreAxisSchema,
});
export const ScoreSchema = z.object({
  dimensions: ScoreDimensionsSchema,
  deadlineStatus: z.enum(["open", "due_soon", "passed", "unknown"]).default("unknown"),
});

const SCORE_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** The score input's time: Beijing time, ISO 8601 with +08:00 (the form the prompt was tuned on). */
export function scoreInputTime(at: Date): string {
  const ms = at.getTime() % 1000;
  return `${SCORE_TIME.format(at).replace(" ", "T")}${ms ? `.${String(ms).padStart(3, "0")}` : ""}+08:00`;
}

function scoreEvaluationDate(at: Date): string {
  return SCORE_TIME.format(at).slice(0, 10);
}

/**
 * The score input: no source facts (the prompt forbids guessing them), the publication time, the
 * original title (items are scored before any Chinese copy exists) and the whole body.
 */
export function buildScoreInput(a: AnalyzeInputArticle, dueSoonDays = DEFAULT_SCORING_POLICY.dueSoonDays): string {
  let body: string;
  if (a.xPost) {
    const quoted = a.xPost.quoted?.text ? `\n\n[引用 ${a.xPost.quoted.handle ? `@${a.xPost.quoted.handle}` : "原推文"}]：${a.xPost.quoted.text}` : "";
    body = `${String(a.xPost.text ?? "").trim()}${quoted}`.trim();
  } else {
    body = articleText(a.bodyText, a.excerpt) ?? "";
  }
  if (!body) body = a.title;
  const at = a.publishedAt ?? a.discoveredAt ?? null;
  return [
    `请按系统规则评估以下单篇材料。当前评估日期（北京时间）为 ${scoreEvaluationDate(new Date())}；${dueSoonDays} 天内开标视为低优先级。输出三项分数、开标状态及各自依据，不要补充材料没有提供的事实。`,
    `【发布时间（北京时间）】\n${at ? scoreInputTime(at) : ""}`,
    `【标题】\n${a.title.trim()}`,
    `【完整正文】\n${body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body}`,
  ].join("\n\n");
}

// ── Step outputs ──────────────────────────────────────────────────────────────────────────

const EvidenceSchema = z.object({
  id: z.string().min(1).max(80),
  quote: z.string().min(1).max(1200),
  source: z.enum(["title", "body", "excerpt", "attachment"]).catch("body"),
  location: z.string().max(160).nullable().optional().catch(null),
  strength: z.enum(["explicit", "limited", "insufficient"]).catch("limited"),
  verified: z.boolean().default(false),
});

const CoverageSchema = z.object({
  status: z.enum(["complete", "partial", "missing", "unknown"]).catch("unknown"),
  sectionsRead: z.array(z.string().max(120)).max(30).catch([]),
  missing: z.array(z.string().max(160)).max(20).catch([]),
  notes: z.string().max(500).catch(""),
});

const TaskMatchSchema = z.object({
  capabilityId: z.string().max(100),
  relation: z.enum(["direct", "partial", "adjacent", "none"]).catch("adjacent"),
  rationale: z.string().max(400).catch(""),
  evidenceIds: z.array(z.string().max(80)).max(12).catch([]),
});

const TaskSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(240).catch(""),
  lot: z.string().max(160).nullable().optional().catch(null),
  action: z.string().max(160).catch(""),
  object: z.string().max(240).catch(""),
  methods: z.array(z.string().max(120)).max(20).catch([]),
  deliverables: z.array(z.string().max(160)).max(20).catch([]),
  purchaseRole: z.enum(["principal", "component", "reference", "unknown"]).catch("unknown"),
  participation: z.enum(["standalone", "lot", "component", "incidental", "unknown"]).catch("unknown"),
  matches: z.array(TaskMatchSchema).max(12).catch([]),
  evidenceIds: z.array(z.string().max(80)).max(12).catch([]),
});

const ProjectSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(240).catch(""),
  number: z.string().max(120).nullable().optional().catch(null),
  lots: z.array(z.string().max(160)).max(20).catch([]),
  tasks: z.array(TaskSchema).max(50).catch([]),
  evidenceIds: z.array(z.string().max(80)).max(20).catch([]),
});

const OrganizationSchema = z.object({
  name: z.string().max(160),
  role: z.enum(["purchaser", "tenderer", "agent", "supplier", "other"]).catch("other"),
  evidenceIds: z.array(z.string().max(80)).max(8).catch([]),
});

const QualificationRequirementSchema = z.object({
  kind: z.enum(["company", "personnel"]),
  requirement: z.string().trim().min(1).max(160),
  evidenceIds: z.array(z.string().max(80)).max(8).catch([]),
});

const BusinessContractSchema = z.object({
  materialCoverage: CoverageSchema.catch({ status: "unknown", sectionsRead: [], missing: [], notes: "" }),
  projects: z.array(ProjectSchema).max(20).catch([]),
  contexts: z.array(z.string().max(80)).max(20).catch([]),
  organizations: z.array(OrganizationSchema).max(20).catch([]),
  qualificationRequirements: z.array(QualificationRequirementSchema).max(40).catch([]),
  evidence: z.array(EvidenceSchema).max(80).catch([]),
  missingInformation: z.array(z.string().max(200)).max(20).catch([]),
});

const BusinessScoreAxisSchema = z.object({
  score: z.coerce.number().int().min(0).max(100),
  reason: z.string().trim().min(1).max(240),
});
const BusinessScoreSchema = z.object({
  taskFit: BusinessScoreAxisSchema,
  delivery: BusinessScoreAxisSchema,
  importance: BusinessScoreAxisSchema,
});

const PrefilterSchema = BusinessContractSchema.extend({
  label: z.preprocess((v) => String(v ?? "").trim().toUpperCase(), z.enum(["PASS", "BLOCK", "UNKNOWN"])),
  reason: z.string().max(200).catch(""),
  businessScore: BusinessScoreSchema,
  regionScore: z.object({ score: z.coerce.number().int().min(0).max(100), reason: z.string().trim().min(1).max(200) }),
  deadlineStatus: z.enum(["open", "due_soon", "passed", "unknown"]),
});

type BusinessContract = z.infer<typeof BusinessContractSchema>;

const FactSchema = z
  .object({
    title: z.string().max(80),
    subject: z.string().max(80).nullable().optional(),
    action: z.string().max(80).nullable().optional(),
    object: z.string().max(160).nullable().optional(),
    occurredAt: z.string().nullable().optional(),
  })
  .nullable()
  .catch(null);

const StructureSchema = z.object({
  category: z.enum(CATEGORY_KEYS).nullable().catch(null),
  tags: z.array(z.string()).max(12).catch([]),
  subjects: z.array(z.string()).max(6).catch([]),
  fact: FactSchema,
});

const UnderstandSchema = z.object({
  itemType: z.enum(ITEM_TYPES),
  authorRole: z.enum(["principal", "observer", "relayer"]).catch("relayer"),
  tags: z.array(z.string()).max(12).catch([]),
  editorialJudgment: z.string().max(400).catch(""),
  titleZh: z.string().trim().min(1).max(200),
  summaryZh: z.string().trim().min(1).max(4000),
});

const SummarizeSchema = z.object({ titleZh: z.string(), summaryZh: z.string(), bodyZh: z.string() });

const ZH_COUNT = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** The structure step's prompt (it writes nothing a reader sees), filled from the pack's vocabulary. */
const structureSystem = (profile?: BusinessProfile) => promptText("structure", {
  ...businessPromptValues(profile),
  categoryCount: ZH_COUNT[CATEGORIES.length] ?? String(CATEGORIES.length),
  categoryGuide: CATEGORY_GUIDE,
  categoryTags: CATEGORY_TAGS.join("、"),
  topicTags: TOPIC_TAGS.join("、"),
  entityTags: ENTITY_TAGS.join("、"),
  entities: Object.entries(ENTITIES).map(([id, e]) => `${id}（${e.aliases.slice(0, 3).join("/")}）`).join("，"),
});

export interface AnalysisRun {
  prefilter: BusinessContract & { label: "PASS" | "BLOCK" | "UNKNOWN"; reason: string; businessScore: { dimensions: z.infer<typeof BusinessScoreSchema>; total: number }; regionScore: { score: number; reason: string }; scoreBreakdown: { business: number; region: number; deadline: number; weights: BusinessSelectionPolicy["weights"]; total: number }; deadlineStatus: "open" | "due_soon" | "passed" | "unknown"; selectionPolicy: BusinessSelectionPolicy; selectionPolicyVersion: string; model: string; receiptId: number; reused: boolean; profileVersion: string; calibrationExamples: BusinessCalibrationExample[] };
  /**
   * The independent score calls and the tier threshold they are held against; absent when the material
   * is not scored. `refused`: the model's content filter declined it, so it is not selected.
   */
  scores: { model: string; threshold: number; values: number[]; dimensions: z.infer<typeof ScoreDimensionsSchema>[]; deadlineStatuses: Array<z.infer<typeof ScoreSchema>["deadlineStatus"]>; weights: ScoringWeights; dueSoonDays: number; receiptIds: number[]; reused: boolean; refused?: boolean } | null;
  /** The reader-facing copy: `understand` (selected, near-selected), `summarize`, `verbatim` (a Chinese short post), `none`. */
  writing: {
    kind: "understand" | "summarize" | "verbatim" | "none";
    model: string | null;
    titleZh: string;
    summaryZh: string;
    reasonZh: string | null;
    tags: string[] | null;
    itemType?: string;
    authorRole?: string;
    identityGuard?: IdentityGuard;
    receiptIds: number[];
    reused: boolean;
  } | null;
  structure: { model: string; category: string | null; tags: string[]; subjects: string[]; fact: z.infer<typeof FactSchema>; receiptId: number; reused: boolean } | null;
}

const isContentFilter = (error: unknown) => error instanceof ProviderRejectedError && !error.retryable && /contentFilter|"1301"/.test(error.message);

/** Only a title or a feed summary, and a page to fetch: the article is judged on the page. */
export function waitsForPage(a: AnalyzeInputArticle): boolean {
  return a.bodyStatus === "pending" && !a.bodyText && !a.xPost && pageFetchable(a.url, a.source.kind);
}

type StepOpts = { attemptTag?: string; scoreModel?: string; businessProfile?: BusinessProfile; calibrationExamples?: BusinessCalibrationExample[]; selectionPolicy?: BusinessSelectionPolicy };
export class AnalysisInterruptedError extends Error {}

function checkAnalysisRunning() {
  if (shutdownSignal.signal.aborted) throw new AnalysisInterruptedError("worker shutting down between analysis stages");
}

const subjectOf = (a: AnalyzeInputArticle) => `article:${a.id}@${a.revision}`;
const tagged = (attemptTag: string | undefined, step: string) => [attemptTag, step].filter(Boolean).join(":") || undefined;

function evidenceMaterial(a: AnalyzeInputArticle): Array<{ source: "title" | "body" | "excerpt"; text: string }> {
  const material: Array<{ source: "title" | "body" | "excerpt"; text: string }> = [{ source: "title", text: a.title }];
  if (a.bodyText?.trim()) material.push({ source: "body", text: a.bodyText });
  if (a.excerpt?.trim()) material.push({ source: "excerpt", text: a.excerpt });
  if (a.xPost?.text?.trim()) material.push({ source: "body", text: String(a.xPost.text) });
  return material;
}

function quoteMatches(text: string, quote: string): boolean {
  const parts = collapseWhitespace(quote).toLocaleLowerCase().split(/\.{2,}|…+/u).map(collapseWhitespace).filter(Boolean);
  if (!parts.length || parts.some((part) => [...part].length < 4)) return false;
  let offset = 0;
  for (const part of parts) {
    const index = text.indexOf(part, offset);
    if (index < 0) return false;
    offset = index + part.length;
  }
  return true;
}

function verifyEvidence(a: AnalyzeInputArticle, evidence: BusinessContract["evidence"]): BusinessContract["evidence"] {
  const material = evidenceMaterial(a).map((m) => ({ ...m, normalized: collapseWhitespace(m.text).toLocaleLowerCase() }));
  return evidence.map((item) => {
    const quote = collapseWhitespace(item.quote).toLocaleLowerCase();
    const match = material.find((m) => quoteMatches(m.normalized, quote));
    const verified = !!match;
    const source = match?.source ?? item.source;
    return { ...item, source, verified };
  });
}

async function runPrefilter(a: AnalyzeInputArticle, opts: StepOpts): Promise<AnalysisRun["prefilter"]> {
  const model = await modelFor("prefilter");
  const profile = opts.businessProfile;
  const selectionPolicy = opts.selectionPolicy ?? await loadBusinessSelectionPolicy();
  const selectionPolicyVersion = businessSelectionPolicyVersion(selectionPolicy);
  checkAnalysisRunning();
  const res = await chatJson({
    model,
    purpose: "prefilter_article",
    subject: subjectOf(a),
    promptVersion: `${promptVersion("prefilter")}+business@${businessProfileVersion(profile)}+${selectionPolicyVersion}`,
    system: prefilterSystem(profile, selectionPolicy),
    user: prefilterUser(a, profile, opts.calibrationExamples),
    schema: PrefilterSchema,
    temperature: 0,
    maxTokens: 8_192,
    attemptTag: opts.attemptTag,
  });
  // A BLOCK without material to back it counts as UNKNOWN so the item can be retried with the body.
  const evidence = verifyEvidence(a, res.data.evidence);
  const verifiedIds = new Set(evidence.filter((e) => e.verified).map((e) => e.id));
  const qualificationRequirements = res.data.qualificationRequirements
    .map((item) => ({ ...item, evidenceIds: item.evidenceIds.filter((id) => verifiedIds.has(id)) }))
    .filter((item) => item.evidenceIds.length > 0);
  const capabilityIds = new Set((profile?.capabilities ?? []).filter((c) => c.enabled).map((c) => c.id));
  const hasMatchedTask = res.data.projects.some((p) => p.tasks.some((task) => task.matches.some((match) =>
    (match.relation === "direct" || match.relation === "partial") && capabilityIds.has(match.capabilityId) && match.evidenceIds.some((id) => verifiedIds.has(id)))));
  const passed = res.data.deadlineStatus === "passed";
  if (!passed) {
    for (const key of ["taskFit", "delivery", "importance"] as const) {
      if (res.data.businessScore[key].score > selectionPolicy.dimensions[key].max) throw new Error(`业务评分 ${key} 超过当前配置上限`);
    }
    if (res.data.regionScore.score > selectionPolicy.weights.region) throw new Error("地域评分超过当前配置上限");
  }
  const businessDimensions = passed
    ? Object.fromEntries((Object.keys(selectionPolicy.dimensions) as Array<keyof BusinessSelectionPolicy["dimensions"]>).map((key) => [key, { score: 0, reason: "投标截止或开标时间已过，未进行业务评分。" }])) as z.infer<typeof BusinessScoreSchema>
    : res.data.businessScore;
  const businessScore = {
    dimensions: businessDimensions,
    total: businessDimensions.taskFit.score + businessDimensions.delivery.score + businessDimensions.importance.score,
  };
  const regionScore = passed ? { score: 0, reason: "投标截止或开标时间已过，未进行地域评分。" } : res.data.regionScore;
  const deadlineScore = deadlinePoints(res.data.deadlineStatus, selectionPolicy);
  const totalScore = weightedOpportunityScore({ business: businessScore.total, region: regionScore.score, deadlineStatus: res.data.deadlineStatus, policy: selectionPolicy });
  const scoreBreakdown = { business: businessScore.total, region: regionScore.score, deadline: deadlineScore, weights: selectionPolicy.weights, total: totalScore };
  const label = resolveBusinessJudgement({
    modelLabel: res.data.label,
    deadlineStatus: res.data.deadlineStatus,
    score: totalScore,
    reviewFloor: selectionPolicy.reviewFloor,
    hasMatchedTask,
    hasMaterial: !missingEvidence(a),
  });
  const reason = res.data.deadlineStatus === "passed" ? "投标截止或开标时间已过，已从当前机会中剔除。" : res.data.reason;
  if (label === "BLOCK") await sql.begin((tx) => discardReceiptContent(tx, res.receiptId));
  return {
    ...res.data,
    qualificationRequirements,
    label,
    reason,
    evidence,
    businessScore,
    regionScore,
    scoreBreakdown,
    selectionPolicy,
    selectionPolicyVersion,
    model: res.model,
    receiptId: res.receiptId,
    reused: res.reused,
    profileVersion: businessProfileVersion(profile),
    calibrationExamples: opts.calibrationExamples ?? [],
  };
}

async function discardReceiptContent(tx: Tx, receiptId: number): Promise<void> {
  await tx`UPDATE receipts SET logical_key = 'discarded:' || id::text, subject = NULL, status = 'completed',
    request = NULL, response = NULL, error = NULL, completed_at = coalesce(completed_at, now()), updated_at = now()
    WHERE id = ${receiptId}`;
  await tx`UPDATE receipt_attempts SET error = NULL WHERE receipt_id = ${receiptId}`;
}

async function discardArticleReceipts(tx: Tx, articleId: string): Promise<void> {
  const subject = `article:${articleId}`;
  const rows = await tx<{ id: number }[]>`UPDATE receipts SET logical_key = 'discarded:' || id::text, subject = NULL,
    request = NULL, response = NULL, error = NULL, updated_at = now()
    WHERE subject = ${subject} OR subject LIKE ${`${subject}@%`} OR subject LIKE ${`${subject}:%`}
    RETURNING id`;
  for (const row of rows) await tx`UPDATE receipt_attempts SET error = NULL WHERE receipt_id = ${row.id}`;
}

async function discardArticleTx(tx: Tx, articleId: string): Promise<void> {
  await discardArticleReceipts(tx, articleId);
  await tx`DELETE FROM business_matching_feedback WHERE article_id = ${articleId}`;
  await tx`DELETE FROM audit_log WHERE subject = ${`business-case:${articleId}`}
    OR before::text LIKE ${`%${articleId}%`} OR after::text LIKE ${`%${articleId}%`}`;
  await tx`DELETE FROM articles WHERE id = ${articleId}`;
}

/** Discards material rejected by a deterministic gate without creating an AI receipt or analysis. */
export async function discardArticleWithoutAnalysis(articleId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [current] = await tx<{ id: string }[]>`SELECT id FROM articles WHERE id = ${articleId} FOR UPDATE`;
    if (current) await discardArticleTx(tx, articleId);
  });
}

async function runScores(a: AnalyzeInputArticle, threshold: number, opts: StepOpts): Promise<NonNullable<AnalysisRun["scores"]>> {
  const model = opts.scoreModel ?? (await modelFor("score"));
  const profile = opts.businessProfile;
  const policy = await loadScoringPolicy();
  const call = scoreCall(model);
  const input = buildScoreInput(a, policy.dueSoonDays);
  const values: number[] = [];
  const dimensions: z.infer<typeof ScoreDimensionsSchema>[] = [];
  const deadlineStatuses: Array<z.infer<typeof ScoreSchema>["deadlineStatus"]> = [];
  const receiptIds: number[] = [];
  let reused = true;
  // One after the other: the second call reuses the provider's cached prompt.
  for (let i = 0; i < SCORE_CALLS; i++) {
    checkAnalysisRunning();
    try {
      const res = await chatJson({
        model, purpose: "score_article", subject: subjectOf(a), promptVersion: `${promptVersion("selection-score")}+business@${businessProfileVersion(profile)}+policy@${policy.weights.fit}-${policy.weights.region}-${policy.weights.deadline}-due${policy.dueSoonDays}`, system: scoreSystem(profile, policy), user: input,
        schema: ScoreSchema, temperature: call.temperature, maxTokens: call.maxTokens, timeoutMs: call.timeoutMs,
        // Each call is its own paid request; an explicit re-evaluation gets new ones.
        attemptTag: tagged(opts.attemptTag, `score-${i + 1}`),
      });
      values.push(weightedScore({ fit: res.data.dimensions.fit.score, region: res.data.dimensions.region.score, deadline: res.data.dimensions.deadline.score }, policy.weights));
      dimensions.push(res.data.dimensions);
      deadlineStatuses.push(res.data.deadlineStatus);
      receiptIds.push(res.receiptId);
      reused &&= res.reused;
    } catch (error) {
      // The model's content filter declines the material (Zhipu 1301): not scored, so not selected.
      if (isContentFilter(error)) return { model, threshold, values, dimensions, deadlineStatuses, weights: policy.weights, dueSoonDays: policy.dueSoonDays, receiptIds, reused: false, refused: true };
      throw error;
    }
  }
  return { model, threshold, values, dimensions, deadlineStatuses, weights: policy.weights, dueSoonDays: policy.dueSoonDays, receiptIds, reused };
}

async function runStructure(a: AnalyzeInputArticle, opts: StepOpts): Promise<NonNullable<AnalysisRun["structure"]>> {
  const model = await modelFor("structure");
  const profile = opts.businessProfile;
  checkAnalysisRunning();
  const res = await chatJson({
    model,
    purpose: "structure_article",
    subject: subjectOf(a),
    promptVersion: `${promptVersion("structure")}+business@${businessProfileVersion(profile)}`,
    system: structureSystem(profile),
    user: buildMaterial(a),
    schema: StructureSchema,
    temperature: 0.2,
    maxTokens: 800,
    attemptTag: tagged(opts.attemptTag, "structure"),
  });
  const subjects = [...new Set(res.data.subjects.map((s) => s.trim().toLowerCase()).filter((s) => s in ENTITIES))];
  return { model: res.model, category: res.data.category, tags: normalizeTags(res.data.tags), subjects, fact: res.data.fact, receiptId: res.receiptId, reused: res.reused };
}

/** The content understanding; null when the model's content filter declines the material. */
async function runUnderstand(a: AnalyzeInputArticle, opts: StepOpts): Promise<AnalysisRun["writing"]> {
  const model = await modelFor("understand");
  const profile = opts.businessProfile;
  const text = understandUser(a, profile);
  const call = (image: ContentPart | null) => {
    checkAnalysisRunning();
    return chatJson({
      model, purpose: "understand_article", subject: subjectOf(a), promptVersion: `${promptVersion("understand")}+business@${businessProfileVersion(profile)}`, system: understandSystem(profile),
      user: image ? [{ type: "text", text }, image] : text, schema: UnderstandSchema, temperature: 0.2, maxTokens: 16_384,
      timeoutMs: 180_000, attemptTag: tagged(opts.attemptTag, "understand"),
    });
  };
  // A model that is known not to read images gets the text only.
  const image = MODELS[model]?.vision === false ? null : await firstImagePart(a);
  let res: Awaited<ReturnType<typeof call>>;
  try {
    res = await call(image);
  } catch (error) {
    if (isContentFilter(error)) return null;
    // The model refused the image (download, format): the text is written without it.
    if (!image || !(error instanceof ProviderRejectedError) || error.retryable) throw error;
    try {
      res = await call(null);
    } catch (retryError) {
      if (isContentFilter(retryError)) return null;
      throw retryError;
    }
  }
  const d = res.data;
  const copy = finalizeCopy(translateInputOf(a), { titleZh: d.titleZh, summaryZh: d.summaryZh });
  const itemType = isAwardResultTitle(a.title) ? "award_result" : d.itemType;
  return {
    kind: "understand", model: res.model, titleZh: copy.titleZh, summaryZh: copy.summaryZh, reasonZh: d.editorialJudgment.trim() || null,
    tags: normalizeTags(d.tags, { fallbackCategory: CATEGORY_BY_ITEM_TYPE[itemType] }), itemType, authorRole: d.authorRole,
    identityGuard: copy.identityGuard, receiptIds: [res.receiptId], reused: res.reused,
  };
}

/** The title/summary prompts (articles, long and short posts). */
async function runSummarize(a: AnalyzeInputArticle, opts: StepOpts): Promise<NonNullable<AnalysisRun["writing"]>> {
  const t = translateInputOf(a);
  const isX = t.sourceKind === "x_search";
  const short = isShortTweetInput(t);
  const main = collapseWhitespace(t.mainText || t.title);
  const plain = { reasonZh: null, tags: null, receiptIds: [] as number[], reused: true };
  // A short post already in Chinese is its own copy, and too little text is not written up from a title.
  if (short && !needsShortTweetTranslation(main)) return { kind: "verbatim", model: null, titleZh: main, summaryZh: main, ...plain };
  if (!short && t.text.trim().length < 20) return { kind: "none", model: null, titleZh: looksZh(t.title) ? t.title : "", summaryZh: "", ...plain };
  const model = await modelFor("summarize");
  checkAnalysisRunning();
  const res = await chatJson({
    model,
    purpose: "summarize_article",
    subject: subjectOf(a),
    promptVersion: PROMPT_VERSIONS.summarize,
    system: "",
    user: short ? buildShortTweetPrompt(t) : isX ? buildLongTweetPrompt(t) : buildArticlePrompt(t),
    schema: SummarizeSchema,
    json: false,
    parse: parseTranslateOutput,
    temperature: 0.2,
    maxTokens: 2048,
    attemptTag: tagged(opts.attemptTag, "summarize"),
  });
  const p = res.data;
  const draft = short
    ? { titleZh: p.titleZh || (looksZh(main) ? main : ""), summaryZh: p.bodyZh || p.summaryZh }
    : isX
      ? { titleZh: p.titleZh, summaryZh: p.summaryZh || p.bodyZh }
      : { titleZh: p.titleZh || (looksZh(t.title) ? t.title : ""), summaryZh: p.summaryZh };
  const copy = finalizeCopy(t, draft);
  return { kind: "summarize", model: res.model, titleZh: copy.titleZh, summaryZh: copy.summaryZh, reasonZh: null, tags: null, identityGuard: copy.identityGuard, receiptIds: [res.receiptId], reused: res.reused };
}

/**
 * Runs the steps on the material as it is (or reuses their receipts) without writing business results.
 * `stages: "selection"` stops after the scores (SelectBench).
 */
export async function runAnalysis(a: AnalyzeInputArticle, opts: StepOpts & { stages?: "selection" | "all" } = {}): Promise<AnalysisRun> {
  checkAnalysisRunning();
  const businessProfile = opts.businessProfile ?? await loadBusinessProfile();
  const selectionPolicy = opts.selectionPolicy ?? await loadBusinessSelectionPolicy();
  const calibrationExamples = opts.calibrationExamples ?? await businessCalibrationExamples(a, businessProfile);
  const stepOpts = { ...opts, businessProfile, selectionPolicy, calibrationExamples };
  const prefilter = await runPrefilter(a, stepOpts);
  // UNKNOWN continues for evidence gathering and a readable summary, but remains UNKNOWN in the final result.
  if (prefilter.label === "BLOCK") return { prefilter, scores: null, writing: null, structure: null };
  const threshold = tierThreshold(a.source.tier);
  if (opts.stages === "selection") {
    const scores = threshold === null ? null : await runScores(a, threshold, stepOpts);
    return { prefilter, scores, writing: null, structure: null };
  }
  // The legacy independent score is retained for benchmark-only runs. Current relevance and
  // selection use the same business judgement and score from the prefilter response.
  const structure = runStructure(a, stepOpts).then((value) => ({ value }), (error: unknown) => ({ error }));
  try {
    const scores = null;
    const near = !isShortTweetInput(translateInputOf(a)) && !missingEvidence(a) && (
      prefilter.label === "UNKNOWN" || prefilter.scoreBreakdown.total >= selectionPolicy.reviewFloor
      || prefilter.deadlineStatus === "due_soon" || prefilter.deadlineStatus === "unknown"
    );
    const writing = (near ? await runUnderstand(a, stepOpts) : null) ?? (await runSummarize(a, stepOpts));
    const s = await structure;
    if ("error" in s) throw s.error;
    return { prefilter, scores, writing, structure: s.value };
  } finally {
    // A score/writing error or deploy must not let the job finish while a paid structure request
    // still owns a response. It settles and stores its receipt before shutdown can close the DB.
    await structure;
  }
}

/** Runs the same business prefilter on pasted admin material without creating an article row. */
export async function analyzeBusinessMaterial(input: {
  testId: string;
  profileVersionId: string;
  title: string;
  body: string;
  url?: string | null;
}) {
  const profile = await loadBusinessProfileVersion(input.profileVersionId);
  if (!profile) throw new Error("业务配置版本不存在或不可用");
  const article: AnalyzeInputArticle = {
    id: `business-test:${input.testId}`,
    revision: 1,
    title: input.title,
    url: input.url || `https://local.invalid/business-tests/${input.testId}`,
    author: null,
    publishedAt: null,
    discoveredAt: new Date(),
    bodyText: input.body || null,
    excerpt: null,
    bodyStatus: input.body ? "ok" : "unconfirmed",
    xPost: null,
    media: [],
    source: { name: "管理员材料测试", kind: "external", tier: "T1", firstParty: true, fetchesBody: true },
  };
  const prefilter = await runPrefilter(article, { businessProfile: profile, selectionPolicy: await loadBusinessSelectionPolicy(), attemptTag: `business-test:${input.testId}` });
  return {
    label: prefilter.label,
    reason: prefilter.reason,
    businessScore: prefilter.businessScore,
    deadlineStatus: prefilter.deadlineStatus,
    selectionPolicy: prefilter.selectionPolicy,
    selectionPolicyVersion: prefilter.selectionPolicyVersion,
    profileVersion: prefilter.profileVersion,
    materialCoverage: prefilter.materialCoverage,
    projects: prefilter.projects,
    contexts: prefilter.contexts,
    organizations: prefilter.organizations,
    evidence: prefilter.evidence,
    missingInformation: prefilter.missingInformation,
  };
}

/** One judgement from the steps: the selection rule, the reader-facing copy and the structure. */
export function normalizeAnalysis(run: AnalysisRun) {
  const label = run.prefilter.label;
  const titleZh = collapseWhitespace(run.writing?.titleZh ?? "");
  const summaryZh = (run.writing?.summaryZh ?? "").trim();
  // Business relevance is independent of whether the copy step produced a displayable title/summary.
  const relevance = label === "BLOCK" ? "block" : label === "UNKNOWN" ? "unknown" : "pass";
  // Current analysis uses one LLM response for the task match and weighted 100-point score. The legacy
  // two-score data shape remains available only for historical/benchmark rows.
  const values = run.scores && !run.scores.refused ? run.scores.values : null;
  const sum = values?.length === SCORE_CALLS ? values.reduce((total, v) => total + v, 0) : null;
  const score = run.scores ? (sum === null ? null : Math.floor(sum / SCORE_CALLS)) : run.prefilter.scoreBreakdown.total;
  const threshold = run.scores?.threshold ?? run.prefilter.selectionPolicy.featuredThreshold;
  const deadlineStatus = run.scores
    ? run.scores.deadlineStatuses.length === SCORE_CALLS && run.scores.deadlineStatuses.every((status) => status === run.scores!.deadlineStatuses[0]) ? run.scores.deadlineStatuses[0]! : "unknown"
    : run.prefilter.deadlineStatus;
  const selected = run.scores
    ? relevance === "pass" && deadlineStatus !== "passed" && sum !== null && sum >= run.scores.threshold * SCORE_CALLS
    : relevance === "pass" && deadlineStatus !== "passed" && score !== null && score >= run.prefilter.selectionPolicy.featuredThreshold;
  const subjects = run.structure?.subjects ?? [];
  const tags = [...(run.writing?.tags ?? run.structure?.tags ?? [])];
  for (const s of subjects) {
    const display = ENTITIES[s]?.displayTag;
    if (display && !tags.includes(display)) tags.push(display);
  }
  const businessMatch = {
    label,
    reason: run.prefilter.reason,
    calibrationExamples: run.prefilter.calibrationExamples,
    materialCoverage: run.prefilter.materialCoverage,
    projects: run.prefilter.projects,
    contexts: run.prefilter.contexts,
    organizations: run.prefilter.organizations,
    qualificationRequirements: run.prefilter.qualificationRequirements,
    evidence: run.prefilter.evidence,
    missingInformation: run.prefilter.missingInformation,
    businessScore: run.prefilter.businessScore,
    regionScore: run.prefilter.regionScore,
    scoreBreakdown: run.prefilter.scoreBreakdown,
    selectionPolicy: run.prefilter.selectionPolicy,
    selectionPolicyVersion: run.prefilter.selectionPolicyVersion,
  };
  return {
    relevance,
    selected,
    score,
    scores: values,
    scoreDetails: run.scores?.dimensions ?? null,
    scoreModel: run.scores?.model ?? null,
    scoreWeights: run.scores?.weights ?? null,
    scoreBreakdown: run.prefilter.scoreBreakdown,
    dueSoonDays: run.scores?.dueSoonDays ?? DEFAULT_SCORING_POLICY.dueSoonDays,
    deadlineStatus,
    scoreRefused: run.scores?.refused ?? false,
    threshold,
    businessScore: run.prefilter.businessScore,
    selectionPolicy: run.prefilter.selectionPolicy,
    category: run.structure?.category ?? null,
    tags,
    subjects,
    titleZh,
    summaryZh,
    reasonZh: run.writing?.reasonZh ?? null,
    fact: run.structure?.fact ?? null,
    businessMatch,
  };
}

export interface AnalyzeResult {
  analysisId: number | null;
  stale: boolean;
  /** The article page is to be fetched first; nothing was committed. */
  needsBody?: boolean;
  output: ReturnType<typeof normalizeAnalysis> | null;
  receiptIds: number[];
  reused: boolean;
}

/**
 * Analyses the current revision and commits the judgement. A result computed for an older revision
 * is kept for traceability but never overwrites a newer input (stale = true).
 */
export async function analyzeArticle(articleId: string, opts: StepOpts = {}): Promise<AnalyzeResult | null> {
  const input = await loadAnalyzeInput(articleId);
  if (!input) return null;
  // Its page first; extraction queues the analysis again (normally the queue already routed it there).
  if (waitsForPage(input)) return { analysisId: null, stale: false, needsBody: true, output: null, receiptIds: [], reused: true };
  const run = await runAnalysis(input, opts);
  const out = normalizeAnalysis(run);
  const receiptIds = [
    run.prefilter.receiptId, ...(run.scores?.receiptIds ?? []), ...(run.writing?.receiptIds ?? []), ...(run.structure ? [run.structure.receiptId] : []),
  ];
  const w = run.writing;
  const scorePolicyVersion = run.scores ? `+score-policy@${run.scores.weights.fit}-${run.scores.weights.region}-${run.scores.weights.deadline}-due${run.scores.dueSoonDays}` : "";
  const detail = {
    prefilter: { label: run.prefilter.label, reason: run.prefilter.reason },
    businessMatch: out.businessMatch,
    businessScore: out.businessScore,
    regionScore: run.prefilter.regionScore,
    scoreBreakdown: out.scoreBreakdown,
    score: out.score,
    selectionPolicy: out.selectionPolicy,
    businessProfileVersion: run.prefilter.profileVersion,
    scores: out.scores, scoreDetails: out.scoreDetails, scoreModel: out.scoreModel, scoreWeights: out.scoreWeights, dueSoonDays: out.dueSoonDays, deadlineStatus: out.deadlineStatus, threshold: out.threshold, ...(out.scoreRefused ? { scoreRefused: true } : {}),
    ...(w ? { writer: w.kind, writerModel: w.model, itemType: w.itemType ?? null, authorRole: w.authorRole ?? null } : {}),
    ...(w?.identityGuard?.outcome === "fallback" ? { identityGuard: w.identityGuard } : {}),
    fact: out.fact,
  };
  const committed = await sql.begin(async (tx) => {
    const [current] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${articleId} FOR UPDATE`;
    const stale = !current || current.revision !== input.revision;
    if (out.relevance === "block") {
      if (!stale) await discardArticleTx(tx, articleId);
      return { analysisId: null, stale };
    }
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO analyses (article_id, input_revision, origin, model, prompt_version, receipt_ids, relevance, category, tags,
        subjects, title_zh, summary_zh, reason_zh, score, selected, output)
      VALUES (${articleId}, ${input.revision}, 'model', ${w?.model ?? run.prefilter.model}, ${`${ANALYZE_PROMPT_VERSION}+runtime-business@${run.prefilter.profileVersion}${scorePolicyVersion}`}, ${receiptIds},
        ${out.relevance}, ${out.category}, ${out.tags}, ${out.subjects}, ${out.titleZh}, ${out.summaryZh}, ${out.reasonZh},
        ${out.score}, ${out.selected}, ${tx.json(detail as never)})
      RETURNING id`;
    for (const id of receiptIds) await completeReceipt(tx, id);
    if (!stale) await tx`UPDATE articles SET processing_state = 'analyzed', processing_error = NULL WHERE id = ${articleId}`;
    return { analysisId: row!.id, stale };
  });
  const reused = run.prefilter.reused && (run.scores?.reused ?? true) && (w?.reused ?? true) && (run.structure?.reused ?? true);
  return { analysisId: committed.analysisId, stale: committed.stale, output: out, receiptIds, reused };
}
