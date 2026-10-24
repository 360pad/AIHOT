import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { config as runtimeConfig } from "@aihot/backend/config";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { enrichJsonDetails, fetchJsonList } from "@aihot/backend/sources/json-list";

test("JSON list detail API expands procurement-intent rows without re-fetching known entries", async () => {
  runtimeConfig.allowPrivateNetworkFetch = true;
  const requestedIds: string[] = [];
  const intentServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: [
        { id: "yangzhou", title: "扬州市采购意向公告", summary: "采购意向批次", publishDate: "2026-10-15" },
        { id: "wuxi", title: "无锡市采购意向公告", summary: "采购意向批次", publishDate: "2026-10-15" },
      ] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const id = new URLSearchParams(Buffer.concat(chunks).toString()).get("ggid") ?? "";
    requestedIds.push(id);
    const project = id === "yangzhou" ? "扬州市1-3级堤防第一批隐患探测项目" : "无锡市2-3级堤防隐患探测（2026-2027年度）";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { summary: "采购意向批次", content: `<table><tr><td>${project}</td><td>预算243万元</td></tr></table>` } }));
  });
  await new Promise<void>((resolve) => intentServer.listen(0, "127.0.0.1", () => resolve()));
  const base = `http://127.0.0.1:${(intentServer.address() as { port: number }).port}`;
  const sourceConfig = {
    url: `${base}/list`, itemsPath: "result", titlePaths: ["title"], summaryPaths: ["summary"],
    publishedAtPath: "publishDate", externalIdPath: "id", urlTemplate: `${base}/notice/{id}`,
    detailApi: { url: `${base}/detail`, idPath: "raw.externalId", idParam: "ggid", contentPath: "data.content", summaryPath: "data.summary", maxFetches: 7 },
  };
  const source = { id: "test-intent-detail", config: sourceConfig } as never;
  try {
    const rows = await fetchJsonList(source);
    const fetched = await enrichJsonDetails(source, rows);
    assert.deepEqual(fetched, { attempted: 2, fetched: 2, failed: 0, failureReasons: [] });
    assert.deepEqual(requestedIds.sort(), ["wuxi", "yangzhou"]);
    assert.match(rows[0]!.bodyText!, /扬州市1-3级堤防第一批隐患探测项目/);
    assert.match(rows[1]!.bodyText!, /无锡市2-3级堤防隐患探测/);
    assert.ok(rows.every((row) => row.bodyStatus === "ok" && row.excerpt === "采购意向批次"));
    assert.deepEqual(await enrichJsonDetails(source, rows, { skipUrls: new Set(rows.map((row) => row.url)) }), { attempted: 0, fetched: 0, failed: 0, failureReasons: [] });
    assert.deepEqual(unsupportedConfig("json_list", sourceConfig), []);
  } finally {
    await new Promise<void>((resolve) => intentServer.close(() => resolve()));
  }
});

test("JSON detail API supports GET query IDs and reports a source CAPTCHA response clearly", async () => {
  runtimeConfig.allowPrivateNetworkFetch = true;
  const server = http.createServer((req, res) => {
    if (req.url === "/detail?articleId=abc%2B123%3D%3D") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result: { data: { title: "官方公告标题", publishDate: "2026-10-20T08:00:00+08:00", content: "<p>官方公告正文内容。</p>" } } }));
      return;
    }
    if (req.url === "/blocked") {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, code: "NEED_CAPTCHA", error: "captcha.ticket.error" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const sourceConfig = {
    detailApi: { url: `${base}/detail`, method: "GET", idLocation: "query", idPath: "raw.externalId", idParam: "articleId", titlePath: "result.data.title", publishedAtPath: "result.data.publishDate", contentPath: "result.data.content", maxFetches: 1 },
  };
  const source = { id: "test-anhui-detail", config: sourceConfig } as never;
  const candidates: Array<{ url: string; title: string; raw: { externalId: string }; bodyText?: string; publishedAt?: Date | null }> = [{ url: `${base}/notice`, title: "采购公告", raw: { externalId: "abc+123==" } }];
  try {
    const fetched = await enrichJsonDetails(source, candidates as never);
    assert.equal(fetched.fetched, 1);
    assert.equal(candidates[0]!.title, "官方公告标题");
    assert.equal(candidates[0]!.publishedAt?.toISOString(), "2026-10-20T00:00:00.000Z");
    assert.match(candidates[0]!.bodyText ?? "", /官方公告正文内容/);
    const blocked = await fetchJsonList({ id: "test-blocked", config: { url: `${base}/blocked`, itemsPath: "result.data.data", titlePaths: ["title"], urlTemplate: `${base}/{id}` } } as never);
    assert.fail(`expected CAPTCHA failure, got ${blocked.length} rows`);
  } catch (error) {
    assert.match(String(error), /NEED_CAPTCHA: captcha\.ticket\.error/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  assert.deepEqual(unsupportedConfig("json_list", sourceConfig), []);
});

test("JSON list adds a request timestamp and spaces requests to the same source host", async () => {
  runtimeConfig.allowPrivateNetworkFetch = true;
  const requests: Array<{ at: number; body: Record<string, unknown> }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ at: Date.now(), body: JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: { data: { data: [] } } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = {
    url: `${base}/list`, method: "POST", bodyJson: { pageNo: 1, pageSize: 15, categoryCode: "ZcyAnnouncement1" },
    itemsPath: "result.data.data", titlePaths: ["title"], urlTemplate: `${base}/{id}`,
    requestTimestampParam: "_t", requestIntervalMs: 40,
  };
  try {
    await Promise.all([
      fetchJsonList({ id: "test-anhui-intent", config } as never),
      fetchJsonList({ id: "test-anhui-notices", config: { ...config, bodyJson: { ...config.bodyJson, categoryCode: "ZcyAnnouncement2" } } } as never),
    ]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(({ body }) => typeof body._t === "number" && body.pageSize === 15));
    assert.deepEqual(requests.map(({ body }) => body.categoryCode).sort(), ["ZcyAnnouncement1", "ZcyAnnouncement2"]);
    assert.ok(Math.abs(requests[1]!.at - requests[0]!.at) >= 30);
    assert.deepEqual(unsupportedConfig("json_list", config), []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
