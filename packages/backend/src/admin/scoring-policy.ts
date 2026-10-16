import { sql } from "../db.ts";
import { audit } from "./auth.ts";
import { DEFAULT_SCORING_POLICY, normalizeScoringPolicy, SCORING_POLICY_KEY, type ScoringPolicy } from "../editorial/scoring-policy.ts";

export async function getScoringPolicy() {
  const [row] = await sql<{ value: unknown; updated_at: Date }[]>`SELECT value, updated_at FROM settings WHERE key = ${SCORING_POLICY_KEY}`;
  return { ...(row ? normalizeScoringPolicy(row.value) : DEFAULT_SCORING_POLICY), updatedAt: row?.updated_at.toISOString() ?? null };
}

export async function updateScoringPolicy(input: { weights: unknown; dueSoonDays?: unknown; reason: string }, actor: string) {
  if (!input.reason?.trim()) throw Object.assign(new Error("请填写调整原因"), { statusCode: 400 });
  const before = await getScoringPolicy();
  const after: ScoringPolicy = normalizeScoringPolicy({ weights: input.weights, dueSoonDays: input.dueSoonDays });
  await sql`
    INSERT INTO settings (key, value, updated_by) VALUES (${SCORING_POLICY_KEY}, ${sql.json(after)}, ${actor})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.scoring_policy", `settings:${SCORING_POLICY_KEY}`, input.reason.trim(), before, after);
  return { ...after, updatedAt: new Date().toISOString() };
}
