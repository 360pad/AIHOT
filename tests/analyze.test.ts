// The judging and writing steps (editorial/analyze.ts): the prefilter decides relevance and business
// score in one response; selected and near-selected items are written by the content
// understanding and the rest by the title/summary prompts, a structure step gives the category, subjects
// and fact. Material with only a feed summary has its page fetched first. The steps run on the models
// Tender Radar assigns them (set through the environment here); every prompt in the pack renders.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { processArticle, queueProcessing } from "@aihot/backend/jobs/content";
import { QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { compactAnswerFirstSummary, enforceIdentity, parseTranslateOutput, PREFILTER_SYSTEM } from "@aihot/backend/editorial/writing";
import { awardResultKeywordGate, businessKeywordClues } from "@aihot/backend/editorial/business";
import { promptText } from "@aihot/backend/editorial/prompts";
import { SITE } from "@aihot/industry/site";

const T = tag();
const SOURCE = `test-analyze-${T}`;
const X_SOURCE = `test-analyze-x-${T}`;

type Step = "prefilter" | "score" | "understand" | "summarize" | "structure";
interface Req { step: Step; marker: string; system: string; user: string; body: Record<string, any> }
const requests: Req[] = [];
const MARKERS = ["CLEAR", "RESCUE", "LOW", "OFFTOPIC", "BARE", "VAGUE", "THIN", "SENSITIVE", "DUE-HIGH", "DUE", "EXPIRED", "DEADLINE-UNKNOWN", "SEMANTIC", "ELLIPSIS", "CONFLICT", "HIGH-NO-EVIDENCE", "推文"];
const businessScore = (total: number) => {
  const taskFit = Math.min(30, total);
  const delivery = Math.min(20, Math.max(0, total - taskFit));
  const importance = Math.max(0, total - taskFit - delivery);
  return {
    taskFit: { score: taskFit, reason: "采购任务与能力的原文依据" },
    delivery: { score: delivery, reason: "交付内容的原文依据" },
    importance: { score: importance, reason: "采购范围重要性的原文依据" },
  };
};
const regionScore = { score: 10, reason: "材料未提供项目实施地，按中性分处理。" };

const stepOf = (system: string, user: string): Step =>
  system.includes("优先级评分器") ? "score" : system.includes("相关性预筛") ? "prefilter"
  : system.includes("项目情报编辑") ? "understand" : system.includes("资料结构化助手") ? "structure"
  : user.includes("title_zh") ? "summarize" : (() => { throw new Error("unknown request"); })();

// One stub stands in for the configured model providers.
const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: unknown }> } & Record<string, any>;
  const system = body.messages[0]!.role === "system" ? String(body.messages[0]!.content) : "";
  const last = body.messages[body.messages.length - 1]!.content;
  const user = typeof last === "string" ? last : JSON.stringify(last);
  const step = stepOf(system, user);
  const marker = MARKERS.find((m) => user.includes(m)) ?? "";
  requests.push({ step, marker, system, user, body });
  const answer = (content: unknown) => ({ id: `stub-${requests.length}`, model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  if (step === "prefilter" && marker === "SEMANTIC") return answer({
    label: "PASS", reason: "公告表达与三维建模能力语义相符。",
    businessScore: businessScore(52), regionScore, deadlineStatus: "open",
    materialCoverage: { status: "partial", sectionsRead: ["标题"], missing: ["采购需求正文"], notes: "标题已明确本次任务。" },
    projects: [{ id: "p1", name: "隐式地质曲面重建与成果入库采购", number: null, lots: [], evidenceIds: ["e1"], tasks: [{
      id: "p1-t1", name: "隐式地质曲面重建与成果入库", lot: null, action: "重建并入库", object: "地质曲面", methods: [], deliverables: ["成果数据"],
      purchaseRole: "principal", participation: "standalone", evidenceIds: ["e1"], matches: [{ capabilityId: "three-dimensional-modeling", relation: "direct", rationale: "属于三维地质建模成果。", evidenceIds: ["e1"] }],
    }] }], contexts: ["mining"], organizations: [],
    evidence: [{ id: "e1", quote: "隐式地质曲面重建与成果入库", source: "title", location: null, strength: "explicit" }], missingInformation: ["采购需求正文"],
  });
  if (step === "prefilter" && marker === "ELLIPSIS") return answer({
    label: "PASS", reason: "堤防隐患探测与企业能力相符。",
    businessScore: businessScore(54), regionScore, deadlineStatus: "open",
    materialCoverage: { status: "complete", sectionsRead: ["标题", "正文"], missing: [], notes: "" },
    projects: [{ id: "p1", name: "扬州市1-3级堤防第一批隐患探测项目", number: null, lots: [], evidenceIds: ["e1"], tasks: [{
      id: "p1-t1", name: "堤防隐患探测", lot: null, action: "采购", object: "堤防", methods: ["探地雷达法"], deliverables: ["隐患探测成果"],
      purchaseRole: "principal", participation: "standalone", evidenceIds: ["e1"], matches: [{ capabilityId: "three-dimensional-modeling", relation: "direct", rationale: "测试证据匹配。", evidenceIds: ["e1"] }],
    }] }], contexts: [], organizations: [],
    evidence: [{ id: "e1", quote: "扬州市1-3级堤防第一批隐患探测项目……主要采用探地雷达法", source: "body", location: null, strength: "explicit" }], missingInformation: [],
  });
  if (step === "prefilter" && marker === "CONFLICT") return answer({
    label: "UNKNOWN", reason: "模型标签与同一任务匹配结果暂不一致。", businessScore: businessScore(52), regionScore, deadlineStatus: "open",
    materialCoverage: { status: "partial", sectionsRead: ["标题"], missing: ["采购需求正文"], notes: "标题已说明任务。" },
    projects: [{ id: "p1", name: "三维模型采购", number: null, lots: [], evidenceIds: ["e1"], tasks: [{
      id: "p1-t1", name: "三维建模", lot: null, action: "建模", object: "三维模型", methods: [], deliverables: ["模型成果"],
      purchaseRole: "principal", participation: "standalone", evidenceIds: ["e1"], matches: [{ capabilityId: "three-dimensional-modeling", relation: "direct", rationale: "采购任务直接包含三维建模。", evidenceIds: ["e1"] }],
    }] }], contexts: [], organizations: [], evidence: [{ id: "e1", quote: "CONFLICT model release", source: "title", location: null, strength: "explicit" }], missingInformation: [],
  });
  if (step === "prefilter") {
    const label = marker === "OFFTOPIC" || marker === "BARE" || marker === "HIGH-NO-EVIDENCE" ? "BLOCK" : marker === "VAGUE" ? "UNKNOWN" : "PASS";
    const totals: Record<string, number> = { CLEAR: 55, RESCUE: 42, LOW: 25, THIN: 55, SENSITIVE: 55, 推文: 40, BARE: 0, VAGUE: 20, DUE: 55, "DUE-HIGH": 60, EXPIRED: 55, "DEADLINE-UNKNOWN": 60, "HIGH-NO-EVIDENCE": 52 };
    const deadlineStatus = marker === "DUE" || marker === "DUE-HIGH" ? "due_soon" : marker === "EXPIRED" ? "passed" : marker === "BARE" || marker === "DEADLINE-UNKNOWN" ? "unknown" : "open";
    return answer({
      label, reason: "测试", businessScore: businessScore(totals[marker] ?? 0), regionScore, deadlineStatus,
      materialCoverage: { status: "partial", sectionsRead: ["标题"], missing: [], notes: "" },
      projects: label === "PASS" ? [{ id: "p1", name: "测试采购任务", number: null, lots: [], evidenceIds: ["e1"], tasks: [{
        id: "p1-t1", name: "模型技术采购", lot: null, action: "采购", object: "模型技术", methods: [], deliverables: [],
        purchaseRole: "principal", participation: "standalone", evidenceIds: ["e1"], matches: [{ capabilityId: "three-dimensional-modeling", relation: "direct", rationale: "stub", evidenceIds: ["e1"] }],
      }] }] : [],
      evidence: label === "PASS" ? [{ id: "e1", quote: "model release", source: "title", location: null, strength: "explicit" }] : [],
    });
  }
  if (step === "score") throw new Error("legacy independent score must not run in current analysis");
  if (step === "understand") {
    if (marker === "SENSITIVE") return new Reply(400, { contentFilter: [{ level: 1, role: "user" }], error: { code: "1301", message: "系统检测到输入或生成内容可能包含不安全或敏感内容" } });
    return answer({ itemType: "tender_notice", authorRole: "principal", tags: ["城市治理与数字政府", "招标公告", "不存在的标签"], editorialJudgment: `理由 ${marker}`, titleZh: `理解标题 ${marker}`, summaryZh: `理解摘要 ${marker}。第二句补充一个关键数字。` });
  }
  if (step === "structure") return answer({ category: "digital-government", tags: ["城市治理与数字政府", "招标公告"], subjects: [], fact: { title: `事实 ${marker}`, subject: "某单位", action: "发布招标公告", object: "数字化项目", occurredAt: null } });
  return answer(`title_zh: 翻译标题 ${marker}\nsummary_zh: 翻译摘要 ${marker}。第二句补充影响。`);
});
for (const env of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[env] = `${provider.url}/v1`;
for (const env of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[env] = "test-key";
// Tender Radar's assignment of models to steps (the open-source default is one model for all of them).
Object.assign(process.env, { PREFILTER_MODEL: "qwen3.7-flash", SCORE_MODEL: "glm-5.3-flash-selection", UNDERSTAND_MODEL: "glm-5.3-flash", SUMMARIZE_MODEL: "deepseek-flash", STRUCTURE_MODEL: "qwen3.8-flash" });

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES
    (${SOURCE}, 'Test analyze source', 'rss', 'T1', 'editorial', '2100-01-01'),
    (${X_SOURCE}, 'Test X account', 'x_search', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

// The tag keeps each material unique: identical input would reuse an earlier run's paid answers.
const LONG = "a lab released a model with a benchmark table and pricing details. ".repeat(8);
const article = async (marker: string, extra: Record<string, unknown> = {}) =>
  (await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${marker}-${T}`, title: `${marker} model release ${T}`, bodyText: `${marker}: ${LONG} (${T})`,
    bodyStatus: "ok", via: "fetch", publishedAt: new Date("2026-09-28T01:02:03Z"), ...extra,
  } as never)).articleId;
const calls = (marker: string) => requests.filter((r) => r.marker === marker).map((r) => r.step);
const row = async (id: string) =>
  (await sql<{ selected: boolean; relevance: string; score: string | null; title_zh: string; reason_zh: string | null; category: string | null; tags: string[]; subjects: string[]; receipt_ids: string[]; output: Record<string, any> }[]>`
    SELECT selected, relevance, score, title_zh, reason_zh, category, tags, subjects, receipt_ids, output FROM analyses WHERE article_id = ${id} ORDER BY id DESC LIMIT 1`)[0]!;

test("every prompt in the pack renders, and the site's name replaces the template", () => {
  const dir = new URL("../industry/prompts/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  // Every value any prompt asks for, so each renders on its own.
  const names = new Set(files.flatMap((f) => [...readFileSync(new URL(f, dir), "utf8").matchAll(/\{\{\s*([A-Za-z][\w.-]*)\s*\}\}/g)].map((m) => m[1]!)));
  const values = Object.fromEntries([...names].map((n) => [n, "x"]));
  for (const file of files) {
    const text = promptText(file.slice(0, -3), values);
    assert.ok(text.length > 20 && !/\{\{/.test(text), file);
  }
  assert.ok(PREFILTER_SYSTEM.startsWith(`为 ${SITE.name} 做企业能力相关性预筛`));
});

test("the same prefilter response provides a 70/20/10 composite score and selection result", async () => {
  const id = await article("CLEAR");
  const res = await analyzeArticle(id);
  assert.deepEqual([res!.output!.selected, res!.output!.score, res!.output!.threshold], [true, 75, 75]);
  assert.deepEqual(res!.output!.businessScore.total, 55);
  assert.equal(res!.output!.businessScore.dimensions.taskFit.reason, "采购任务与能力的原文依据");
  assert.deepEqual(calls("CLEAR").sort(), ["prefilter", "structure", "understand"]);
  const r = await row(id);
  assert.deepEqual([r.title_zh, r.reason_zh, r.category, r.receipt_ids.length], ["理解标题 CLEAR", "理由 CLEAR", "digital-government", 3]);
  assert.deepEqual(r.tags, ["城市治理与数字政府", "招标公告"], "vocabulary tags (unknown tags dropped and category kept first)");
  assert.deepEqual(r.subjects, []);
  assert.deepEqual([r.output.writer, r.output.itemType, r.output.prefilter.label, r.output.fact.title], ["understand", "tender_notice", "PASS", "事实 CLEAR"]);
  const understand = requests.find((q) => q.marker === "CLEAR" && q.step === "understand")!;
  assert.ok(understand.user.startsWith("请按系统规则理解以下单篇材料，一次返回全部六个字段。"));
  assert.ok(understand.system.includes("【摘要答案前置规则") && understand.system.includes("【标题自洽规则"));
  const prefilter = requests.find((q) => q.marker === "CLEAR" && q.step === "prefilter")!;
  assert.ok(JSON.parse(prefilter.user).includes("【材料质量】"), "the material context, sent as a JSON string");
});

test("a below-threshold but reviewable item keeps its task judgement; low score uses the light summary", async () => {
  const near = await analyzeArticle(await article("RESCUE"));
  assert.deepEqual([near!.output!.selected, near!.output!.score, near!.output!.reasonZh], [false, 62, "理由 RESCUE"]);
  const lowId = await article("LOW");
  const low = await analyzeArticle(lowId);
  assert.deepEqual([low!.output!.selected, low!.output!.titleZh, low!.output!.reasonZh], [false, "翻译标题 LOW", null]);
  assert.deepEqual(calls("LOW").sort(), ["prefilter", "structure", "summarize"]);
  const summarize = requests.find((q) => q.marker === "LOW" && q.step === "summarize")!;
  assert.equal(summarize.body.messages.length, 1, "the title/summary prompt is one user message");
  assert.equal(summarize.body.response_format, undefined, "answered in its own text format");
  assert.deepEqual((await row(lowId)).tags, ["城市治理与数字政府", "招标公告"], "structure tags");
});

test("a PASS procurement intention above threshold remains selected when its deadline is unknown", async () => {
  const id = await article("DEADLINE-UNKNOWN");
  assert.deepEqual(await processArticle(id), { state: "pass" });
  const analysis = await row(id);
  const [publication] = await sql<{ selected: boolean; eligible: boolean; score: number }[]>`SELECT selected, eligible, score FROM publications WHERE article_id = ${id}`;
  assert.deepEqual([analysis.relevance, analysis.output.deadlineStatus, analysis.score, analysis.output.threshold, analysis.selected], ["pass", "unknown", 75, 75, true]);
  assert.deepEqual(publication, { selected: true, eligible: true, score: 75 });
});

test("BLOCK leaves no article or AI result behind; UNKNOWN remains pending", async () => {
  const offId = await article("OFFTOPIC");
  const off = await analyzeArticle(offId);
  assert.deepEqual([off!.analysisId, off!.output!.relevance, off!.output!.selected], [null, "block", false]);
  assert.deepEqual(calls("OFFTOPIC"), ["prefilter"]);
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${offId}`).length, 0);
  assert.equal((await sql`SELECT id FROM analyses WHERE article_id = ${offId}`).length, 0);
  const [receipt] = await sql<{ subject: string | null; request: unknown; response: unknown; status: string }[]>`SELECT subject, request, response, status FROM receipts WHERE id = ${off!.receiptIds[0]}`;
  assert.deepEqual(receipt, { subject: null, request: null, response: null, status: "completed" });
  const [attempt] = await sql<{ total_tokens: number }[]>`SELECT (usage->>'total_tokens')::int AS total_tokens FROM receipt_attempts WHERE receipt_id = ${off!.receiptIds[0]}`;
  assert.equal(attempt?.total_tokens, 15, "request usage remains available for cost accounting");
  const queuedId = await article("OFFTOPIC-QUEUE");
  assert.deepEqual(await processArticle(queuedId), { state: "discarded" });
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${queuedId}`).length, 0);
  // An UNKNOWN with material can still be scored and written for diagnosis, but never becomes public relevance PASS.
  const vagueId = await article("VAGUE");
  const vague = await analyzeArticle(vagueId);
  assert.deepEqual([vague!.output!.relevance, vague!.output!.selected, vague!.output!.titleZh], ["unknown", false, "理解标题 VAGUE"]);
  assert.equal((await row(vagueId)).output.prefilter.label, "UNKNOWN", "the prefilter's own answer stays on record");
  // Nothing but a title and no page to fetch: the BLOCK counts as UNKNOWN and is scored, but the
  // translation writes nothing from a bare title, so it waits for material instead of being published.
  const bare = await analyzeArticle(await article("BARE", { bodyText: null, excerpt: null, bodyStatus: "none" }));
  assert.deepEqual([bare!.output!.relevance, bare!.output!.selected, bare!.output!.score], ["unknown", false, 15]);
  assert.deepEqual(calls("BARE").sort(), ["prefilter", "structure"]);
});

test("award-result notices bypass AI and remain references only when positive business keywords hit", async () => {
  const before = requests.length;
  const matchedId = await article("AWARD-MATCH", {
    title: `2026年档案扫描项目中标候选人公示 ${T}`,
    excerpt: "档案扫描项目中标候选人公示。",
    bodyText: "本项目采购档案扫描、数字化加工及数据交付。",
  });
  assert.deepEqual(awardResultKeywordGate({
    title: `2026年档案扫描项目中标候选人公示 ${T}`, excerpt: null, bodyText: null,
  }).matched, true);
  assert.deepEqual(await processArticle(matchedId), { state: "keyword-reference" });
  assert.equal(requests.length, before, "no AI provider calls are made for award-result notices");
  assert.equal((await sql`SELECT id FROM analyses WHERE article_id = ${matchedId}`).length, 0, "no AI score or review row is created");
  const [reference] = await sql<{ eligible: boolean; selected: boolean; score: number | null; tags: string[]; summary: string | null }[]>`
    SELECT eligible, selected, score, tags, summary FROM publications WHERE article_id = ${matchedId}`;
  assert.deepEqual(reference, { eligible: true, selected: false, score: null, tags: ["中标及结果"], summary: "本项目采购档案扫描、数字化加工及数据交付。" });

  const unmatchedId = await article("AWARD-NO-MATCH", {
    title: `学校食堂外包项目成交公告 ${T}`,
    excerpt: "学校食堂外包服务成交公告。",
    bodyText: "采购食堂餐饮和保洁服务。",
  });
  assert.deepEqual(awardResultKeywordGate({
    title: `学校食堂外包项目成交公告 ${T}`, excerpt: "学校食堂外包服务成交公告。", bodyText: "采购食堂餐饮和保洁服务。",
  }).matched, false);
  assert.deepEqual(await processArticle(unmatchedId), { state: "discarded" });
  assert.equal(requests.length, before, "unmatched results also bypass AI");
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${unmatchedId}`).length, 0, "unmatched result notices are discarded");
  assert.equal((await sql`SELECT article_id FROM publications WHERE article_id = ${unmatchedId}`).length, 0);
});

