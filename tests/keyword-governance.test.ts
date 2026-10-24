import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { BUSINESS_PROFILE } from "@aihot/backend/editorial/business";
import { keywordGovernanceHelpers, keywordGovernanceOverview, listBusinessKeywordTerms, normalizeKeywordTerm, reviewBusinessKeywordTerm } from "@aihot/backend/admin/keyword-governance";
import type { BusinessProfile } from "@aihot/backend/admin/business-matching";

after(async () => { await closeDb(); });

function profile(): BusinessProfile {
  return {
    schemaVersion: String(BUSINESS_PROFILE.schemaVersion),
    capabilities: BUSINESS_PROFILE.capabilities.map((item) => ({
      id: item.id, name: item.name, businessCategory: item.businessCategory, enabled: true, priority: "常规",
      description: item.description, serviceTerms: [], methodTerms: [], deliverableTerms: [], contextTerms: [],
      positiveExamples: [], negativeExamples: [], negativeKeywords: [], boundaries: [],
    })),
    contexts: BUSINESS_PROFILE.contexts,
    notes: "",
  };
}

function row(label: "relevant" | "irrelevant", score: number) {
  return {
    id: 1, article_id: "test-article", label, capability_ids: ["monitoring-integration"],
    title: "城市视频监控系统升级改造项目", excerpt: null,
    body_text: "本项目采购城市视频监控系统升级服务，提供视频监控平台及可视化告警能力，采用边缘计算技术。",
    created_by: "test",
    original_result: { output: { businessScore: { total: score }, businessMatch: { projects: [{ tasks: [{
      name: "城市视频监控系统", action: "视频监控", methods: ["边缘计算"], deliverables: ["视频监控平台", "可视化告警"],
      matches: [{ capabilityId: "monitoring-integration" }],
    }] }] } } },
  };
}

test("positive candidates keep distinct AI task phrases separate and exclude phrases already in the formal profile", () => {
  const base = profile();
  const capability = base.capabilities.find((item) => item.id === "monitoring-integration")!;
  capability.serviceTerms = ["视频监控"];
  const suggestions = keywordGovernanceHelpers.collectSuggestions({ row: row("relevant", 88), profile: base, highFloor: 60 });
  assert.equal(suggestions.length, 4);
  assert.deepEqual(suggestions.map((item) => item.term), ["城市视频监控系统", "边缘计算", "视频监控平台", "可视化告警"]);
  assert.ok(suggestions.every((item) => item.variants.length === 0));
  assert.equal(suggestions.find((item) => item.term === "边缘计算")?.role, "method");
  assert.ok(!suggestions.some((item) => item.term === "视频监控"));
  assert.equal(suggestions[0]?.kind, "positive");
});

test("negative candidates are only extracted from high-scoring false positives", () => {
  const base = profile();
  const low = keywordGovernanceHelpers.collectSuggestions({ row: row("irrelevant", 42), profile: base, highFloor: 60 });
  const high = keywordGovernanceHelpers.collectSuggestions({ row: row("irrelevant", 84), profile: base, highFloor: 60 });
  assert.deepEqual(low, []);
  assert.equal(high.length, 5);
  assert.ok(high.every((item) => item.kind === "negative" && item.role === "negative"));
});

test("accepted term groups append canonical and variant phrases to the existing AIHOT JSON fields", () => {
  const base = profile();
  const next = keywordGovernanceHelpers.appendCandidateTerms(base, [
    { kind: "positive", term: "城市视频监控系统", variants: ["视频监控平台"], role: "serviceAction", capabilityId: "monitoring-integration" },
    { kind: "negative", term: "道路照明系统", variants: ["路灯控制"], role: "negative", capabilityId: "monitoring-integration" },
  ]);
  const json = keywordGovernanceHelpers.toAihotBusinessJson(next, "test-version");
  const capability = json.capabilities.find((item) => item.id === "monitoring-integration")!;
  assert.ok(capability.semanticRoles.serviceActions.includes("城市视频监控系统"));
  assert.ok(capability.semanticRoles.serviceActions.includes("视频监控平台"));
  assert.ok(capability.reviewNegativeTerms.includes("道路照明系统"));
  assert.equal(normalizeKeywordTerm("视频 监控-系统"), normalizeKeywordTerm("视频监控系统"));
});

