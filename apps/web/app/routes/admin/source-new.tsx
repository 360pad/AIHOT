import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/source-new";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { KIND_LABEL, MODE_LABEL, TIER_LABEL } from "../../features/admin/labels";
import { AdminPage, Button, Card, Empty, Field, Input, Select, Textarea } from "../../features/admin/ui";

export const meta: Route.MetaFunction = () => [{ title: `新建信源 · ${SITE.name} 后台` }];

const TEMPLATES: Record<string, Record<string, unknown>> = {
  rss: { feedUrl: "https://example.com/feed.xml" },
  web_list: { url: "https://example.com/blog", baseUrl: "https://example.com", itemSelector: "article", linkSelector: "a", titleSelector: "h2", allowUrlPrefixes: ["https://example.com/blog/"] },
  json_list: { url: "https://example.com/api/posts", mode: "json_api", method: "GET", itemsPath: "data.items", titlePaths: ["title"], urlTemplate: "{raw:url}", summaryPaths: ["summary"] },
  x_search: { query: "from:handle -filter:replies", searchType: "Latest" },
  mp_account: { url: "", nickname: "" },
  external: {},
};

interface Preview {
  ms: number;
  count: number;
  items: Array<{ title: string; url: string; publishedAt: string | null; excerpt: string }>;
}

type ProcessingMode = "collect_only" | "collect_and_analyze";

function configWithProcessingMode(kind: string, config: Record<string, unknown>, mode: ProcessingMode) {
  if (kind !== "mp_account") return config;
  const current = config._aihot && typeof config._aihot === "object" ? config._aihot as Record<string, unknown> : {};
  return { ...config, _aihot: { ...current, processingMode: mode } };
}

