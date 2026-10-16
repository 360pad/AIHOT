import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { config } from "@aihot/backend/config";
import { isEmptyContractTemplate, articleText } from "@aihot/backend/content/quality";
import { extractFromUrl } from "@aihot/backend/content/extract";
import { buildMaterial, type AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { buildScoreInput } from "@aihot/backend/editorial/analyze";
import { contentRetryDelayMinutes } from "@aihot/backend/jobs/content";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { missingEvidence, PREFILTER_SYSTEM, renderContext } from "@aihot/backend/editorial/writing";

const template = `发布：江苏政府采购网 发布时间：一、合同编号：二、合同名称：三、项目编号(或招标编号)：四、项目名称：五、合同主体 采购人（甲方）：地址：联系方式：供应商（乙方）：地址：联系方式：六、合同主要信息 主要标的信息：规格型号（或服务要求）：主要标的数量：主要标的单价：合同金额：履约期限、地点等简要信息：采购方式：七、合同签订日期：八、合同公告日期：九、其他补充事宜：`.repeat(2);
const excerpt = "项目概况：武进排水许可及河道排口巡查服务，预算 180 万元，投标截止 2026-10-20，开标时间 2026-11-06 14:00。";
const article: AnalyzeInputArticle = {
  id: "article-quality-test", revision: 2, title: "武进排水许可及河道排口巡查服务采购公告", url: "https://example.org/tender",
  author: null, publishedAt: null, discoveredAt: null, bodyText: template, excerpt, bodyStatus: "ok", xPost: null, media: [], translationZh: null,
  source: { name: "江苏政府采购网", kind: "web_list", tier: "T1", firstParty: true, fetchesBody: true },
};

test("an empty government contract template is rejected in favor of the actual tender summary", () => {
  assert.equal(isEmptyContractTemplate(template), true);
  assert.equal(articleText(template, excerpt), excerpt);
  assert.ok(buildMaterial(article).includes(excerpt));
  assert.doesNotMatch(buildMaterial(article), /合同编号/);
  assert.match(buildScoreInput(article), /预算 180 万元/);
  assert.doesNotMatch(buildScoreInput(article), /合同编号/);
  assert.match(renderContext(article), /网页返回合同空模板，已忽略/);
  assert.match(renderContext(article), /投标截止 2026-10-20/);
  assert.doesNotMatch(renderContext(article), /合同编号/);
});

test("a contract template without a real summary counts as missing evidence", () => {
  const bare = { ...article, excerpt: null };
  assert.equal(articleText(bare.bodyText, bare.excerpt), null);
  assert.equal(missingEvidence(bare), true);
  assert.match(renderContext(bare), /无有效正文（网页只返回合同空模板）/);
});

test("a specific title remains a business lead when procurement details are missing", () => {
  assert.match(PREFILTER_SYSTEM, /具体采购对象及专业动作、方法或交付成果/);
  assert.match(PREFILTER_SYSTEM, /地下管线三维探测及可视化建库服务/);
  assert.match(PREFILTER_SYSTEM, /未读内容标记为缺失/);
});

test("HTTP 402 gets one delayed retry, then stops to avoid a repeated billing loop", () => {
  const paymentError = new ProviderRejectedError("HTTP 402: Insufficient Balance", 402, true);
  assert.equal(contentRetryDelayMinutes(paymentError, 1), 15);
  assert.equal(contentRetryDelayMinutes(paymentError, 2), null);
  assert.equal(contentRetryDelayMinutes(new ProviderRejectedError("HTTP 403", 403, false), 1), null);
});

test("a template response is not saved as a confirmed article body and does not trigger Jina", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<html><body><article><h1>采购合同</h1><p>${template}</p></article></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  config.allowPrivateNetworkFetch = true;
  try {
    const result = await extractFromUrl(`http://127.0.0.1:${address.port}/contract`, { allowJina: false, subject: "test-contract-template" });
    assert.equal(result, null);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