test("official keyword changes deactivate stale phrases and replace terms in the correct runtime field", () => {
  const base = profile();
  const capability = base.capabilities.find((item) => item.id === "monitoring-integration")!;
  capability.serviceTerms = ["旧正向词", "保留词"];
  capability.negativeKeywords = ["旧反向词"];
  const next = keywordGovernanceHelpers.applyOfficialKeywordChanges(base, [
    { kind: "positive", term: "旧正向词", capability_id: "monitoring-integration", role: "serviceAction", action: "deactivate", replacement_term: null },
    { kind: "negative", term: "旧反向词", capability_id: "monitoring-integration", role: "negative", action: "replace", replacement_term: "新反向词" },
  ]);
  const changed = next.capabilities.find((item) => item.id === "monitoring-integration")!;
  assert.deepEqual(changed.serviceTerms, ["保留词"]);
  assert.deepEqual(changed.negativeKeywords, ["新反向词"]);
});

test("keyword groups combine the same term across capabilities and keep one selected term as the publishing target", () => {
  const groups = keywordGovernanceHelpers.groupKeywordRows([
    { id: 1, kind: "positive", term: "视频监控系统", normalizedTerm: "视频监控系统", variants: ["视频监控平台"], capabilityId: "monitoring-integration", role: "serviceAction" },
    { id: 2, kind: "positive", term: "视频 监控系统", normalizedTerm: "视频监控系统", variants: ["监控系统平台"], capabilityId: "software-platform", role: "deliverable" },
    { id: 3, kind: "negative", term: "视频监控系统", normalizedTerm: "视频监控系统", variants: [], capabilityId: "monitoring-integration", role: "negative" },
  ], [2]);
  assert.equal(groups.length, 2);
  const positive = groups.find((item) => item.kind === "positive")!;
  assert.equal(positive.id, 2);
  assert.equal(positive.capabilityId, "software-platform");
  assert.deepEqual(positive.termIds, [1, 2]);
  assert.deepEqual(positive.capabilityIds, ["monitoring-integration", "software-platform"]);
  assert.deepEqual(positive.variants.sort(), ["视频监控系统", "视频监控平台", "视频 监控系统", "监控系统平台"].filter((value) => normalizeKeywordTerm(value) !== "视频监控系统").sort());
});

