import { sql } from "../db.ts";
import { audit } from "./auth.ts";
import {
  BUSINESS_SELECTION_POLICY_KEY,
  DEFAULT_BUSINESS_SELECTION_POLICY,
  normalizeBusinessSelectionPolicy,
  type BusinessSelectionPolicy,
} from "../editorial/business-selection-policy.ts";

export async function getBusinessSelectionPolicy() {
  const [row] = await sql<{ value: unknown; updated_at: Date }[]>`SELECT value, updated_at FROM settings WHERE key = ${BUSINESS_SELECTION_POLICY_KEY}`;
  return { ...(row ? normalizeBusinessSelectionPolicy(row.value) : DEFAULT_BUSINESS_SELECTION_POLICY), updatedAt: row?.updated_at.toISOString() ?? null };
}

export async function updateBusinessSelectionPolicy(input: { policy: unknown; reason: string }, actor: string) {
  if (!input.reason.trim()) throw Object.assign(new Error("请填写调整原因"), { statusCode: 400 });
  const before = await getBusinessSelectionPolicy();
  const after: BusinessSelectionPolicy = normalizeBusinessSelectionPolicy(input.policy);
  await sql`
    INSERT INTO settings (key, value, updated_by) VALUES (${BUSINESS_SELECTION_POLICY_KEY}, ${sql.json(after)}, ${actor})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.business_selection_policy", `settings:${BUSINESS_SELECTION_POLICY_KEY}`, input.reason.trim(), before, after);
  return { ...after, updatedAt: new Date().toISOString() };
}
