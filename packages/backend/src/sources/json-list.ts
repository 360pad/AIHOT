// JSON sources: plain JSON APIs, JSON embedded in HTML (script tags, window variables).
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import { fromHtml } from "./web-list.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[seg];
    else return undefined;
  }
  return cur;
}

function firstString(obj: unknown, paths: string[] | undefined): string | null {
  for (const p of paths ?? []) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** "{path}" → encoded value, "{raw:path}" → raw value. Returns null when a referenced value is missing. */
export function renderTemplate(template: string, item: unknown): string | null {
  let missing = false;
  const out = template.replace(/\{(raw:)?([^}]+)\}/g, (_m, raw: string | undefined, path: string) => {
    const v = getPath(item, path);
    if (v === undefined || v === null || v === "") {
      missing = true;
      return "";
    }
    return raw ? String(v) : encodeURIComponent(String(v)).replace(/%2F/g, "/");
  });
  return missing ? null : out;
}

function toDate(v: unknown, unit: string | undefined, utcOffset: string | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (unit === "epoch_ms") return new Date(Number(v));
  if (unit === "epoch_s") return new Date(Number(v) * 1000);
  // 20260922: a calendar day at UTC midnight (some list APIs give dates as yyyymmdd).
  if (unit === "yyyymmdd") {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v).trim());
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : null;
    return d && Number.isFinite(d.getTime()) && d.toISOString().startsWith(`${m![1]}-${m![2]}-${m![3]}`) ? d : null;
  }
  const text = String(v).trim();
  // Chinese procurement APIs commonly return local time without a zone. Honour the source's
  // declared offset instead of letting Node interpret it as UTC (which makes fresh rows look future-dated).
  if (utcOffset && /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)) {
    const normalized = text.replace(/[/.]/g, "-").replace(" ", "T");
    const withOffset = Date.parse(`${normalized}${utcOffset}`);
    if (Number.isFinite(withOffset)) return new Date(withOffset);
  }
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t) : null;
}

function findKey(obj: unknown, key: string, depth = 0): unknown {
  if (depth > 12 || obj === null || typeof obj !== "object") return undefined;
  if (!Array.isArray(obj) && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = findKey(v, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function embeddedJson(html: string, source: SourceRow): unknown {
  const mode = source.config.mode;
  if (mode === "html_window_var") {
    const name = String(source.config.windowVar);
    const re = new RegExp(`(?:window\\.)?${name.replace(/[$]/g, "\\$")}\\s*=\\s*`);
    const m = re.exec(html);
    if (!m) throw new FetchError(`window.${name} not found`);
    const start = m.index + m[0].length;
    // Balanced-brace scan to find the object literal's end.
    let depth = 0, inStr: string | null = null, esc = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return JSON.parse(html.slice(start, i + 1));
      }
    }
    throw new FetchError(`window.${name} not terminated`);
  }
  // html_json_key: scan JSON script blocks (e.g. __NEXT_DATA__) for the key.
  const key = String(source.config.jsonKey);
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1]!.trim();
    // Flight payloads carry the key escaped inside a string (\"items\").
    if (!body.includes(`"${key}"`) && !body.includes(`\\"${key}\\"`)) continue;
    const candidates = [body, body.replace(/^[^{[]*/, "").replace(/;?\s*$/, "")];
    for (const c of candidates) {
      try {
        const parsed = JSON.parse(c);
        const found = findKey(parsed, key);
        if (found) return { [key]: found };
      } catch {
        // Next.js flight payloads: self.__next_f.push([1,"..."])
      }
    }
    const flight = /"((?:[^"\\]|\\.)*)"\]\)\s*$/.exec(body);
    if (flight) {
      try {
        const decoded = JSON.parse(`"${flight[1]}"`) as string;
        const idx = decoded.indexOf(`"${key}"`);
        if (idx >= 0) {
          const objStart = decoded.lastIndexOf("{", idx);
          const parsed = JSON.parse(decoded.slice(objStart, decoded.indexOf("]", idx) + 1) + "}");
          const found = findKey(parsed, key);
          if (found) return { [key]: found };
        }
      } catch {
        // keep scanning
      }
    }
  }
  throw new FetchError(`embedded key ${key} not found`);
}

interface JsonListOptions {
  /** First imports may read a bounded historical window; regular runs stay on the newest page. */
  firstImport?: boolean;
}

interface JsonPage {
  data: unknown;
  /** Number of records in the page before field mapping/filtering. */
  itemCount: number | null;
}

function pageRequest(source: SourceRow, page: number): { url: string; bodyJson?: unknown; bodyForm?: Record<string, unknown> } {
  const c = source.config;
  const pagination = c.pagination;
  if (!pagination) return { url: String(c.url ?? ""), bodyJson: c.bodyJson, bodyForm: c.bodyForm };
  const pageParam = String(pagination.pageParam ?? "page");
  const sizeParam = pagination.sizeParam ? String(pagination.sizeParam) : null;
  const pageSize = pagination.pageSize;
  const location = pagination.location ?? (c.bodyJson ? "bodyJson" : c.bodyForm ? "bodyForm" : "query");
  if (location === "query") {
    const parsed = new URL(String(c.url ?? ""));
    parsed.searchParams.set(pageParam, String(page));
    if (sizeParam && pageSize !== undefined) parsed.searchParams.set(sizeParam, String(pageSize));
    return { url: parsed.toString(), bodyJson: c.bodyJson, bodyForm: c.bodyForm };
  }
  if (location === "bodyJson") {
    const bodyJson = { ...(c.bodyJson ?? {}), [pageParam]: page } as Record<string, unknown>;
    if (sizeParam && pageSize !== undefined) bodyJson[sizeParam] = pageSize;
    return { url: String(c.url ?? ""), bodyJson, bodyForm: c.bodyForm };
  }
  const bodyForm = { ...(c.bodyForm ?? {}), [pageParam]: page } as Record<string, unknown>;
  if (sizeParam && pageSize !== undefined) bodyForm[sizeParam] = pageSize;
  return { url: String(c.url ?? ""), bodyJson: c.bodyJson, bodyForm };
}

