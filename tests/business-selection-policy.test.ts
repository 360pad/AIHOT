import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { getBusinessSelectionPolicy, updateBusinessSelectionPolicy } from "@aihot/backend/admin/business-selection-policy";
import { businessSelectionPolicyVersion, DEFAULT_BUSINESS_SELECTION_POLICY, normalizeBusinessSelectionPolicy } from "@aihot/backend/editorial/business-selection-policy";

after(async () => {
  await closeDb();
});

test("business selection policy validates score caps and thresholds", () => {
  assert.deepEqual(normalizeBusinessSelectionPolicy(DEFAULT_BUSINESS_SELECTION_POLICY), DEFAULT_BUSINESS_SELECTION_POLICY);
  assert.throws(() => normalizeBusinessSelectionPolicy({ ...DEFAULT_BUSINESS_SELECTION_POLICY, dimensions: { ...DEFAULT_BUSINESS_SELECTION_POLICY.dimensions, taskFit: { ...DEFAULT_BUSINESS_SELECTION_POLICY.dimensions.taskFit, max: 36 } } }), /等于业务分值/);
  assert.throws(() => normalizeBusinessSelectionPolicy({ ...DEFAULT_BUSINESS_SELECTION_POLICY, featuredThreshold: 30, reviewFloor: 30 }), /必须小于精选门槛/);
});

test("review high floor defaults for older settings and does not alter scoring versions", () => {
  const { reviewHighFloor: _reviewHighFloor, ...legacy } = DEFAULT_BUSINESS_SELECTION_POLICY;
  assert.equal(normalizeBusinessSelectionPolicy(legacy).reviewHighFloor, Math.min(legacy.reviewFloor, legacy.weights.fit));
  const changed = { ...DEFAULT_BUSINESS_SELECTION_POLICY, reviewHighFloor: DEFAULT_BUSINESS_SELECTION_POLICY.reviewHighFloor - 1 };
  assert.equal(businessSelectionPolicyVersion(changed), businessSelectionPolicyVersion(DEFAULT_BUSINESS_SELECTION_POLICY));
});

test("admin business selection policy saves, audits and restores the setting", async () => {
  const before = await getBusinessSelectionPolicy();
  const actor = "test:business-selection-policy";
  const reason = `test business selection ${Date.now()}`;
  const { updatedAt: _updatedAt, ...base } = before;
  const policy = { ...base, featuredThreshold: 46, reviewFloor: 31 };
  try {
    const saved = await updateBusinessSelectionPolicy({ policy, reason }, actor);
    assert.deepEqual({ ...saved, updatedAt: null }, { ...policy, updatedAt: null });
    const current = await getBusinessSelectionPolicy();
    assert.deepEqual({ ...current, updatedAt: null }, { ...policy, updatedAt: null });
    assert.ok(current.updatedAt);
    const [entry] = await sql<{ actor: string; action: string; reason: string }[]>`
      SELECT actor, action, reason FROM audit_log WHERE subject = 'settings:editorial.business_selection_policy' AND reason = ${reason}`;
    assert.deepEqual([entry?.actor, entry?.action, entry?.reason], [actor, "settings.business_selection_policy", reason]);
  } finally {
    await updateBusinessSelectionPolicy({ policy: base, reason: "restore test setting" }, actor);
  }
});
