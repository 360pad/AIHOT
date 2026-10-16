import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SCORING_POLICY, normalizeScoringPolicy, weightedScore } from "@aihot/backend/editorial/scoring-policy";
import { isCurrentOpportunity } from "@aihot/backend/publication/rules";

test("public scoring weights must total 100 and the configured weights drive the score", () => {
  assert.deepEqual(normalizeScoringPolicy({ weights: { fit: 60, region: 25, deadline: 15 }, dueSoonDays: 4 }), DEFAULT_SCORING_POLICY);
  assert.equal(weightedScore({ fit: 10, region: 10, deadline: 10 }, DEFAULT_SCORING_POLICY.weights), 100);
  assert.equal(weightedScore({ fit: 10, region: 0, deadline: 0 }, { fit: 60, region: 25, deadline: 15 }), 60);
  assert.throws(() => normalizeScoringPolicy({ weights: { fit: 60, region: 20, deadline: 15 }, dueSoonDays: 4 }), /合计必须为 100/);
  assert.throws(() => normalizeScoringPolicy({ weights: { fit: 60, region: -5, deadline: 45 }, dueSoonDays: 4 }), /0–100 的整数/);
  assert.throws(() => normalizeScoringPolicy({ weights: { fit: 60, region: 25, deadline: 15 }, dueSoonDays: 31 }), /1–30/);
});

test("passed procurement notices leave current opportunities without hiding award-learning records", () => {
  assert.equal(isCurrentOpportunity({ itemType: "tender_notice", deadlineStatus: "passed" }), false);
  assert.equal(isCurrentOpportunity({ itemType: "pre_bid_notice", deadlineStatus: "passed" }), false);
  assert.equal(isCurrentOpportunity({ itemType: "award_result", deadlineStatus: "passed" }), true);
  assert.equal(isCurrentOpportunity({ itemType: "tender_notice", deadlineStatus: "unknown" }), true);
});
