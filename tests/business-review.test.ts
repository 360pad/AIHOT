import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSINESS_PROFILE, businessKeywordClues, businessNegativeKeywordClues } from "@aihot/backend/editorial/business";
import type { AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { renderContext } from "@aihot/backend/editorial/writing";

test("the manual-review keyword lane exposes positive hits and exact negative hits separately", () => {
  const relevant = { title: "地下管线测量及空间数据建库服务", bodyText: "空间数据成果交付", excerpt: null };
  const positive = businessKeywordClues(relevant, BUSINESS_PROFILE);
  assert.ok(positive.some((hit) => hit.term === "空间数据" || hit.term === "地下管线测量"));
  assert.deepEqual(businessNegativeKeywordClues(relevant, BUSINESS_PROFILE), []);

  const excluded = { title: "采购体温测量仪", bodyText: "", excerpt: null };
  const negative = businessNegativeKeywordClues(excluded, BUSINESS_PROFILE);
  assert.ok(negative.some((hit) => hit.term === "采购体温测量仪"));
  assert.deepEqual(businessKeywordClues(excluded, BUSINESS_PROFILE), [], "non-spatial measurement terms must not create a business hit");
});

test("a standalone generic 工程 term is not a business hit, while 工程测量 remains specific", () => {
  const generic = businessKeywordClues({ title: "工程", bodyText: "", excerpt: null }, BUSINESS_PROFILE);
  assert.equal(generic.some((hit) => hit.term === "工程"), false);

  const specific = businessKeywordClues({ title: "工程测量", bodyText: "", excerpt: null }, BUSINESS_PROFILE);
  assert.ok(specific.some((hit) => hit.term === "工程测量"));
});

test("the profile uses four business categories, unique positive terms, and the unchanged industry context", () => {
  const categories = new Set(BUSINESS_PROFILE.capabilities.map((capability) => capability.businessCategory));
  assert.deepEqual(categories, new Set(["software", "archives", "modeling", "surveying"]));
  assert.ok(BUSINESS_PROFILE.capabilities.some((capability) => capability.id === "three-dimensional-modeling"));
  assert.ok(BUSINESS_PROFILE.capabilities.every((capability) => capability.semanticRoles.methods.length === 0 && capability.semanticRoles.deliverables.length === 0));

  const terms = BUSINESS_PROFILE.capabilities.flatMap((capability) => capability.semanticRoles.serviceActions);
  assert.equal(new Set(terms).size, terms.length, "each positive keyword should have one home in the profile");
  assert.equal(terms.some((term) => ["服务平台", "公共服务平台", "工程", "望江"].includes(term)), false);
  assert.equal(terms.some((term) => ["迭代", "平台", "服务", "项目", "平台建设", "平台运维", "管理平台", "运维服务", "项目管理", "项目申报"].includes(term)), false);
  assert.deepEqual(BUSINESS_PROFILE.contexts.map((context) => context.id), [
    "water", "mining", "government", "construction", "natural-resources", "archives", "culture-tourism",
  ]);
  assert.deepEqual(BUSINESS_PROFILE.matchingRules, {
    industryIsContext: true,
    keywordsAreHints: true,
    requireSameTaskEvidence: true,
    allowSemanticMatchWithoutKeyword: true,
    unknownNeverBecomesPassFromWriting: true,
    incidentalObligationIsNotIndependentOpportunity: true,
  });
});

test("generic source boilerplate and unrelated service notices do not create positive business hits", () => {
  const cases = [
    {
      title: "和县经济开发区2026-2028年食堂服务外包项目采购公告",
      bodyText: "小马易采数智阳光交易服务平台发布采购公告。",
    },
    {
      title: "马鞍山市文化和旅游局文印品配送服务采购公告",
      bodyText: "通过交易服务平台发布，配送文印用品。",
    },
    {
      title: "2026年博望区环保顾问服务项目（第二次）采购公告",
      bodyText: "本项目采购环保顾问服务，通过交易服务平台发布。",
    },
    {
      title: "日常运行保障及平台建设服务采购公告",
      bodyText: "采购内容还提及平台升级迭代及项目管理。",
    },
  ];
  for (const article of cases) {
    assert.deepEqual(businessKeywordClues({ ...article, excerpt: null }, BUSINESS_PROFILE), [], article.title);
  }
});

test("water construction is an exclusion clue while water safety monitoring is a positive business clue", () => {
  const construction = { title: "水利工程施工项目招标公告", bodyText: "仅包含土建施工和施工总承包。", excerpt: null };
  assert.ok(businessNegativeKeywordClues(construction, BUSINESS_PROFILE).some((hit) => hit.term === "水利工程施工"));
  assert.deepEqual(businessKeywordClues(construction, BUSINESS_PROFILE), []);

  const monitoring = { title: "水利工程安全监测系统建设项目", bodyText: "采购大坝安全监测系统及监测数据服务。", excerpt: null };
  assert.ok(businessKeywordClues(monitoring, BUSINESS_PROFILE).some((hit) => hit.term === "水利工程安全监测"));
});

test("archive, modeling, and surveying words still locate the four main service lines", () => {
  const samples = [
    [{ title: "档案扫描与数字化加工服务", bodyText: "", excerpt: null }, "档案扫描"],
    [{ title: "CIM模型建设及三维建模服务", bodyText: "", excerpt: null }, "CIM模型"],
    [{ title: "地下管线测量服务", bodyText: "", excerpt: null }, "地下管线测量"],
  ] as const;
  for (const [article, term] of samples) {
    assert.ok(businessKeywordClues(article, BUSINESS_PROFILE).some((hit) => hit.term.toLocaleLowerCase() === term.toLocaleLowerCase()), term);
  }
});

test("the new procurement terms locate their intended service lines without making generic platform wording a hit", () => {
  const cases = [
    ["安庆市智慧住建综合管理平台运维项目", "government-digital-governance", "智慧住建"],
    ["一体化平台建设", "software-platform", "一体化平台"],
    ["堤防隐患探测", "monitoring-integration", "隐患探测"],
    ["堤防安全隐患探查", "monitoring-integration", "隐患探查"],
    ["测绘服务", "surveying-spatial-data", "测绘"],
  ] as const;
  for (const [title, capabilityId, term] of cases) {
    assert.ok(businessKeywordClues({ title, bodyText: "", excerpt: null }, BUSINESS_PROFILE)
      .some((hit) => hit.capabilityId === capabilityId && hit.term === term), title);
  }
  assert.deepEqual(businessKeywordClues({ title: "平台", bodyText: "", excerpt: null }, BUSINESS_PROFILE), []);
});

test("future prefilter prompts include human labels as similar examples without replacing article evidence", () => {
  const article: AnalyzeInputArticle = {
    id: "review-sample", revision: 1, title: "水库三维测绘服务", url: "https://example.org/tender", author: null,
    publishedAt: null, discoveredAt: null, bodyText: "采购水库三维测绘及成果建库服务。", excerpt: null, bodyStatus: "ok", xPost: null, media: [], translationZh: null,
    source: { name: "测试信源", kind: "web_list", tier: "T1", firstParty: true },
  };
  const context = renderContext(article, { businessProfile: BUSINESS_PROFILE, calibrationExamples: [
    { articleId: "human-labeled-1", title: "人工标注的水库测绘项目", label: "relevant", capabilityIds: ["surveying-spatial-data"] },
  ] });
  assert.match(context, /相似文章的历史人工标注/);
  assert.match(context, /人工标注的水库测绘项目/);
  assert.match(context, /humanLabel.*相关/);
  assert.match(context, /【正文】[\s\S]*采购水库三维测绘及成果建库服务/);
});