test("semantic task evidence can PASS without any literal keyword clue", async () => {
  const title = "隐式地质曲面重建与成果入库采购";
  const id = await article("SEMANTIC", { title });
  assert.deepEqual(businessKeywordClues({ title, bodyText: "", excerpt: null }), []);
  const result = await analyzeArticle(id);
  assert.equal(result!.output!.relevance, "pass");
  assert.equal(result!.output!.businessMatch.evidence[0]?.verified, true);
  const request = requests.find((item) => item.marker === "SEMANTIC" && item.step === "prefilter")!;
  assert.match(request.user, /未命中配置词语，仍须做语义判断/);
});

test("verified task evidence reconciles an inconsistent UNKNOWN label; high score without evidence stays for review", async () => {
  const matched = await analyzeArticle(await article("CONFLICT"));
  assert.deepEqual([matched!.output!.relevance, matched!.output!.selected, matched!.output!.score], ["pass", false, 72]);
  const uncertainId = await article("HIGH-NO-EVIDENCE");
  const uncertain = await analyzeArticle(uncertainId);
  assert.deepEqual([uncertain!.analysisId !== null, uncertain!.output!.relevance, uncertain!.output!.score], [true, "unknown", 72]);
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${uncertainId}`).length, 1, "high score without task evidence must not be discarded as BLOCK");
});

test("ellipsis-compressed evidence verifies ordered source fragments instead of downgrading PASS", async () => {
  const title = "扬州市1-3级堤防第一批隐患探测项目采购意向";
  const bodyText = "ELLIPSIS：扬州市1-3级堤防第一批隐患探测项目，主要采用探地雷达法、瞬变电磁法开展探测。";
  const result = await analyzeArticle(await article("ELLIPSIS", { title, bodyText }));
  assert.equal(result!.output!.relevance, "pass");
  assert.equal(result!.output!.businessMatch.evidence[0]?.verified, true);
});

test("near-deadline opportunities use the reduced time score, while passed opportunities are discarded", async () => {
  const due = await analyzeArticle(await article("DUE"));
  assert.deepEqual([due!.output!.relevance, due!.output!.deadlineStatus, due!.output!.selected], ["pass", "due_soon", false]);
  const highDue = await analyzeArticle(await article("DUE-HIGH"));
  assert.deepEqual([highDue!.output!.relevance, highDue!.output!.deadlineStatus, highDue!.output!.score, highDue!.output!.selected], ["pass", "due_soon", 75, true]);
  const expiredId = await article("EXPIRED");
  const expired = await analyzeArticle(expiredId);
  assert.deepEqual([expired!.analysisId, expired!.output!.relevance], [null, "block"]);
  assert.deepEqual(calls("EXPIRED"), ["prefilter"], "expired opportunities stop after the deadline and relevance prefilter");
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${expiredId}`).length, 0, "expired opportunities are discarded before scoring or publication");
});

