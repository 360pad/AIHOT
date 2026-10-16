// Admin contract for the versioned company capability profile and its test/feedback loop.
// Model execution is owned by the editorial worker; this module persists the selected profile
// snapshot and exposes a single auditable contract for the later worker and admin UI.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { audit } from "./auth.ts";
import { BUSINESS_PROFILE, businessProfileVersion, invalidateBusinessProfileCache } from "../editorial/business.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";

const DRAFT_KEY = "business_profile.draft";
const CURRENT_KEY = "business_profile.current";

const Terms = z.array(z.string().trim().min(1).max(80)).max(200);
const Examples = z.array(z.string().trim().min(1).max(500)).max(40);

export const CapabilitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().trim().min(1).max(100),
  businessCategory: z.enum(["software", "archives", "modeling", "surveying"]).default("software"),
  enabled: z.boolean().default(true),
  priority: z.enum(["重点", "常规", "观察"]),
  description: z.string().trim().min(1).max(2000),
  serviceTerms: Terms.default([]),
  methodTerms: Terms.default([]),
  deliverableTerms: Terms.default([]),
  contextTerms: Terms.default([]),
  positiveExamples: Examples.default([]),
  negativeExamples: Examples.default([]),
  negativeKeywords: Terms.default([]),
  boundaries: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
});

export const BusinessProfileSchema = z.object({
  schemaVersion: z.string().trim().min(1).max(32),
  capabilities: z.array(CapabilitySchema).min(1).max(80),
  contexts: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
  })).max(100).default([]),
  notes: z.string().max(4000).default(""),
}).strict();

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

const TestInputSchema = z.object({
  profileVersionId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(60_000).default(""),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
}).strict();

const FeedbackSchema = z.object({
  testId: z.string().max(100).nullable().optional(),
  articleId: z.string().max(100).nullable().optional(),
  caseId: z.string().max(200).nullable().optional(),
  label: z.enum(["relevant", "irrelevant", "unknown"]),
  capabilityIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,63}$/)).max(80).default([]),
  participation: z.enum(["standalone", "embedded", "incidental", "unknown"]).nullable().optional(),
  evidenceQuality: z.enum(["clear", "limited", "insufficient"]).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
}).strict();

type Pointer = { versionId: string; revision: number };
type VersionRow = { id: string; content_hash: string; profile: BusinessProfile; status: string; created_by: string; created_at: Date; published_at: Date | null };

class Conflict extends Error {
  code = "conflict";
}