async function fetchJsonPage(source: SourceRow, page: number): Promise<JsonPage> {
  const c = source.config;
  const request = pageRequest(source, page);
  const url = request.url;
  const headers: Record<string, string> = { accept: "application/json, text/html;q=0.9", ...(c.headers ?? {}) };
  if (/^https:\/\/api\.github\.com\//.test(url)) {
    const token = credential("collectors", "GITHUB_TOKEN");
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const formBody = request.bodyForm
    ? new URLSearchParams(Object.entries(request.bodyForm).map(([key, value]) => [key, String(value)])).toString()
    : undefined;
  const res = await guardedFetch(url, {
    method: c.method ?? "GET",
    headers: request.bodyJson
      ? { ...headers, "content-type": "application/json" }
      : request.bodyForm
        ? { ...headers, "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
        : headers,
    body: request.bodyJson ? JSON.stringify(request.bodyJson) : formBody,
    timeoutMs: 25_000,
  });
  if (res.status !== 200) throw new FetchError(`HTTP ${res.status}`, res.status);
  let data: unknown;
  if (c.mode === "html_json_key" || c.mode === "html_window_var") data = embeddedJson(res.text(), source);
  else {
    try {
      data = JSON.parse(res.text());
    } catch {
      throw new FetchError("response is not JSON");
    }
  }
  if (c.mode === "html_json") {
    const html = getPath(data, String(c.htmlPath ?? "data.html"));
    if (typeof html !== "string") throw new FetchError("htmlPath did not resolve to a string");
    const base = String(c.baseUrl ?? new URL(url).origin);
    const candidates = fromHtml(html, base, source);
    return { data: candidates, itemCount: candidates.length };
  }
  let items = c.itemsPath ? getPath(data, c.itemsPath) : c.jsonKey ? getPath(data, c.jsonKey) : data;
  if (c.itemsObjectValues && items && typeof items === "object" && !Array.isArray(items)) items = Object.values(items);
  if (!Array.isArray(items)) throw new FetchError("items path did not resolve to an array");
  return { data: items, itemCount: items.length };
}

function mapJsonItems(source: SourceRow, items: unknown[]): Candidate[] {
  const c = source.config;

  const out: Candidate[] = [];
  for (const item of items) {
    if (c.requireBoolean && getPath(item, c.requireBoolean.path) !== c.requireBoolean.equals) continue;
    if (c.minNumeric && !(Number(getPath(item, c.minNumeric.path)) >= Number(c.minNumeric.min))) continue;
    const title = firstString(item, c.titlePaths);
    const url = (c.urlTemplate && renderTemplate(c.urlTemplate, item)) || (c.urlTemplateFallback && renderTemplate(c.urlTemplateFallback, item));
    if (!title || !url) continue;
    const externalId = c.externalIdPath ? getPath(item, c.externalIdPath) : null;
    const summary = firstString(item, c.summaryPaths);
    const raw = item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : { value: item };
    for (const k of c.rawDropKeys ?? []) delete (raw as Record<string, unknown>)[k];
    const summaryIsBody = c.summaryIsBody === true && !!summary;
    out.push({
      url,
      title: collapseWhitespace(stripTags(title)),
      author: firstString(item, c.authorPaths),
      publishedAt: toDate(getPath(item, c.publishedAtPath), c.publishedAtUnit, c.publishedAtUtcOffset),
      excerpt: summary ? collapseWhitespace(stripTags(summary)).slice(0, 2000) : null,
      bodyText: summaryIsBody ? stripTags(summary!) : null,
      bodyStatus: summaryIsBody ? "ok" : "pending",
      raw: { externalId: externalId ?? null },
    });
  }
  if (items.length > 0 && out.length === 0 && !c.requireBoolean && !c.minNumeric) throw new FetchError("no items mapped (check title/url paths)");
  return out;
}

export async function fetchJsonList(source: SourceRow, opts: JsonListOptions = {}): Promise<Candidate[]> {
  const c = source.config;
  const pagination = c.pagination;
  const start = Number(pagination?.start ?? 1);
  const step = Number(pagination?.step ?? 1);
  const requestedPages = opts.firstImport && pagination?.firstImportPages !== undefined
    ? Number(pagination.firstImportPages)
    : Number(pagination?.pages ?? 1);
  const pageCount = Math.max(1, Math.min(50, Number.isFinite(requestedPages) ? Math.floor(requestedPages) : 1));
  const pageStep = Number.isFinite(step) && step !== 0 ? step : 1;
  const pageSize = Number(pagination?.pageSize ?? 0);
  const stopWhenShort = pagination?.stopWhenShort === true && pageSize > 0;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < pageCount; index++) {
    const page = start + index * pageStep;
    const result = await fetchJsonPage(source, page);
    const candidates = c.mode === "html_json" ? result.data as Candidate[] : mapJsonItems(source, result.data as unknown[]);
    for (const candidate of candidates) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      out.push(candidate);
    }
    if (!pagination || result.itemCount === 0 || (stopWhenShort && (result.itemCount ?? 0) < pageSize)) break;
  }
  if (out.length === 0 && pagination && pageCount > 1) throw new FetchError("no items returned across paginated requests");
  return out;
}