test("an explicit expired submission deadline is discarded before any AI call", async () => {
  const id = await article("EXPLICIT-CUTOFF", {
    title: `2026年安徽省部分高速公路建设项目档案管理咨询服务项目（二次） ${T}`,
    bodyText: "投标截止时间为2026年10月10日10时。服务范围包含档案收集、整理和归档。",
  });
  const before = requests.length;
  assert.deepEqual(await processArticle(id), { state: "expired" });
  assert.equal(requests.length, before, "an expired notice does not consume an AI call");
  assert.equal((await sql`SELECT id FROM articles WHERE id = ${id}`).length, 0);
  assert.equal((await sql`SELECT id FROM analyses WHERE article_id = ${id}`).length, 0);
});

test("a feed summary alone: the article page is fetched first, then the whole article is judged", async () => {
  const id = await article("THIN", { bodyText: null, bodyStatus: "pending", excerpt: `THIN: a short feed summary (${T}).` });
  // The queue sends it to extraction although its source does not ask for full text (the safety net
  // does the same after a failed fetch, so extraction failures add up to "unconfirmed" and end).
  await queueProcessing(id);
  const [job] = await sql<{ name: string }[]>`SELECT name FROM pgboss.job WHERE data->>'articleId' = ${id}`;
  assert.equal(job?.name, QUEUES.extractBody);
  const first = await analyzeArticle(id);
  assert.deepEqual([first!.needsBody, first!.output], [true, null]);
  assert.deepEqual(calls("THIN"), [], "no model call before the page");
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id = ${id}`).length, 0, "nothing committed");
  // What extraction does: the body lands as a new revision.
  await sql`UPDATE articles SET body_text = ${`THIN: ${LONG} (${T}) full page`}, body_status = 'ok', revision = revision + 1 WHERE id = ${id}`;
  const second = await analyzeArticle(id);
  assert.deepEqual([second!.needsBody ?? false, second!.output!.selected], [false, true]);
});

test("a short post in Chinese is its own copy; a content-filter refusal is translated instead", async () => {
  // The tag rides as a hashtag, which the language check strips.
  const text = `推文：今天把智能体接进了工作流，效果不错。#t${T}`;
  const { articleId } = await upsertMaterial({
    sourceId: X_SOURCE, url: `https://x.com/test/status/1${Date.now()}`, title: text, via: "fetch", publishedAt: new Date(),
    xPost: { tweetId: `1${Date.now()}`, authorName: "测试", handle: "test", text },
  });
  const post = await analyzeArticle(articleId);
  assert.deepEqual([post!.output!.titleZh, post!.output!.summaryZh], [text, text]);
  assert.ok(!calls("推文").includes("summarize"), "no translation call");
  const sensitive = await analyzeArticle(await article("SENSITIVE"));
  assert.deepEqual([sensitive!.output!.selected, sensitive!.output!.titleZh], [true, "翻译标题 SENSITIVE"]);
  assert.deepEqual(calls("SENSITIVE").filter((s) => s === "understand" || s === "summarize"), ["understand", "summarize"]);
});

