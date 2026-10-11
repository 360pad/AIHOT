import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "../config.ts";
import { sql } from "../db.ts";
import { stableJson } from "../lib/ids.ts";
import type { AnalyzeInputArticle } from "./input.ts";

const RoleTermsSchema = z.object({
  serviceActions: z.array(z.string()).default([]),
  methods: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  objects: z.array(z.string()).default([]),
});

const BoundariesSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  qualificationUnknown: z.array(z.string()).default([]),
});

const CapabilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  level: z.enum(["core", "regular", "watch"]),
  enabled: z.boolean().default(true),
  description: z.string().min(1),
  semanticRoles: RoleTermsSchema,
  boundaries: BoundariesSchema,
  positiveExamples: z.array(z.string()).default([]),
  negativeExamples: z.array(z.string()).default([]),
});

const ContextSchema = z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1) });

export const BusinessProfileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  profileVersion: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  contexts: z.array(ContextSchema),
  capabilities: z.array(CapabilitySchema).min(1),
  keywordRoles: z.record(z.string(), z.string()),
  matchingRules: z.object({
    industryIsContext: z.boolean(),
    keywordsAreHints: z.boolean(),
    requireSameTaskEvidence: z.boolean(),
    allowSemanticMatchWithoutKeyword: z.boolean(),
    unknownNeverBecomesPassFromWriting: z.boolean(),
    incidentalObligationIsNotIndependentOpportunity: z.boolean(),
  }),
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;
export type BusinessCapability = BusinessProfile["capabilities"][number];

const PROFILE_PATH = path.join(REPO_ROOT, "industry/business.json");
const PROFILE_SOURCE = readFileSync(PROFILE_PATH, "utf8");
export const BUSINESS_PROFILE = BusinessProfileSchema.parse(JSON.parse(PROFILE_SOURCE));

const PROFILE_HASH = createHash("sha256").update(PROFILE_SOURCE).digest("hex").slice(0, 12);

/** Hashes the complete seed so model receipts identify the capability version actually used. */
export function businessProfileVersion(profile: BusinessProfile = BUSINESS_PROFILE): string {
  const hash = profile === BUSINESS_PROFILE ? PROFILE_HASH : createHash("sha256").update(stableJson(profile)).digest("hex").slice(0, 12);
  return `${profile.profileVersion}@${hash}`;
}

const levelLabel: Record<BusinessCapability["level"], string> = { core: "核心", regular: "常规", watch: "观察" };

/** A compact, human-readable capability registry injected into model instructions. */
export function businessProfilePrompt(profile: BusinessProfile = BUSINESS_PROFILE): string {
  const capabilities = profile.capabilities
    .filter((c) => c.enabled)
    .map((c) => {
      const r = c.semanticRoles;
      const b = c.boundaries;
      return [
        `能力 ${c.id}｜${c.name}｜关注级别=${levelLabel[c.level]}`,
        `说明：${c.description}`,
        `服务动作：${r.serviceActions.join("、")}`,
        `方法技术：${r.methods.join("、")}`,
        `交付成果：${r.deliverables.join("、")}`,
        `对象场景（仅上下文）：${r.objects.join("、")}`,
        `纳入边界：${b.include.join("；")}`,
        `排除边界：${b.exclude.join("；")}`,
        `正例：${c.positiveExamples.join("；")}`,
        `易混淆反例：${c.negativeExamples.join("；")}`,
      ].join("\n");
    });
  const contexts = profile.contexts.map((c) => `${c.name}（${c.description}）`).join("；");
  const roles = Object.entries(profile.keywordRoles).map(([role, description]) => `${role}：${description}`).join("；");
  return [
    `配置版本：${businessProfileVersion(profile)}`,
    `总原则：${profile.description}`,
    `场景上下文：${contexts}`,
    `关键词角色：${roles}`,
    ...capabilities,
    "判定约束：行业词、机构名、预算和地区不能单独通过；关键词是线索，不是硬门槛。必须把服务动作、对象、方法和交付成果放在同一采购任务或标包中理解。没有词语命中时仍须做语义判断；不确定材料保持 UNKNOWN。",
  ].join("\n");
}

export interface BusinessKeywordClue {
  capabilityId: string;
  capabilityName: string;
  role: "serviceAction" | "method" | "deliverable" | "object";
  term: string;
}