test("database keyword queues count same normalized terms once and review all capability duplicates together", async () => {
  const phrase = `治理聚合验证${tag()}`;
  const normalized = normalizeKeywordTerm(phrase);
  const sourceId = "keyword-group-test-" + tag();
  const before = await keywordGovernanceOverview();
  let articleId: string | undefined;
  let feedbackId: number | undefined;
  let ids: number[] = [];
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${sourceId}, 'Keyword group test', 'rss', 'T1', 'editorial', '2100-01-01')`;
  try {
    articleId = (await upsertMaterial({ sourceId, url: `https://example.invalid/${sourceId}`, title: phrase, bodyText: phrase, bodyStatus: "ok", via: "fetch" } as never)).articleId;
    const [feedback] = await sql<{ id: number }[]>`INSERT INTO business_matching_feedback (article_id, label, capability_ids, created_by)
      VALUES (${articleId}, 'relevant', ARRAY['monitoring-integration', 'software-platform'], 'keyword-governance-test') RETURNING id`;
    feedbackId = Number(feedback!.id);
    const inserted = await sql<{ id: number }[]>`
      INSERT INTO business_keyword_terms (kind, term, normalized_term, variants, capability_id, role, status)
      VALUES ('positive', ${phrase}, ${normalized}, ${[phrase + "（平台）"]}, 'monitoring-integration', 'serviceAction', 'pending'),
             ('positive', ${phrase}, ${normalized}, ${[phrase + " 系统"]}, 'software-platform', 'serviceAction', 'pending')
      RETURNING id`;
    ids = inserted.map((row) => Number(row.id));
    await sql`INSERT INTO business_keyword_candidates
      (article_id, feedback_id, kind, phrase, capability_id, role, evidence_source, evidence, created_by, term_id)
      VALUES (${articleId}, ${feedbackId}, 'positive', ${phrase}, 'monitoring-integration', 'serviceAction', 'title', ${phrase}, 'keyword-test', ${ids[0]}),
             (${articleId}, ${feedbackId}, 'positive', ${phrase}, 'software-platform', 'serviceAction', 'title', ${phrase}, 'keyword-test', ${ids[1]})`;
    const [group] = await listBusinessKeywordTerms({ status: "pending", q: phrase });
    const after = await keywordGovernanceOverview();
    assert.equal(after.pendingTerms, before.pendingTerms + 1);
    assert.equal(group?.sourceCount, 1);
    assert.deepEqual(group?.termIds.map(Number).sort(), ids.sort());
    assert.deepEqual(group?.capabilityIds.sort(), ["monitoring-integration", "software-platform"]);

    const reviewed = await reviewBusinessKeywordTerm(ids[0]!, { action: "accept" }, "keyword-test");
    assert.equal(reviewed?.status, "candidate");
    const candidateGroups = await listBusinessKeywordTerms({ status: "candidate", q: phrase });
    assert.equal(candidateGroups.length, 1);
    const statuses = await sql<{ id: number; status: string }[]>`SELECT id, status FROM business_keyword_terms WHERE id = ANY(${ids}) ORDER BY id`;
    assert.equal(statuses.filter((row) => row.status === "candidate").length, 1);
    assert.equal(statuses.filter((row) => row.status === "rejected").length, 1);
  } finally {
    if (ids.length) await sql`DELETE FROM audit_log WHERE subject = ${`business-keyword-term:${ids[0]}`}`;
    if (feedbackId) await sql`DELETE FROM business_keyword_candidates WHERE feedback_id = ${feedbackId}`;
    if (feedbackId) await sql`DELETE FROM business_matching_feedback WHERE id = ${feedbackId}`;
    if (ids.length) await sql`DELETE FROM business_keyword_terms WHERE id = ANY(${ids})`;
    if (articleId) await sql`DELETE FROM articles WHERE id = ${articleId}`;
    await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  }
});

test("orphan keyword terms without article evidence stay out of review and draft counts", async () => {
  const phrase = `无来源词条${tag()}`;
  const normalized = normalizeKeywordTerm(phrase);
  const before = await keywordGovernanceOverview();
  const [term] = await sql<{ id: number }[]>`INSERT INTO business_keyword_terms (kind, term, normalized_term, capability_id, role, status)
    VALUES ('positive', ${phrase}, ${normalized}, 'monitoring-integration', 'serviceAction', 'pending') RETURNING id`;
  try {
    const groups = await listBusinessKeywordTerms({ status: "pending", q: phrase });
    const after = await keywordGovernanceOverview();
    const reviewed = await reviewBusinessKeywordTerm(Number(term!.id), { action: "accept" }, "keyword-test");
    assert.equal(groups.length, 0);
    assert.equal(after.pendingTerms, before.pendingTerms);
    assert.equal(reviewed, null);
  } finally {
    await sql`DELETE FROM business_keyword_terms WHERE id = ${term!.id}`;
  }
});