export default function NewSource() {
  const navigate = useNavigate();
  const { run, pending } = useAdminAction();
  const [form, setForm] = useState({ id: "", name: "", kind: "rss", tier: "T2", participation_mode: "editorial", processing_mode: "collect_only" as ProcessingMode, interval_minutes: 30, first_party: false, site_fulltext: true, syndicate_fulltext: false, tags: "" });
  const [config, setConfig] = useState(JSON.stringify(TEMPLATES.rss, null, 2));
  const [mpUrl, setMpUrl] = useState("");
  const [mpNickname, setMpNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const parsed = () => {
    if (form.kind === "mp_account") {
      setError(null);
      const value: Record<string, unknown> = {};
      if (mpUrl.trim()) value.url = mpUrl.trim();
      if (mpNickname.trim()) value.nickname = mpNickname.trim();
      if (!value.url && !value.nickname) {
        setError("请粘贴一篇公众号文章链接，或填写公众号名称");
        return null;
      }
      return value;
    }
    try {
      setError(null);
      return JSON.parse(config) as Record<string, unknown>;
    } catch (e) {
      setError(`配置不是合法 JSON：${(e as Error).message}`);
      return null;
    }
  };

  return (
    <AdminPage wide title="新建信源" subtitle="先判重、先预览：优先 RSS/JSON 等稳定协议；首抓成功且有真实条目才算接入完成。一手身份要有运营主体或官方交叉链接证据。">
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card title="信源定义">
          <div className="grid gap-4 sm:grid-cols-2">
            {form.kind === "mp_account" ? (
              <div className="sm:col-span-2 rounded-card bg-accent/5 px-4 py-3 text-[13px] text-ink-2 ring-1 ring-accent/15">
                公众号的名称和内部编号会在第一次采集时自动识别，你只需要提供文章链接或公众号名称。
              </div>
            ) : (
              <>
                <Field label="ID" hint="小写字母、数字和连字符，创建后不可改">
                  <Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} placeholder="openai-blog" />
                </Field>
                <Field label="名称">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenAI 博客" />
                </Field>
              </>
            )}
            <Field label="类型">
              <Select
                value={form.kind}
                onChange={(e) => {
                  const nextKind = e.target.value;
                  setForm({ ...form, id: nextKind === "mp_account" ? "" : form.id, name: nextKind === "mp_account" ? "" : form.name, kind: nextKind, interval_minutes: nextKind === "mp_account" ? 540 : form.interval_minutes, processing_mode: nextKind === "mp_account" ? "collect_only" : "collect_and_analyze" });
                  setConfig(JSON.stringify(TEMPLATES[e.target.value] ?? {}, null, 2));
                  setMpUrl("");
                  setMpNickname("");
                  setPreview(null);
                }}
              >
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="采集间隔（分钟）" hint={form.kind === "mp_account" ? "公众号默认 540 分钟，约每天上午、下午各一次" : undefined}>
              <Input type="number" min={1} max={1440} value={form.interval_minutes} onChange={(e) => setForm({ ...form, interval_minutes: Number(e.target.value) })} />
            </Field>
            {form.kind === "mp_account" && (
              <Field label="公众号处理方式" hint="仅采集不调用 AI；采集服务费用仍按信源计费">
                <Select value={form.processing_mode} onChange={(e) => setForm({ ...form, processing_mode: e.target.value as ProcessingMode })}>
                  <option value="collect_only">仅采集（推荐）</option>
                  <option value="collect_and_analyze">采集并分析</option>
                </Select>
              </Field>
            )}
            {form.kind !== "mp_account" && (
              <>
                <Field label="参与方式">
                  <Select value={form.participation_mode} onChange={(e) => setForm({ ...form, participation_mode: e.target.value })}>
                    {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="等级">
                  <Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                    {Object.entries(TIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="标签（逗号分隔）">
                  <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                </Field>
                <div className="flex flex-col justify-end gap-2 text-[13px] text-ink-2">
                  {([
                    ["first_party", "一手信源"],
                    ["site_fulltext", "站内可展示全文"],
                    ["syndicate_fulltext", "对外接口可带全文"],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="inline-flex items-center gap-2">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="mt-4">
            {form.kind === "mp_account" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="公众号文章链接" hint="粘贴任意一篇文章链接，系统会自动识别公众号并抓取近期文章">
                  <Input value={mpUrl} onChange={(e) => setMpUrl(e.target.value)} placeholder="https://mp.weixin.qq.com/s/..." />
                </Field>
                <Field label="公众号名称（可选）" hint="如果链接不方便，也可以直接填写公众号名称">
                  <Input value={mpNickname} onChange={(e) => setMpNickname(e.target.value)} placeholder="例如：地质" />
                </Field>
              </div>
            ) : (
              <Field label="采集配置（JSON）">
                <Textarea className="font-mono !text-[12px]" rows={10} value={config} onChange={(e) => setConfig(e.target.value)} spellCheck={false} />
              </Field>
            )}
            {error && <div className="mt-1 text-[12.5px] text-hot">{error}</div>}
          </div>
          {duplicate && (
            <div className="mt-4 rounded-card bg-amber/10 px-4 py-3 text-[13px] text-ink-2 ring-1 ring-amber/25">
              这个地址已经在监控：<Link className="font-medium text-accent" to={`/admin/sources/${encodeURIComponent(duplicate.id)}`}>{duplicate.name}</Link>（{duplicate.id}）。没有新建。
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            {form.kind === "mp_account" ? (
              <div className="self-center text-[12.5px] text-ink-3">创建后在信源详情页点击“立即采集”</div>
            ) : (
              <Button
                busy={pending === "preview"}
                onClick={async () => {
                  const c = parsed();
                  if (!c) return;
                  const r = await run<Preview>("POST", "/api/admin/sources/preview", { id: form.id || "draft", kind: form.kind, config: c }, { label: "preview", revalidate: false });
                  if (r) setPreview(r);
                }}
              >
                预览抓取
              </Button>
            )}
            <Button
              tone="primary"
              busy={pending === "create"}
              disabled={form.kind === "mp_account" ? !mpUrl.trim() && !mpNickname.trim() : !form.id || !form.name}
              onClick={async () => {
                const c = parsed();
                if (!c) return;
                const { processing_mode, ...sourceForm } = form;
                const sourceName = form.kind === "mp_account" ? (mpNickname.trim() || "微信公众号") : form.name;
                const sourceId = form.kind === "mp_account" ? (form.id || `mp-${Date.now().toString(36)}`) : form.id;
                const r = await run<{ created: boolean; duplicate?: { id: string; name: string }; source?: { id: string } }>(
                  "POST",
                  "/api/admin/sources",
                  { ...sourceForm, id: sourceId, name: sourceName, tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), config: configWithProcessingMode(form.kind, c, processing_mode) },
                  { label: "create", revalidate: false },
                );
                if (!r) return;
                if (!r.created && r.duplicate) setDuplicate(r.duplicate);
                else if (r.source) navigate(`/admin/sources/${encodeURIComponent(r.source.id)}`);
              }}
            >
              创建
            </Button>
          </div>
        </Card>
        <Card title={preview ? `预览：${preview.count} 条（${preview.ms}ms）` : "预览"}>
          {!preview ? (
            <Empty>{form.kind === "mp_account" ? "公众号创建后，在信源详情页点击“立即采集”，系统会自动识别账号并保存近期文章。" : "填好配置后点“预览抓取”，这里显示将会采集到的条目（不入库）。"}</Empty>
          ) : preview.items.length ? (
            <ul className="space-y-3">
              {preview.items.map((i) => (
                <li key={i.url} className="text-[13px]">
                  <a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-ink hover:text-accent">{i.title}</a>
                  <div className="text-[12px] text-ink-4">{i.publishedAt ? bj(i.publishedAt, true) : "无发布时间"}</div>
                  {i.excerpt && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{i.excerpt}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>没有抓到条目。</Empty>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}