/** Keyword hits are context for the model only; callers must not use this as a business gate. */
export function businessKeywordClues(a: Pick<AnalyzeInputArticle, "title" | "bodyText" | "excerpt">, profile: BusinessProfile = BUSINESS_PROFILE): BusinessKeywordClue[] {
  const text = [a.title, a.bodyText, a.excerpt].filter(Boolean).join("\n").toLocaleLowerCase();
  if (!text) return [];
  const roles = ["serviceActions", "methods", "deliverables", "objects"] as const;
  const roleNames: Record<(typeof roles)[number], BusinessKeywordClue["role"]> = {
    serviceActions: "serviceAction", methods: "method", deliverables: "deliverable", objects: "object",
  };
  const hits: BusinessKeywordClue[] = [];
  for (const c of profile.capabilities) {
    if (!c.enabled) continue;
    for (const role of roles) {
      for (const term of c.semanticRoles[role]) {
        if (term && text.includes(term.toLocaleLowerCase())) hits.push({ capabilityId: c.id, capabilityName: c.name, role: roleNames[role], term });
      }
    }
  }
  return hits.filter((hit, i) => hits.findIndex((other) => other.capabilityId === hit.capabilityId && other.role === hit.role && other.term === hit.term) === i).slice(0, 60);
}

function fromPersistedProfile(value: unknown, versionId: string, contentHash: string): BusinessProfile | null {
  const current = BusinessProfileSchema.safeParse(value);
  if (current.success) return { ...current.data, profileVersion: `${versionId}@${contentHash}` };
  if (!value || typeof value !== "object") return null;
  const legacy = value as Record<string, any>;
  if (typeof legacy.schemaVersion !== "string" || !Array.isArray(legacy.capabilities)) return null;
  const contexts = Array.isArray(legacy.contexts) ? legacy.contexts : [];
  const capabilities = legacy.capabilities.map((c: Record<string, any>) => ({
    id: c.id,
    name: c.name,
    level: c.priority === "重点" ? "core" : c.priority === "观察" ? "watch" : "regular",
    enabled: c.enabled !== false,
    description: c.description,
    semanticRoles: {
      serviceActions: c.serviceTerms ?? [], methods: c.methodTerms ?? [], deliverables: c.deliverableTerms ?? [], objects: c.contextTerms ?? [],
    },
    boundaries: { include: c.boundaries ?? [], exclude: [], qualificationUnknown: [] },
    positiveExamples: c.positiveExamples ?? [], negativeExamples: c.negativeExamples ?? [],
  }));
  const normalized = BusinessProfileSchema.safeParse({
    schemaVersion: 1,
    profileVersion: `${versionId}@${contentHash}`,
    name: "企业招投标交付能力",
    description: "按实际采购任务和可交付成果判断企业业务相关性。场景行业只用于理解项目背景，不是能力匹配的必备条件。",
    contexts,
    capabilities,
    keywordRoles: { serviceAction: "服务动作，仅用于定位", method: "方法或技术，仅用于理解", deliverable: "交付成果，用于能力确认", object: "对象和场景，仅作上下文", organization: "机构或项目名称，仅作背景" },
    matchingRules: { industryIsContext: true, keywordsAreHints: true, requireSameTaskEvidence: true, allowSemanticMatchWithoutKeyword: true, unknownNeverBecomesPassFromWriting: true, incidentalObligationIsNotIndependentOpportunity: true },
  });
  return normalized.success ? normalized.data : null;
}

let runtimeCache: { at: number; profile: BusinessProfile } | null = null;

/** Uses the published admin snapshot when present; the checked-in seed remains the safe fallback. */
export async function loadBusinessProfile(): Promise<BusinessProfile> {
  if (runtimeCache && Date.now() - runtimeCache.at < 5_000) return runtimeCache.profile;
  try {
    const [pointer] = await sql<{ value: { versionId?: string } }[]>`SELECT value FROM settings WHERE key = 'business_profile.current'`;
    const versionId = pointer?.value?.versionId;
    if (versionId) {
      const [version] = await sql<{ profile: unknown; content_hash: string }[]>`SELECT profile, content_hash FROM business_profile_versions WHERE id = ${versionId} AND status = 'published'`;
      const profile = version && fromPersistedProfile(version.profile, versionId, version.content_hash);
      if (profile) {
        runtimeCache = { at: Date.now(), profile };
        return profile;
      }
    }
  } catch {
    // The seed is also used before the optional admin migration has been applied.
  }
  runtimeCache = { at: Date.now(), profile: BUSINESS_PROFILE };
  return BUSINESS_PROFILE;
}

/** Loads a specific published profile snapshot for an admin test or a re-analysis. */
export async function loadBusinessProfileVersion(versionId: string): Promise<BusinessProfile | null> {
  if (versionId === businessProfileVersion(BUSINESS_PROFILE)) return BUSINESS_PROFILE;
  try {
    const [row] = await sql<{ profile: unknown; content_hash: string }[]>`
      SELECT profile, content_hash FROM business_profile_versions
      WHERE id = ${versionId} AND status IN ('published', 'superseded')`;
    return row ? fromPersistedProfile(row.profile, versionId, row.content_hash) : null;
  } catch {
    return null;
  }
}

export function invalidateBusinessProfileCache(): void {
  runtimeCache = null;
}