test("identity guards follow the configured entity vocabulary; long summaries are cut at sentences", () => {
  const input = { title: "某实验室发布新模型", text: "某实验室发布了一个新模型，参数规模和价格都有说明。", sourceKind: "rss" };
  const guarded = enforceIdentity(input, { titleZh: "OpenAI 发布新模型", summaryZh: "某实验室发布新模型。" });
  assert.deepEqual([guarded.titleZh, guarded.summaryZh, guarded.identityGuard.outcome], ["OpenAI 发布新模型", "某实验室发布新模型。", "pass"]);
  // This industry pack has no configured entity lexicon, so named entities are not rewritten.
  const alibaba = { title: "Alibaba ships a new coding model", text: "Alibaba released a coding model with pricing details.", sourceKind: "rss" };
  assert.equal(enforceIdentity(alibaba, { titleZh: "阿里巴巴发布编程模型", summaryZh: "阿里巴巴发布了编程模型并公布价格。" }).identityGuard.outcome, "pass");
  const long = "第一句交代了谁做了什么以及关键结果，这一句本身已经足够说明核心事件的来龙去脉。".repeat(3) + "第二句补充数字。".repeat(20);
  assert.ok(compactAnswerFirstSummary(long).length <= 190);
  assert.deepEqual(parseTranslateOutput("title_zh: 标题\nsummary_zh: 第一句。\n第二句。"), { titleZh: "标题", summaryZh: "第一句。\n第二句。", bodyZh: "" });
  assert.equal(parseTranslateOutput("title_zh: 标题\nbody_zh: 我们懂你。\n\n来源：X：PixVerse (@PixVerse)").bodyZh, "我们懂你。", "a repeated prompt line is dropped");
});

test("analysing the same revision again reuses every paid answer", async () => {
  const id = await article("CLEAR", { url: `https://example.com/CLEAR-again-${T}`, title: `CLEAR model release again ${T}` });
  const first = await analyzeArticle(id);
  assert.equal(first!.reused, false);
  const hits = provider.hits();
  const again = await analyzeArticle(id);
  assert.equal(provider.hits(), hits, "no new requests");
  assert.deepEqual([again!.reused, again!.receiptIds], [true, first!.receiptIds]);
});
