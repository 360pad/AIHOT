import assert from "node:assert/strict";
import { test } from "node:test";
import { filterIndustryArticles, INDUSTRY_ARTICLES, markdownForArticle } from "../app/lib/industry-data.ts";

test("industry filters keep today and historical publication dates distinct", () => {
  const geologyToday = filterIndustryArticles(INDUSTRY_ARTICLES, "today", "geology", "");
  assert.equal(geologyToday.length, 3);
  assert.ok(geologyToday.every((article) => article.discoveredAt.startsWith("2026-10-13")));

  const geologyHistory = filterIndustryArticles(INDUSTRY_ARTICLES, "history", "geology", "");
  assert.deepEqual(geologyHistory.map((article) => article.id), ["geology-model"]);
  assert.equal(geologyHistory[0]?.publishedAt, "2019.01.02");
});

test("industry search matches source, title, summary and topic without changing category rules", () => {
  assert.deepEqual(filterIndustryArticles(INDUSTRY_ARTICLES, "all", "all", "GemPy").map((article) => article.id), ["geology-model"]);
  assert.deepEqual(filterIndustryArticles(INDUSTRY_ARTICLES, "all", "water", "GIS").map((article) => article.id), []);
  assert.deepEqual(filterIndustryArticles(INDUSTRY_ARTICLES, "all", "gis", "GIS").map((article) => article.id), ["supermap-3d"]);
});

test("markdown export contains traceable metadata and preserves block quotes", () => {
  const article = INDUSTRY_ARTICLES[0]!;
  const markdown = markdownForArticle(article);
  assert.match(markdown, /^# GemPy 隐式地质建模方法及其在地下空间研究中的实践/m);
  assert.match(markdown, /来源：地质/);
  assert.match(markdown, /原文发布：2019\.01\.02/);
  assert.match(markdown, /> 隐式建模通过连续函数表达地质界面/);
  assert.match(markdown, /## 核心特点对比/);
  assert.ok(markdown.endsWith("\n"));
});
