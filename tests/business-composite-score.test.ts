import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_BUSINESS_SELECTION_POLICY,
  deadlinePoints,
  normalizeBusinessSelectionPolicy,
  weightedOpportunityScore,
} from "@aihot/backend/editorial/business-selection-policy";

test("default 100-point allocation gives business 70, region 20, and time 10", () => {
  const policy = DEFAULT_BUSINESS_SELECTION_POLICY;
  assert.deepEqual(policy.weights, { fit: 70, region: 20, deadline: 10 });
  assert.deepEqual(Object.values(policy.dimensions).map((dimension) => dimension.max), [35, 23, 12]);
  assert.equal(Object.values(policy.dimensions).reduce((sum, dimension) => sum + dimension.max, 0), policy.weights.fit);
});

test("deadline points are halved when close or unknown, and expired notices get total zero", () => {
  const policy = DEFAULT_BUSINESS_SELECTION_POLICY;
  assert.equal(deadlinePoints("open", policy), 10);
  assert.equal(deadlinePoints("due_soon", policy), 5);
  assert.equal(deadlinePoints("unknown", policy), 5);
  assert.equal(deadlinePoints("passed", policy), 0);
  assert.equal(weightedOpportunityScore({ business: 70, region: 20, deadlineStatus: "open", policy }), 100);
  assert.equal(weightedOpportunityScore({ business: 70, region: 20, deadlineStatus: "passed", policy }), 0);
});

test("legacy 60-point business dimensions migrate to the new 70/20/10 policy", () => {
  const legacy = {
    dimensions: {
      taskFit: { max: 30, guide: "任务匹配" },
      delivery: { max: 20, guide: "交付吻合" },
      importance: { max: 10, guide: "任务重要性" },
    },
    featuredThreshold: 45,
    reviewFloor: 30,
    dueSoonDays: 4,
  };
  const migrated = normalizeBusinessSelectionPolicy(legacy);
  assert.deepEqual(migrated.weights, { fit: 70, region: 20, deadline: 10 });
  assert.deepEqual(Object.values(migrated.dimensions).map((dimension) => dimension.max), [35, 23, 12]);
  assert.equal(migrated.featuredThreshold, 75);
  assert.equal(migrated.reviewFloor, 50);
});
