import { sha256, stableJson } from "../lib/ids.ts";
import { sql } from "../db.ts";

export const BUSINESS_SELECTION_POLICY_KEY = "editorial.business_selection_policy";

export type BusinessSelectionDimension = "taskFit" | "delivery" | "importance";
export type BusinessJudgementLabel = "PASS" | "UNKNOWN" | "BLOCK";
export type BusinessSelectionPolicy = {
  weights: { fit: number; region: number; deadline: number };
  dimensions: Record<BusinessSelectionDimension, { max: number; guide: string }>;
  featuredThreshold: number;
  reviewFloor: number;
  reviewHighFloor: number;
  dueSoonDays: number;
};

export const DEFAULT_BUSINESS_SELECTION_POLICY: BusinessSelectionPolicy = {
  weights: { fit: 70, region: 20, deadline: 10 },
  dimensions: {
    taskFit: { max: 35, guide: "按实际采购任务与企业能力的直接或部分语义匹配程度评分；关键词和同义表达是线索，不是硬门槛。" },
    delivery: { max: 23, guide: "按公告明确的采购动作、服务内容和交付成果与企业可提供内容的吻合程度评分。" },
    importance: { max: 12, guide: "按相关任务是否属于主要采购内容、独立标包或核心组成部分评分；背景提及和附带义务不算核心任务。" },
  },
  featuredThreshold: 75,
  reviewFloor: 50,
  reviewHighFloor: 50,
  dueSoonDays: 4,
};

export function deadlinePoints(status: "open" | "due_soon" | "passed" | "unknown", policy: BusinessSelectionPolicy): number {
  if (status === "open") return policy.weights.deadline;
  if (status === "due_soon" || status === "unknown") return Math.floor(policy.weights.deadline / 2);
  return 0;
}

export function weightedOpportunityScore(input: {
  business: number;
  region: number;
  deadlineStatus: "open" | "due_soon" | "passed" | "unknown";
  policy: BusinessSelectionPolicy;
}): number {
  if (input.deadlineStatus === "passed") return 0;
  return input.business + input.region + deadlinePoints(input.deadlineStatus, input.policy);
}

export function resolveBusinessJudgement(input: {
  modelLabel: BusinessJudgementLabel;
  deadlineStatus: "open" | "due_soon" | "passed" | "unknown";
  score: number;
  reviewFloor: number;
  hasMatchedTask: boolean;
  hasMaterial: boolean;
}): BusinessJudgementLabel {
  if (input.deadlineStatus === "passed") return "BLOCK";
  if (input.hasMatchedTask) return "PASS";
  if (input.score >= input.reviewFloor) return "UNKNOWN";
  if (input.modelLabel === "BLOCK" && !input.hasMaterial) return "UNKNOWN";
  if (input.modelLabel === "PASS") return "UNKNOWN";
  return input.modelLabel;
}

export function businessSelectionPolicyVersion(policy: BusinessSelectionPolicy): string {
  const { reviewHighFloor: _reviewHighFloor, ...scoringPolicy } = policy;
  return `selection@${sha256(stableJson(scoringPolicy)).slice(0, 10)}`;
}

function invalidPolicy(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeBusinessSelectionPolicy(input: unknown): BusinessSelectionPolicy {
  if (!input || typeof input !== "object") throw invalidPolicy("精选规则格式无效");
  const value = input as Record<string, any>;
  const rawWeights = value.weights && typeof value.weights === "object" ? value.weights as Record<string, unknown> : null;
  const legacyDimensions = value.dimensions && typeof value.dimensions === "object" ? value.dimensions as Record<string, { max?: unknown; guide?: unknown }> : {};
  const legacyTotal = ["taskFit", "delivery", "importance"].reduce((sum, key) => sum + Number(legacyDimensions[key]?.max ?? 0), 0);
  const migratedLegacy = !rawWeights && legacyTotal === 60;
  const weights = rawWeights
    ? { fit: Number(rawWeights.fit), region: Number(rawWeights.region), deadline: Number(rawWeights.deadline) }
    : DEFAULT_BUSINESS_SELECTION_POLICY.weights;
  if (Object.values(weights).some((weight) => !Number.isInteger(weight) || weight < 0 || weight > 100)) throw invalidPolicy("业务、地域和开标时效分值必须是 0–100 的整数");
  if (weights.fit + weights.region + weights.deadline !== 100) throw invalidPolicy("业务、地域和开标时间分值合计必须为 100 分");
  const dimensions = {} as BusinessSelectionPolicy["dimensions"];
  for (const key of ["taskFit", "delivery", "importance"] as const) {
    const raw = value.dimensions?.[key] ?? DEFAULT_BUSINESS_SELECTION_POLICY.dimensions[key];
    const max = migratedLegacy ? DEFAULT_BUSINESS_SELECTION_POLICY.dimensions[key].max : Number(raw.max);
    const guide = String(raw.guide ?? "").trim();
    if (!Number.isInteger(max) || max < 0 || max > 100) throw invalidPolicy("每项业务分值上限必须是 0–100 的整数");
    if (!guide || guide.length > 500) throw invalidPolicy("每项评分说明必须填写且不超过 500 字");
    dimensions[key] = { max, guide };
  }
  if (Object.values(dimensions).reduce((sum, item) => sum + item.max, 0) !== weights.fit) throw invalidPolicy("三项业务分值上限合计必须等于业务分值");
  const featuredThreshold = Number(value.featuredThreshold);
  const reviewFloor = Number(value.reviewFloor);
  const dueSoonDays = Number(value.dueSoonDays);
  const migratedThreshold = migratedLegacy ? DEFAULT_BUSINESS_SELECTION_POLICY.featuredThreshold : featuredThreshold;
  const migratedReviewFloor = migratedLegacy ? DEFAULT_BUSINESS_SELECTION_POLICY.reviewFloor : reviewFloor;
  const reviewHighFloor = value.reviewHighFloor === undefined
    ? Math.min(migratedReviewFloor, weights.fit)
    : Number(value.reviewHighFloor);
  if (!Number.isInteger(migratedThreshold) || migratedThreshold < 1 || migratedThreshold > 100) throw invalidPolicy("精选门槛必须是 1–100 的整数");
  if (!Number.isInteger(migratedReviewFloor) || migratedReviewFloor < 0 || migratedReviewFloor >= migratedThreshold) throw invalidPolicy("人工复核起始分必须小于精选门槛");
  if (!Number.isInteger(reviewHighFloor) || reviewHighFloor < 0 || reviewHighFloor > weights.fit) throw invalidPolicy("人工复核高分线必须在 0 与业务分满分之间");
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 30) throw invalidPolicy("临近开标天数必须是 1–30 的整数");
  return { weights, dimensions, featuredThreshold: migratedThreshold, reviewFloor: migratedReviewFloor, reviewHighFloor, dueSoonDays };
}

export async function loadBusinessSelectionPolicy(): Promise<BusinessSelectionPolicy> {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${BUSINESS_SELECTION_POLICY_KEY}`;
  return row ? normalizeBusinessSelectionPolicy(row.value) : DEFAULT_BUSINESS_SELECTION_POLICY;
}
