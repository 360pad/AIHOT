import assert from "node:assert/strict";
import test from "node:test";
import { isMaanshanSoftwareMaintenance } from "@aihot/backend/publication/regional-selection";

const valid = {
  enabled: true,
  sourceTier: "T1",
  itemType: "tender_notice",
  deadlineStatus: "open",
  relevance: "pass",
  negativeKeywordHit: false,
  articleText: "马鞍山市软件系统运维服务项目招标公告",
  businessMatch: {
    label: "PASS",
    projects: [{
      name: "马鞍山市软件系统运维服务项目",
      evidenceIds: ["city"],
      tasks: [{
        name: "软件系统运维服务",
        action: "运行维护服务",
        object: "软件系统",
        deliverables: ["运维服务"],
        evidenceIds: ["city", "ops"],
        matches: [{ capabilityId: "software-platform", relation: "direct", evidenceIds: ["ops"] }],
      }],
    }],
    evidence: [
      { id: "city", quote: "马鞍山市软件系统运维服务项目", verified: true },
      { id: "ops", quote: "提供软件系统运行维护服务", verified: true },
    ],
  },
};

test("Ma'anshan rule accepts a verified, open software-maintenance procurement", () => {
  assert.equal(isMaanshanSoftwareMaintenance(valid), true);
});

test("Ma'anshan rule rejects unsupported, excluded, unrelated, or expired opportunities", () => {
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, enabled: false }), false);
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, sourceTier: "EXCLUDE_MP" }), false);
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, itemType: "award_result" }), false);
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, deadlineStatus: "unknown" }), false);
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, negativeKeywordHit: true }), false);
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, articleText: "芜湖市软件系统运维服务项目" }), false);
});

test("Ma'anshan rule requires same-task software evidence and a direct or partial capability match", () => {
  const businessMatch = structuredClone(valid.businessMatch);
  businessMatch.projects[0]!.tasks[0]!.matches[0]!.relation = "adjacent";
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, businessMatch }), false);

  const noVerifiedProof = structuredClone(valid.businessMatch);
  noVerifiedProof.evidence[1]!.verified = false;
  assert.equal(isMaanshanSoftwareMaintenance({ ...valid, businessMatch: noVerifiedProof }), false);
});