function id(prefix: string) {
  return `${prefix}-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
}

async function pointer(key: string): Promise<Pointer | null> {
  const [row] = await sql<{ value: Pointer }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row?.value ?? null;
}

async function version(versionId: string): Promise<VersionRow | null> {
  const [row] = await sql<VersionRow[]>`SELECT id, content_hash, profile, status, created_by, created_at, published_at FROM business_profile_versions WHERE id = ${versionId}`;
  return row ?? null;
}

function seedAdminProfile(): BusinessProfile {
  const level: Record<string, BusinessProfile["capabilities"][number]["priority"]> = { core: "重点", regular: "常规", watch: "观察" };
  return {
    schemaVersion: String(BUSINESS_PROFILE.schemaVersion),
    capabilities: BUSINESS_PROFILE.capabilities.map((c) => ({
      id: c.id, name: c.name, businessCategory: c.businessCategory, enabled: c.enabled, priority: level[c.level] ?? "常规", description: c.description,
      serviceTerms: c.semanticRoles.serviceActions, methodTerms: c.semanticRoles.methods,
      deliverableTerms: c.semanticRoles.deliverables, contextTerms: c.semanticRoles.objects,
      positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
      negativeKeywords: c.reviewNegativeTerms.length ? c.reviewNegativeTerms : c.negativeExamples,
      boundaries: [...c.boundaries.include, ...c.boundaries.exclude, ...c.boundaries.qualificationUnknown],
    })),
    contexts: BUSINESS_PROFILE.contexts,
    notes: "由 industry/business.json 首次初始化；发布后以后台版本为准。",
  };
}

/** Creates the first editable version once, without overwriting an operator's saved profile. */
async function ensureSeedProfile(): Promise<{ current: Pointer; draft: Pointer } | null> {
  const seed = seedAdminProfile();
  const seedId = `bp-seed-${businessProfileVersion(BUSINESS_PROFILE).split("@")[0].replaceAll(".", "-")}`;
  const hash = sha256(stableJson(seed));
  try {
    return await sql.begin(async (tx) => {
      const existing = await tx<{ key: string; value: Pointer }[]>`SELECT key, value FROM settings WHERE key IN (${CURRENT_KEY}, ${DRAFT_KEY}) FOR UPDATE`;
      const byKey = new Map(existing.map((r) => [r.key, r.value]));
      if (byKey.has(CURRENT_KEY) && byKey.has(DRAFT_KEY)) return { current: byKey.get(CURRENT_KEY)!, draft: byKey.get(DRAFT_KEY)! };
      await tx`INSERT INTO business_profile_versions (id, content_hash, profile, status, created_by)
        VALUES (${seedId}, ${hash}, ${tx.json(seed as never)}, 'published', 'system:seed') ON CONFLICT (id) DO NOTHING`;
      const pointerValue = { versionId: seedId, revision: 0 };
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${CURRENT_KEY}, ${tx.json(pointerValue)}, 'system:seed') ON CONFLICT (key) DO NOTHING`;
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${DRAFT_KEY}, ${tx.json(pointerValue)}, 'system:seed') ON CONFLICT (key) DO NOTHING`;
      return { current: byKey.get(CURRENT_KEY) ?? pointerValue, draft: byKey.get(DRAFT_KEY) ?? pointerValue };
    });
  } catch {
    // The admin migration may not have run yet; the page can still load its local seed below.
    return null;
  }
}

export async function businessProfile() {
  const seeded = await ensureSeedProfile();
  if (!seeded) {
    const profile = seedAdminProfile();
    const now = new Date();
    const local = { id: "seed-local", content_hash: sha256(stableJson(profile)), profile, status: "published", created_by: "system:seed", created_at: now, published_at: now };
    return { current: null, draft: null, currentProfile: local, draftProfile: local, history: [local] };
  }
  const { current, draft } = seeded;
  const ids = [...new Set([current.versionId, draft.versionId])];
  const profiles = await sql<VersionRow[]>`SELECT id, content_hash, profile, status, created_by, created_at, published_at FROM business_profile_versions WHERE id = ANY(${ids})`;
  const history = await sql<VersionRow[]>`SELECT id, content_hash, profile, status, created_by, created_at, published_at FROM business_profile_versions ORDER BY created_at DESC LIMIT 100`;
  return { current, draft, currentProfile: profiles.find((p) => p.id === current.versionId) ?? null, draftProfile: profiles.find((p) => p.id === draft.versionId) ?? null, history };
}

export async function saveBusinessProfileDraft(input: { profile: unknown; expectedRevision: number; reason: string }, actor: string) {
  if (!input.reason?.trim()) throw new Error("reason is required");
  const profile = BusinessProfileSchema.parse(input.profile);
  const hash = sha256(stableJson(profile));
  const versionId = id("bp");
  const nextRevision = input.expectedRevision + 1;
  await sql.begin(async (tx) => {
    const [row] = await tx<{ value: Pointer }[]>`SELECT value FROM settings WHERE key = ${DRAFT_KEY} FOR UPDATE`;
    const previous = row?.value ?? null;
    if ((previous?.revision ?? 0) !== input.expectedRevision) throw new Conflict("业务配置草稿已被其他窗口修改，请刷新后再保存");
    await tx`INSERT INTO business_profile_versions (id, content_hash, profile, status, created_by) VALUES (${versionId}, ${hash}, ${tx.json(profile as never)}, 'draft', ${actor})`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${DRAFT_KEY}, ${tx.json({ versionId, revision: nextRevision })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  });
  await audit(actor, "business.profile.draft", `business-profile:${versionId}`, input.reason, null, { versionId, revision: nextRevision, contentHash: hash });
  return { versionId, revision: nextRevision, contentHash: hash };
}

export async function publishBusinessProfile(input: { versionId?: string; expectedRevision: number; reason: string }, actor: string) {
  if (!input.reason?.trim()) throw new Error("reason is required");
  const draft = await pointer(DRAFT_KEY);
  if (!draft || draft.revision !== input.expectedRevision) throw new Conflict("业务配置草稿已变化，请刷新后再发布");
  const versionId = input.versionId ?? draft.versionId;
  if (versionId !== draft.versionId) throw new Conflict("只能发布当前草稿版本");
  const next = await version(versionId);
  if (!next) return null;
  const current = await pointer(CURRENT_KEY);
  await sql.begin(async (tx) => {
    if (current?.versionId && current.versionId !== versionId) await tx`UPDATE business_profile_versions SET status = 'superseded' WHERE id = ${current.versionId}`;
    await tx`UPDATE business_profile_versions SET status = 'published', published_at = coalesce(published_at, now()) WHERE id = ${versionId}`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${CURRENT_KEY}, ${tx.json({ versionId, revision: draft.revision })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  });
  await audit(actor, "business.profile.publish", `business-profile:${versionId}`, input.reason, current, { versionId, revision: draft.revision });
  invalidateBusinessProfileCache();
  return { versionId, revision: draft.revision };
}

export async function rollbackBusinessProfile(versionId: string, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const target = await version(versionId);
  if (!target) return null;
  const current = await pointer(CURRENT_KEY);
  await sql.begin(async (tx) => {
    if (current?.versionId && current.versionId !== versionId) await tx`UPDATE business_profile_versions SET status = 'superseded' WHERE id = ${current.versionId}`;
    await tx`UPDATE business_profile_versions SET status = 'published', published_at = coalesce(published_at, now()) WHERE id = ${versionId}`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${CURRENT_KEY}, ${tx.json({ versionId, revision: current?.revision ?? 0 })}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  });
  await audit(actor, "business.profile.rollback", `business-profile:${versionId}`, reason, current, { versionId });
  invalidateBusinessProfileCache();
  return { versionId };
}

export async function createBusinessMatchingTest(input: unknown, actor: string) {
  const parsed = TestInputSchema.parse(input);
  if (!(await version(parsed.profileVersionId))) throw new Error("业务配置版本不存在");
  const testId = id("bmt");
  await sql`INSERT INTO business_matching_tests (id, profile_version_id, title, body, source_url, created_by)
    VALUES (${testId}, ${parsed.profileVersionId}, ${parsed.title}, ${parsed.body}, ${parsed.sourceUrl ?? null}, ${actor})`;
  await audit(actor, "business.matching.test", `business-test:${testId}`, null, null, { profileVersionId: parsed.profileVersionId });
  try {
    await enqueue(QUEUES.businessMatching, { testId }, { singletonKey: testId });
  } catch (error) {
    await sql`UPDATE business_matching_tests SET status = 'failed', error = ${String(error instanceof Error ? error.message : error).slice(0, 4000)}, updated_at = now() WHERE id = ${testId}`;
    throw error;
  }
  return { id: testId, status: "queued", profileVersionId: parsed.profileVersionId };
}

export async function listBusinessMatchingTests() {
  return sql`SELECT id, profile_version_id, title, source_url, status, result, error, created_by, created_at, updated_at
             FROM business_matching_tests ORDER BY created_at DESC LIMIT 100`;
}

export async function businessMatchingTest(testId: string) {
  const [test] = await sql`SELECT * FROM business_matching_tests WHERE id = ${testId}`;
  if (!test) return null;
  const feedback = await sql`SELECT id, label, capability_ids, participation, evidence_quality, note, created_by, created_at
    FROM business_matching_feedback WHERE test_id = ${testId} ORDER BY created_at DESC`;
  return { test, feedback };
}

export async function saveBusinessMatchingFeedback(input: unknown, actor: string) {
  const parsed = FeedbackSchema.parse(input);
  if (!parsed.testId && !parsed.articleId && !parsed.caseId) throw new Error("testId、articleId 或 caseId 至少填写一项");
  let originalResult: unknown = null;
  if (parsed.testId) {
    const [test] = await sql<{ result: unknown }[]>`SELECT result FROM business_matching_tests WHERE id = ${parsed.testId}`;
    if (!test) return null;
    originalResult = test.result;
  }
  if (parsed.articleId) {
    const [article] = await sql<{ id: string; title: string; relevance: string | null; score: number | null; selected: boolean | null; output: unknown }[]>`
      SELECT a.id, a.title, an.relevance, an.score, an.selected, an.output
      FROM articles a LEFT JOIN LATERAL (
        SELECT relevance, score, selected, output FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1
      ) an ON true WHERE a.id = ${parsed.articleId}`;
    if (!article) return null;
    originalResult = { title: article.title, relevance: article.relevance, score: article.score, selected: article.selected, output: article.output };
  }
  const [row] = await sql`
    INSERT INTO business_matching_feedback (test_id, article_id, case_id, label, capability_ids, participation, evidence_quality, note, original_result, created_by)
    VALUES (${parsed.testId ?? null}, ${parsed.articleId ?? null}, ${parsed.caseId ?? null}, ${parsed.label}, ${parsed.capabilityIds}, ${parsed.participation ?? null}, ${parsed.evidenceQuality ?? null}, ${parsed.note ?? null}, ${sql.json(originalResult as never)}, ${actor})
    RETURNING id, test_id, article_id, case_id, label, capability_ids, participation, evidence_quality, note, created_by, created_at`;
  await audit(actor, "business.matching.feedback", parsed.testId ? `business-test:${parsed.testId}` : `business-case:${parsed.caseId ?? parsed.articleId}`, null, originalResult, row);
  return row;
}

export const businessMatchingSchemas = { BusinessProfileSchema, TestInputSchema, FeedbackSchema };
