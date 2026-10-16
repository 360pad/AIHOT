import { sql } from "../db.ts";

export const SCORING_POLICY_KEY = "editorial.scoring_policy";

export type ScoringWeights = { fit: number; region: number; deadline: number };
export type ScoringPolicy = { weights: ScoringWeights; dueSoonDays: number };

export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  weights: { fit: 60, region: 25, deadline: 15 },
  dueSoonDays: 4,
};

function invalidPolicy(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeScoringPolicy(input: unknown): ScoringPolicy {
  if (!input || typeof input !== "object") throw invalidPolicy("评分规则格式无效");
  const value = input as Record<string, unknown>;
  const weights = value.weights && typeof value.weights === "object" ? value.weights as Record<string, unknown> : {};
  const next = { fit: Number(weights.fit), region: Number(weights.region), deadline: Number(weights.deadline) };
  if (Object.values(next).some((weight) => !Number.isInteger(weight) || weight < 0 || weight > 100)) throw invalidPolicy("各项权重必须是 0–100 的整数");
  if (next.fit + next.region + next.deadline !== 100) throw invalidPolicy("业务、地域和开标时间权重合计必须为 100%");
  const dueSoonDays = Number(value.dueSoonDays ?? DEFAULT_SCORING_POLICY.dueSoonDays);
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 30) throw invalidPolicy("临近开标天数必须是 1–30 的整数");
  return { weights: next, dueSoonDays };
}

export async function loadScoringPolicy(): Promise<ScoringPolicy> {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${SCORING_POLICY_KEY}`;
  return row ? normalizeScoringPolicy(row.value) : DEFAULT_SCORING_POLICY;
}

export function weightedScore(dimensions: { fit: number; region: number; deadline: number }, weights: ScoringWeights): number {
  return Math.round((dimensions.fit * weights.fit + dimensions.region * weights.region + dimensions.deadline * weights.deadline) / 10);
}