test("keyword cluster filtering follows the sample feedback that opened the review step", async () => {
  const marker = "样本来源过滤" + tag();
  const sourceId = "keyword-sample-filter-" + tag();
  const articleIds: string[] = [];
  const feedbackIds: number[] = [];
  const termIds: number[] = [];
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${sourceId}, 'Keyword sample filter test', 'rss', 'T1', 'editorial', '2100-01-01')`;
  try {
    const sampleArticleId = (await upsertMaterial({ sourceId, url: "https://example.invalid/" + marker + "-sample", title: marker + " 本篇样本", bodyText: marker + " 词条一", bodyStatus: "ok", via: "fetch" } as never)).articleId;
    const otherArticleId = (await upsertMaterial({ sourceId, url: "https://example.invalid/" + marker + "-other", title: marker + " 其他样本", bodyText: marker + " 词条二", bodyStatus: "ok", via: "fetch" } as never)).articleId;
    articleIds.push(sampleArticleId, otherArticleId);
    const [sampleFeedback] = await sql<{ id: number }[]>`INSERT INTO business_matching_feedback (article_id, label, capability_ids, created_by)
      VALUES (${sampleArticleId}, 'relevant', ARRAY['monitoring-integration'], 'keyword-sample-filter-test') RETURNING id`;
    const [otherFeedback] = await sql<{ id: number }[]>`INSERT INTO business_matching_feedback (article_id, label, capability_ids, created_by)
      VALUES (${otherArticleId}, 'relevant', ARRAY['monitoring-integration'], 'keyword-sample-filter-test') RETURNING id`;
    feedbackIds.push(Number(sampleFeedback!.id), Number(otherFeedback!.id));
    const sampleTerm = marker + "本篇词条";
    const otherTerm = marker + "其他词条";
    const [sampleKeyword] = await sql<{ id: number }[]>`INSERT INTO business_keyword_terms (kind, term, normalized_term, capability_id, role)
      VALUES ('positive', ${sampleTerm}, ${normalizeKeywordTerm(sampleTerm)}, 'monitoring-integration', 'serviceAction') RETURNING id`;
    const [otherKeyword] = await sql<{ id: number }[]>`INSERT INTO business_keyword_terms (kind, term, normalized_term, capability_id, role)
      VALUES ('positive', ${otherTerm}, ${normalizeKeywordTerm(otherTerm)}, 'monitoring-integration', 'serviceAction') RETURNING id`;
    termIds.push(Number(sampleKeyword!.id), Number(otherKeyword!.id));
    await sql`INSERT INTO business_keyword_candidates (article_id, feedback_id, kind, phrase, capability_id, role, evidence_source, evidence, created_by, term_id)
      VALUES (${sampleArticleId}, ${sampleFeedback!.id}, 'positive', ${sampleTerm}, 'monitoring-integration', 'serviceAction', 'body', ${sampleTerm}, 'keyword-sample-filter-test', ${sampleKeyword!.id}),
             (${otherArticleId}, ${otherFeedback!.id}, 'positive', ${otherTerm}, 'monitoring-integration', 'serviceAction', 'body', ${otherTerm}, 'keyword-sample-filter-test', ${otherKeyword!.id})`;

    const all = await listBusinessKeywordTerms({ status: "pending", q: marker });
    const scoped = await listBusinessKeywordTerms({ status: "pending", q: marker, feedbackId: Number(sampleFeedback!.id) });
    assert.equal(all.length, 2);
    assert.deepEqual(scoped.map((item) => item.term), [sampleTerm]);
  } finally {
    if (feedbackIds.length) {
      await sql`DELETE FROM business_keyword_candidates WHERE feedback_id = ANY(${feedbackIds})`;
      await sql`DELETE FROM business_matching_feedback WHERE id = ANY(${feedbackIds})`;
    }
    if (termIds.length) await sql`DELETE FROM business_keyword_terms WHERE id = ANY(${termIds})`;
    if (articleIds.length) await sql`DELETE FROM articles WHERE id = ANY(${articleIds})`;
    await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  }
});
