import { SITE } from "@aihot/industry/site";
import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/keywords";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Input, Json, ReasonDialog, Select, Stat } from "../../features/admin/ui";

type Row = Record<string, any>;
type Step = "samples" | "clusters" | "pool" | "draft" | "library";
type Data = { step: Step; overview: Row; profile: Row; library: Row; samples?: Row; sample?: Row | null; sourceSample?: Row | null; terms?: Row[]; term?: Row | null; termIds: number[]; feedbackId: number; q: string; label: string; kind: string };
const STEPS: Array<{ key: Step; title: string; note: string }> = [
  { key: "samples", title: "样本汇聚", note: "已标注样本回看" },
  { key: "clusters", title: "AI归类与词条判读", note: "聚类与词义建议" },
  { key: "pool", title: "候选词池", note: "候选词审核与调整" },
  { key: "draft", title: "草稿与回放", note: "在历史数据中验证" },
  { key: "library", title: "正式词库", note: "发布生效" },
];
const LABELS: Record<string, string> = { relevant: "相关", irrelevant: "不相关", unknown: "不确定" };
const KINDS: Record<string, string> = { positive: "正向候选", negative: "反向候选" };
const ROLES: Record<string, string> = { serviceAction: "服务动作", method: "方法技术", deliverable: "交付成果", negative: "负向词" };

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawStep = url.searchParams.get("step") || "samples";
  const step: Step = STEPS.some((item) => item.key === rawStep) ? rawStep as Step : "samples";
  const q = url.searchParams.get("q")?.trim() || "";
  const label = url.searchParams.get("label") || "all";
  const kind = url.searchParams.get("kind") || "all";
  const feedbackId = Number(url.searchParams.get("feedbackId")) || 0;
  const [overview, profile, library] = await Promise.all([
    adminGet<Row>(request, "/api/admin/keywords/overview"),
    adminGet<Row>(request, "/api/admin/keywords/draft"),
    adminGet<Row>(request, "/api/admin/keywords/library"),
  ]);
  const termIds = (url.searchParams.get("termIds") ?? "").split(",").map(Number).filter((item) => item > 0);
  const data: Data = { step, overview, profile, library, q, label, kind, termIds, feedbackId };
  if (step === "samples") {
    const query = new URLSearchParams({ q, page: url.searchParams.get("page") || "1" });
    if (label !== "all") query.set("label", label);
    data.samples = await adminGet<Row>(request, "/api/admin/keywords/samples?" + query);
    const feedbackId = Number(url.searchParams.get("feedbackId")) || Number(data.samples.rows?.[0]?.feedbackId) || 0;
    data.sample = feedbackId ? await adminGet<Row>(request, "/api/admin/keywords/samples/" + feedbackId).catch(() => null) : null;
  }
  if (step === "clusters" || step === "pool" || step === "draft") {
    const query = new URLSearchParams({ status: step === "clusters" ? "pending" : "candidate" });
    if (kind !== "all") query.set("kind", kind);
    if (q) query.set("q", q);
    if (step === "clusters" && feedbackId) {
      query.set("feedbackId", String(feedbackId));
      data.sourceSample = await adminGet<Row>(request, "/api/admin/keywords/samples/" + feedbackId).catch(() => null);
    }
    data.terms = (await adminGet<{ terms: Row[] }>(request, "/api/admin/keywords/terms?" + query)).terms;
    const requested = Number(url.searchParams.get("termId")) || Number(url.searchParams.get("focusTermId")) || 0;
    const termId = requested || Number(data.terms[0]?.id) || 0;
    data.term = termId ? await adminGet<Row>(request, "/api/admin/keywords/terms/" + termId).catch(() => null) : null;
  }
  return data;
}

export const meta: Route.MetaFunction = () => [{ title: "新关键词筛选 · " + SITE.name + " 后台" }];

function Steps({ active }: { active: Step }) {
  const activeIndex = STEPS.findIndex((item) => item.key === active);
  return <nav aria-label="关键词治理流程" className="mb-5 grid gap-1 rounded-panel bg-surface-2/65 p-2 md:grid-cols-5">
    {STEPS.map((item, index) => <Link key={item.key} to={"/admin/keywords?step=" + item.key} className={"flex min-w-0 items-center gap-2 rounded-control px-2.5 py-2.5 " + (active === item.key ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-3 hover:bg-surface")}>
      <span className={"grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold " + (active === item.key ? "bg-white/20" : index < activeIndex ? "bg-accent-soft text-accent" : "bg-bg-sunk text-ink-3")}>{index < activeIndex ? "✓" : index + 1}</span>
      <span className="min-w-0"><b className="block truncate text-[12px]">{item.title}</b><small className="block truncate text-[10px] opacity-75">{item.note}</small></span>
      {index < STEPS.length - 1 && <span className="ml-auto hidden text-ink-4 xl:block">→</span>}
    </Link>)}
  </nav>;
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const candidates = [...new Set(terms.filter((term) => term && term.length > 1))].sort((a, b) => b.length - a.length);
  if (!text || !candidates.length) return <>{text}</>;
  const parts: Array<{ text: string; marked: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    let at = -1; let phrase = "";
    for (const candidate of candidates) {
      const found = text.toLocaleLowerCase().indexOf(candidate.toLocaleLowerCase(), cursor);
      if (found >= 0 && (at < 0 || found < at || (found === at && candidate.length > phrase.length))) { at = found; phrase = candidate; }
    }
    if (at < 0) { parts.push({ text: text.slice(cursor), marked: false }); break; }
    if (at > cursor) parts.push({ text: text.slice(cursor, at), marked: false });
    parts.push({ text: text.slice(at, at + phrase.length), marked: true });
    cursor = at + phrase.length;
  }
  return <>{parts.map((part, i) => part.marked ? <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit">{part.text}</mark> : <span key={i}>{part.text}</span>)}</>;
}

function StepSamples({ d, run, pending }: { d: Data; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const [search, setSearch] = useState(d.q);
  const sample = d.sample;
  const samplePage = d.samples;
  const rows = d.samples?.rows ?? [];
  const extractedRows = sample?.extractedTerms ?? [];
  const extractedGroups = extractedRows;
  const evidenceCount = extractedGroups.reduce((count: number, item: Row) => count + Number(item.evidenceCount ?? 0), 0);
  const official = (sample?.officialHits ?? []).map((hit: Row) => hit.phrase);
  const extracted = extractedGroups.flatMap((term: Row) => [term.phrase, ...(term.variants ?? [])]);
  const ai = sample?.analysisOutput ?? sample?.originalResult?.output ?? {};
  const tasks = (ai.businessMatch?.projects ?? []).flatMap((project: Row) => project.tasks ?? []);
  const aiTerms = tasks.flatMap((task: Row) => [task.name, task.action, ...(task.deliverables ?? [])]).filter((value: unknown): value is string => typeof value === "string" && value.length > 1);
  const collect = () => run("POST", "/api/admin/keywords/samples/collect", {}, { label: "keyword-sample-collect", success: "已从已标注样本汇总 AI 词条证据" });
  const sampleLink = (id: number) => "/admin/keywords?step=samples&feedbackId=" + id + "&label=" + d.label + (d.q ? "&q=" + encodeURIComponent(d.q) : "");
  return <>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="已判读文章" value={num(d.samples?.counts?.sampleCount ?? 0)} hint="按文章去重的人工样本" />
      <Stat label="人工标为相关" value={num(d.samples?.counts?.relevantCount ?? 0)} tone="ok" />
      <Stat label="人工标为不相关" value={num(d.samples?.counts?.irrelevantCount ?? 0)} tone="bad" />
      <Stat label="等待词条汇总" value={num(d.overview.uncollectedFeedback)} hint="只读已有 AI 分析，不重新调用模型" tone={d.overview.uncollectedFeedback ? "warn" : "ok"} />
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-accent/15 bg-accent-soft/20 px-4 py-3"><div><b className="text-[13px] text-ink">人工判读完成后，统一汇聚新词证据</b><p className="mt-0.5 text-[11.5px] text-ink-3">同一词条跨文章合并统计；正式词库已覆盖的正向词不会再次推荐。</p></div><Button tone="primary" busy={pending === "keyword-sample-collect"} onClick={() => void collect()}>汇总已判读样本</Button></div>
    <div className="grid gap-4 2xl:grid-cols-[minmax(330px,0.72fr)_minmax(0,1.5fr)]">
      <Card title={"已标注样本（" + num(d.samples?.total ?? 0) + "）"} pad={false}>
        <div className="border-b border-line p-3"><div className="mb-3 flex gap-1.5">{[{ v: "all", t: "全部" }, { v: "relevant", t: "人工相关" }, { v: "irrelevant", t: "人工不相关" }].map((x) => <Link key={x.v} to={"/admin/keywords?step=samples&label=" + x.v} className={"rounded-control px-3 py-1.5 text-[11.5px] " + (d.label === x.v ? "bg-accent-soft font-semibold text-accent" : "bg-bg-sunk/55 text-ink-3")}>{x.t}</Link>)}</div><Form method="get" className="flex gap-2"><input type="hidden" name="step" value="samples" /><input type="hidden" name="label" value={d.label} /><Input name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题或正文关键词" /><Button type="submit">搜索</Button></Form></div>
        {!rows.length ? <Empty>当前没有已标注样本。请先在 AI 人工复核中标记相关或不相关。</Empty> : <div className="max-h-[720px] divide-y divide-line overflow-auto">{rows.map((row: Row) => <Link key={row.feedbackId} to={sampleLink(Number(row.feedbackId))} className={"block px-4 py-3.5 hover:bg-bg-sunk/45 " + (sample?.feedbackId === row.feedbackId ? "border-l-[3px] border-accent bg-accent-soft/25" : "")}><div className="flex items-start justify-between gap-2"><b className="line-clamp-2 text-[12.5px] leading-5 text-ink">{row.title}</b><span className="shrink-0 text-[10.5px] text-ink-4">{bj(row.reviewedAt, false)}</span></div><div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={row.label === "relevant" ? "ok" : "bad"}>人工：{LABELS[row.label]}</Badge><Badge tone={row.aiRelevance === "pass" ? "ok" : row.aiRelevance === "unknown" ? "warn" : "muted"}>AI：{row.aiRelevance?.toUpperCase() ?? "未分析"}</Badge><Badge tone="info">业务分 {row.analysisOutput?.businessScore?.total ?? row.analysisOutput?.scoreBreakdown?.business ?? row.aiScore ?? "—"}</Badge></div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-ink-3">{row.excerpt || row.bodyPreview || "没有可展示的摘要正文"}</p><div className="mt-2 text-[10.5px] text-ink-4">{row.extractedGroupCount ?? 0} 个词组 · {row.extractedTermCount ?? 0} 条证据 · {row.extractedAt ? "已汇总" : "待汇总"}</div></Link>)}</div>}
        {samplePage && Number(samplePage.pageCount ?? 1) > 1 && <div className="flex justify-between border-t border-line px-4 py-3 text-[11.5px] text-ink-3"><span>第 {samplePage.page} / {samplePage.pageCount} 页</span><span>{samplePage.page > 1 && <Link className="mr-3 text-accent" to={"/admin/keywords?step=samples&page=" + (samplePage.page - 1) + "&label=" + d.label}>上一页</Link>}{samplePage.page < samplePage.pageCount && <Link className="text-accent" to={"/admin/keywords?step=samples&page=" + (samplePage.page + 1) + "&label=" + d.label}>下一页</Link>}</span></div>}
      </Card>
      {!sample ? <Card title="样本详情"><Empty>选择左侧文章查看 AI 判读、人工标签和标题 / 正文证据。</Empty></Card> : <Card title="样本与 AI 词条提取" right={<Badge tone={sample.label === "relevant" ? "ok" : "bad"}>人工判读：{LABELS[sample.label]}</Badge>}>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-4"><span>发布时间：{sample.publishedAt ? bj(sample.publishedAt, false) : "未记录"}</span><span>人工标注：{bj(sample.reviewedAt, true)}</span><a className="text-accent hover:underline" href={sample.url} target="_blank" rel="noreferrer">打开来源文章 ↗</a></div>
        <div className="mt-3 rounded-panel bg-surface-2/60 p-3.5"><div className="mb-1 text-[11.5px] font-semibold text-ink-3">AI 判读结果与人工标签</div><div className="flex flex-wrap gap-2"><Badge tone={sample.aiRelevance === "pass" ? "ok" : sample.aiRelevance === "unknown" ? "warn" : "muted"}>AI {sample.aiRelevance?.toUpperCase() ?? "未分析"}</Badge><Badge tone="info">业务分 {sample.analysisOutput?.businessScore?.total ?? sample.analysisOutput?.scoreBreakdown?.business ?? sample.aiScore ?? "—"}</Badge><Badge tone={sample.label === "relevant" ? "ok" : "bad"}>人工 {LABELS[sample.label]}</Badge><span className="text-[11px] text-ink-4">关联能力：{sample.capabilityIds?.join("、") || "未关联"}</span></div></div>
        <section className="mt-4"><h3 className="text-[12.5px] font-semibold text-ink">标题内容</h3><p className="mt-2 break-words text-[13.5px] leading-7 text-ink-2"><Highlight text={sample.title} terms={[...official, ...extracted, ...aiTerms]} /></p></section>
        <section className="mt-3 rounded-panel bg-accent-soft/15 p-4"><h3 className="text-[12px] font-semibold text-ink">正文摘要 / 证据</h3><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12.5px] leading-6 text-ink-2"><Highlight text={sample.excerpt || sample.bodyText || "没有采集到可展示的正文"} terms={[...official, ...extracted, ...aiTerms]} /></p></section>
        <section className="mt-3 rounded-panel border border-line p-4"><div className="flex items-center justify-between"><h3 className="text-[12px] font-semibold text-ink">正式词库命中</h3><Badge tone="info">{official.length} 个</Badge></div><div className="mt-2 flex flex-wrap gap-1.5">{sample.officialHits?.length ? sample.officialHits.map((hit: Row, i: number) => <Badge key={i} tone={hit.conflict ? "bad" : hit.kind === "positive" ? "ok" : "bad"}>{hit.kind === "positive" ? "+" : "−"} {hit.phrase}{hit.conflict ? " · 与人工判读冲突" : " · 与人工判读一致"}</Badge>) : <span className="text-[11px] text-ink-4">无正式关键词命中</span>}</div></section>
        <section className="mt-3 rounded-panel border border-accent/15 bg-accent-soft/10 p-4"><div className="flex items-center justify-between"><h3 className="text-[12px] font-semibold text-ink">AI 任务词条与命中证据</h3><Badge tone="accent">{extractedGroups.length} 个词组 · {extractedGroups.reduce((count: number, item: Row) => count + 1 + (item.variants?.length ?? 0), 0)} 个表达 · {evidenceCount} 条证据</Badge></div><p className="mt-1 text-[10.5px] leading-5 text-ink-4">词组来自本篇历史 AI 任务分析中的任务、动作和交付成果，并经标题 / 正文命中校验；此处不重新调用模型。相同词义合并为标准词和同义表达，下一步按词组人工判读。</p><div className="mt-2 flex flex-wrap gap-2">{extractedGroups.length ? extractedGroups.map((term: Row) => <div key={String(term.kind) + ":" + term.normalizedTerm} className="rounded-control border border-line bg-surface px-2.5 py-2"><div className="flex flex-wrap items-center gap-1.5"><Badge tone={term.kind === "positive" ? "accent" : "bad"}>标准词：{term.phrase}</Badge><span className="text-[10px] text-ink-4">{term.evidenceCount} 条证据</span></div><div className="mt-1.5 flex flex-wrap gap-1">{(term.variants ?? []).map((variant: string) => <span key={variant} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10px] text-ink-3">{variant}</span>)}</div></div>) : <span className="text-[11px] text-ink-4">{sample.extractedAt ? "已完成汇总，本篇没有满足条件的新词组。" : "尚未汇总；点击顶部“汇总已判读样本”。"}</span>}</div></section>
        <div className="mt-4 flex justify-end">{extractedGroups.length ? <Link to={"/admin/keywords?step=clusters&feedbackId=" + sample.feedbackId} className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-[12.5px] font-medium text-accent-contrast">判读本篇 {extractedGroups.length} 个词组 →</Link> : <span className="inline-flex h-9 items-center rounded-control bg-bg-sunk px-4 text-[12.5px] text-ink-4">本篇暂无可判读词组</span>}</div>
      </Card>}
    </div>
  </>;
}

function StepClusters({ d, run, pending }: { d: Data; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const term = d.term;
  const sourceGroups = d.sourceSample?.extractedTerms ?? [];
  const sourceEvidenceCount = sourceGroups.reduce((count: number, item: Row) => count + Number(item.evidenceCount ?? 0), 0);
  const sourceExpressionCount = sourceGroups.reduce((count: number, item: Row) => count + 1 + (item.variants?.length ?? 0), 0);
  const feedbackQuery = d.feedbackId ? "&feedbackId=" + d.feedbackId : "";
  const capabilities = d.profile.currentProfile?.profile.capabilities ?? [];
  const sourceCapabilities = (term?.capabilityIds ?? [term?.capabilityId]).filter(Boolean).map((id: string) => capabilities.find((item: Row) => item.id === id)?.name ?? id);
  const [name, setName] = useState(term?.term ?? "");
  const [variants, setVariants] = useState<string>((term?.variants ?? []).join("、"));
  const [capabilityId, setCapabilityId] = useState(term?.capabilityId ?? "");
  const [role, setRole] = useState(term?.role ?? "serviceAction");
  useEffect(() => { setName(term?.term ?? ""); setVariants((term?.variants ?? []).join("、")); setCapabilityId(term?.capabilityId ?? ""); setRole(term?.role ?? "serviceAction"); }, [term?.id]);
  const termId = Number(term?.id ?? 0);
  const review = (action: string) => run("POST", "/api/admin/keywords/terms/" + termId + "/review", action === "edit" ? { action, term: name, variants: variants.split(/[、,，]/u).map((item) => item.trim()).filter(Boolean), capabilityId, role } : { action }, { label: "keyword-term-" + termId + "-" + action, success: action === "reject" ? "已驳回词条簇" : "已确认并归并到候选词池" });
  return <>
    {d.feedbackId > 0 && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-accent/15 bg-accent-soft/15 px-4 py-3"><div className="min-w-0"><b className="block truncate text-[12px] text-ink">来自样本：{d.sourceSample?.title ?? "样本 #" + d.feedbackId}</b><p className="mt-1 text-[10.5px] text-ink-3">本篇归并为 {sourceGroups.length} 个词组、{sourceExpressionCount} 个表达、{sourceEvidenceCount} 条证据；下方仅显示与本篇关联的待判读词组。</p></div><div className="flex gap-2"><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to={"/admin/keywords?step=samples&feedbackId=" + d.feedbackId + (d.sourceSample?.title ? "&q=" + encodeURIComponent(d.sourceSample.title) : "")}>返回样本</Link><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to="/admin/keywords?step=clusters">查看全部</Link></div></div>}
    <div className="grid gap-4 xl:grid-cols-[minmax(245px,0.75fr)_minmax(320px,0.95fr)_minmax(350px,1.2fr)]">
    <Card title={"待判读词条簇（" + (d.terms?.length ?? 0) + "）"} pad={false}>
      <div className="flex gap-1 border-b border-line p-3">{[{ v: "all", t: "全部" }, { v: "positive", t: "正向" }, { v: "negative", t: "反向" }].map((x) => <Link key={x.v} to={"/admin/keywords?step=clusters&kind=" + x.v + feedbackQuery} className={"rounded-control px-3 py-1.5 text-[11px] " + (d.kind === x.v ? "bg-accent text-accent-contrast" : "bg-bg-sunk text-ink-3")}>{x.t}</Link>)}</div>
      {!d.terms?.length ? <Empty>{d.feedbackId ? "本篇关联的词条已无待判读项。可返回样本或查看候选词池。" : "暂无待判读词条。先在“样本汇聚”中汇总已有人工标注。"}</Empty> : <div className="max-h-[720px] divide-y divide-line overflow-auto">{d.terms.map((item: Row) => <Link key={item.id} to={"/admin/keywords?step=clusters&kind=" + d.kind + "&termId=" + item.id + feedbackQuery} className={"block px-4 py-3 hover:bg-bg-sunk/50 " + (term?.id === item.id ? "border-l-[3px] border-accent bg-accent-soft/25" : "")}><div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{item.term}</b><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{KINDS[item.kind]}</Badge></div><div className="mt-1.5 text-[10.5px] text-ink-4">来源 {item.sourceCount} 篇 · 相关 {item.relevantCount} · 不相关 {item.irrelevantCount}</div><div className="mt-2 flex flex-wrap gap-1">{(item.variants ?? []).slice(0, 4).map((v: string) => <span key={v} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[10px] text-ink-3">{v}</span>)}</div></Link>)}</div>}
    </Card>
    {!term ? <Card title="关键词详情"><Empty>选择左侧词条簇查看同义变体和关联文档证据。</Empty></Card> : <>
      <Card title="关键词详情" right={<Badge tone="warn">待人工判读</Badge>}>
        <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-3 text-[11.5px]"><span className="text-ink-4">候选方向</span><span><Badge tone={term.kind === "positive" ? "ok" : "bad"}>{KINDS[term.kind]}</Badge><small className="ml-2 text-ink-4">按人工样本标签确定</small></span><span className="text-ink-4">标准词建议</span><b className="text-[13.5px] text-ink">{term.term}</b><span className="text-ink-4">来源业务能力</span><b className="text-ink-2">{sourceCapabilities.join("、") || "未关联"}</b><span className="text-ink-4">证据标签统计</span><span className="text-ink-2">{term.sourceCount} 篇来源 · {term.relevantCount} 篇相关 / {term.irrelevantCount} 篇不相关</span></div>
        <div className="mt-4 border-t border-line pt-3"><b className="text-[11.5px] text-ink">AI 提取的同义词 / 变体表达（{term.variants?.length ?? 0} 个）</b><div className="mt-2 flex flex-wrap gap-1.5">{(term.variants ?? []).map((v: string) => <span key={v} className="rounded-full bg-accent-soft px-2.5 py-1 text-[10.5px] font-medium text-accent">{v}</span>)}</div></div>
        <div className="mt-4 rounded-panel bg-accent-soft/15 p-3"><b className="text-[11.5px] text-accent">AI 归类说明</b><ul className="mt-2 list-disc space-y-1 pl-4 text-[10.5px] leading-5 text-ink-3"><li>仅使用历史分析中已有的采购任务、动作和交付成果。</li><li>按标准词合并相同表达，来源和标签数量持续累计。</li><li>确认后进入候选词池；此处不修改正式词库。</li></ul></div>
      </Card>
      <Card title={"挂接文档证据（" + (term.evidence?.length ?? 0) + " 篇）"} pad={false}>
        {!term.evidence?.length ? <Empty>暂无文档证据。</Empty> : <div className="max-h-[600px] space-y-3 overflow-auto p-3">{term.evidence.map((e: Row) => <article key={e.id} className="rounded-panel border border-line p-3"><div className="flex items-start justify-between gap-2"><a href={e.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[11.5px] font-semibold leading-5 text-accent hover:underline">{e.title}</a><Badge tone={e.humanLabel === "relevant" ? "ok" : "bad"}>人工：{LABELS[e.humanLabel] ?? "未标注"}</Badge></div><div className="mt-2 flex gap-1.5"><Badge tone={e.aiRelevance === "pass" ? "ok" : "muted"}>AI {e.aiRelevance?.toUpperCase() ?? "—"}</Badge><Badge tone="info">业务分 {e.analysisOutput?.businessScore?.total ?? e.aiScore ?? "—"}</Badge></div><p className="mt-2 rounded-control bg-bg-sunk/55 px-3 py-2 text-[10.5px] leading-5 text-ink-2"><Highlight text={e.evidence || e.excerpt || e.bodyPreview || "无正文证据"} terms={[term.term, ...(term.variants ?? [])]} /></p></article>)}</div>}
      </Card>
      <Card className="xl:col-span-3" title="人工判读与处理" right={<span className="text-[10.5px] text-ink-4">确定词条方向后，接受、修改 / 合并或驳回</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><label><span className="mb-1 block text-[10.5px] text-ink-3">标准化词语</span><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label><label><span className="mb-1 block text-[10.5px] text-ink-3">同义变体（顿号分隔）</span><Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="词语一、词语二" /></label><label><span className="mb-1 block text-[10.5px] text-ink-3">目标业务能力</span><Select value={capabilityId} onChange={(e) => setCapabilityId(e.target.value)}>{capabilities.map((c: Row) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></label><label><span className="mb-1 block text-[10.5px] text-ink-3">词条角色</span><Select disabled={term.kind === "negative"} value={term.kind === "negative" ? "negative" : role} onChange={(e) => setRole(e.target.value)}><option value="serviceAction">服务动作</option><option value="method">方法技术</option><option value="deliverable">交付成果</option></Select></label></div>
        <div className="mt-4 flex flex-wrap gap-2"><Button tone="danger" busy={pending === "keyword-term-" + term.id + "-reject"} onClick={() => void review("reject")}>不采纳该词簇</Button><Button busy={pending === "keyword-term-" + term.id + "-edit"} disabled={!name.trim() || !capabilityId} onClick={() => void review("edit")}>修改 / 合并后采纳</Button><Button tone="primary" busy={pending === "keyword-term-" + term.id + "-accept"} onClick={() => void review("accept")}>确认并纳入候选词池 →</Button></div>
      </Card>
    </>}
    </div>
  </>;
}

function StepPool({ d }: { d: Data }) {
  const [selected, setSelected] = useState<number[]>([]);
  const terms = d.terms ?? [];
  const positive = terms.filter((x: Row) => x.kind === "positive").length;
  const negative = terms.filter((x: Row) => x.kind === "negative").length;
  const recent = terms.reduce((n: number, x: Row) => n + Number(x.recentCount ?? 0), 0);
  const previous = terms.reduce((n: number, x: Row) => n + Number(x.previousCount ?? 0), 0);
  const all = terms.length > 0 && selected.length === terms.length;
  return <>
    <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Stat label="候选正向词" value={positive} /><Stat label="候选反向词" value={negative} tone="bad" /><Stat label="待配置新词" value={terms.length} tone="warn" /><Stat label="近 30 天提词出现" value={recent} hint={"前 30 天 " + previous + " 次"} /></div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-panel bg-accent-soft/20 px-4 py-3 text-[11px] text-accent"><span>按词条聚合，不重复罗列文章；统计相关 / 不相关标签与近 30 天重复出现次数。</span>{recent > previous && <Badge tone="warn">近 30 天出现频次上升</Badge>}</div>
    <Card title="已确认的候选词" right={<div className="flex gap-1">{[{ v: "all", t: "全部" }, { v: "positive", t: "正向" }, { v: "negative", t: "反向" }].map((x) => <Link key={x.v} to={"/admin/keywords?step=pool&kind=" + x.v} className={"rounded-control px-2.5 py-1 text-[10.5px] " + (d.kind === x.v ? "bg-accent text-accent-contrast" : "bg-bg-sunk text-ink-3")}>{x.t}</Link>)}</div>} pad={false}>
      {!terms.length ? <Empty>候选词池为空。到“AI归类与词条判读”确认词簇后，这里会按词条聚合统计。</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[11.5px]"><thead className="bg-surface-2/50 text-[10.5px] text-ink-3"><tr><th className="px-3 py-3"><input type="checkbox" aria-label="选择全部" checked={all} onChange={(e) => setSelected(e.target.checked ? terms.map((x: Row) => Number(x.id)) : [])} /></th><th className="px-3 py-3">词条 / 同义变体</th><th className="px-3 py-3">来源文章</th><th className="px-3 py-3">相关 / 不相关</th><th className="px-3 py-3">近 30 天</th><th className="px-3 py-3">业务能力 / 类型</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">查看</th></tr></thead><tbody>{terms.map((x: Row, i: number) => { const capabilityNames = (x.capabilityIds ?? [x.capabilityId]).map((id: string) => d.profile.currentProfile?.profile.capabilities.find((c: Row) => c.id === id)?.name ?? id); return <tr key={x.id} className={"border-t border-line " + (selected.includes(Number(x.id)) ? "bg-accent-soft/15" : i % 2 ? "bg-surface" : "bg-surface-2/15")}><td className="px-3 py-3"><input type="checkbox" aria-label={"选择 " + x.term} checked={selected.includes(Number(x.id))} onChange={(e) => setSelected((v) => e.target.checked ? [...new Set([...v, Number(x.id)])] : v.filter((id) => id !== Number(x.id)))} /></td><td className="max-w-[330px] px-3 py-3"><b className="text-[12.5px] text-accent">{x.term}</b><div className="mt-1 flex flex-wrap gap-1">{(x.variants ?? []).map((v: string) => <span key={v} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[9.5px] text-ink-3">{v}</span>)}</div></td><td className="px-3 py-3">{x.sourceCount}</td><td className="px-3 py-3"><b className="text-ok">{x.relevantCount}</b><span className="px-1 text-ink-4">/</span><b className="text-hot">{x.irrelevantCount}</b></td><td className="px-3 py-3">{x.recentCount}<span className={x.recentCount > x.previousCount ? "ml-1 text-hot" : "text-ink-4"}>{x.recentCount > x.previousCount ? "↑ " + (x.recentCount - x.previousCount) : ""}</span></td><td className="px-3 py-3">{capabilityNames.join("、")}<div className="mt-1"><Badge tone={x.kind === "positive" ? "ok" : "bad"}>{KINDS[x.kind]} · {ROLES[x.role]}</Badge></div></td><td className="px-3 py-3"><Badge tone="info">待配置</Badge></td><td className="px-3 py-3"><Link className="text-accent hover:underline" to={"/admin/keywords?step=clusters&termId=" + x.id}>查看来源</Link></td></tr>; })}</tbody></table></div>}
    </Card>
    {!!selected.length && <div className="mt-3 flex items-center justify-between rounded-panel border border-accent/15 bg-accent-soft/15 px-4 py-3"><span className="text-[11.5px] font-medium">已选 {selected.length} 个新词簇</span><Link to={"/admin/keywords?step=draft&termIds=" + selected.join(",")} className="inline-flex h-9 items-center rounded-control bg-accent px-4 text-[11.5px] font-medium text-accent-contrast">创建新词草稿 →</Link></div>}
  </>;
}

function StepDraft({ d, run, pending }: { d: Data; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const [selected, setSelected] = useState<number[]>(d.termIds);
  useEffect(() => { if (d.termIds.length) setSelected(d.termIds); }, [d.termIds.join(",")]);
  const [name, setName] = useState("新关键词筛选草稿");
  const [contextId, setContextId] = useState("");
  const [ack, setAck] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const savedMeta = d.profile.governanceDraft;
  const meta = savedMeta?.status === "published" ? null : savedMeta;
  const replay = meta?.replay_result;
  const terms = d.terms ?? [];
  const create = () => run("POST", "/api/admin/keywords/draft", { name, termIds: selected, officialChangeIds: [], contextId: contextId || null, expectedRevision: d.profile.draft?.revision ?? 0 }, { label: "keyword-governance-draft", success: "新词草稿已创建，正式词库尚未改变" });
  const replayNow = () => run("POST", "/api/admin/keywords/draft/replay", {}, { label: "keyword-governance-replay", success: "历史人工标注样本回放完成" });
  const publish = async (reason: string) => !!(await run("POST", "/api/admin/keywords/draft/publish", { expectedRevision: d.profile.draft?.revision ?? 0, reason }, { label: "keyword-governance-publish", success: "正式关键词库已发布并生效" }));
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3"><div><div className="flex items-center gap-2"><b className="text-[14px] text-ink">{meta?.name ?? "新建新词筛选草稿"}</b><Badge tone={meta?.status === "published" ? "ok" : "warn"}>{meta ? "待回放 / 发布" : "尚未创建"}</Badge></div><p className="mt-1 text-[10.5px] text-ink-3">{meta ? "业务配置版本 " + d.profile.draft?.versionId + " · " + (meta.term_ids?.length ?? 0) + " 个新词簇" : "仅将已确认的新词加入配置草稿；正式词纠错在独立菜单处理。"}</p></div><div className="flex gap-4 text-center">{[["正向命中率", replay?.relatedPositiveHitAfter], ["负向命中率", replay?.unrelatedNegativeHitAfter], ["变化样本", replay?.changedCount]].map(([label, value]) => <div key={String(label)}><span className="block text-[9.5px] text-ink-4">{label}</span><b className="text-[16px] text-accent">{value ?? "—"}</b></div>)}</div><span className="rounded-control bg-amber/10 px-3 py-2 text-[10.5px] text-amber">草稿不生效，发布后生效</span></div>
    {meta?.official_change_ids?.length ? <Card title="当前待处理的是正式词纠错草稿"><p className="text-[11px] leading-5 text-ink-3">此草稿包含 {meta.official_change_ids.length} 项正式词调整{meta.term_ids?.length ? "，并含有此前已选择的 " + meta.term_ids.length + " 个新词簇" : ""}。请在“正式词纠错”菜单查看完整草稿并继续回放和发布。</p><Link className="mt-3 inline-flex h-9 items-center rounded-control bg-accent px-4 text-[11px] text-accent-contrast" to="/admin/keyword-corrections?view=draft">继续正式词纠错 →</Link></Card>
    : !meta && d.profile.draft?.versionId && d.profile.draft.versionId !== d.profile.current?.versionId ? <Card title="业务配置草稿尚未完成"><p className="text-[11px] leading-5 text-ink-3">当前已有尚未发布的业务关键词配置草稿。请先完成或处理该草稿，再创建新词筛选草稿，避免覆盖未完成的配置。</p><Link className="mt-3 inline-flex h-9 items-center rounded-control border border-line px-4 text-[11px] text-ink-2" to="/admin/business">打开业务关键词 →</Link></Card>
    : !meta ? <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]"><Card title="候选新词选择与草稿配置">
      <label><span className="mb-1 block text-[11px] text-ink-3">草稿名称</span><Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <label className="mt-3 block"><span className="mb-1 block text-[11px] text-ink-3">治理范围（可选）</span><Select value={contextId} onChange={(e) => setContextId(e.target.value)}><option value="">不限定</option>{(d.profile.draftProfile?.profile.contexts ?? []).map((x: Row) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select><small className="mt-1 block text-[10px] leading-5 text-ink-4">该范围只记入治理记录；当前业务配置不支持单个关键词的运行时行业限制。</small></label>
      <div className="mt-4 max-h-[440px] divide-y divide-line overflow-auto rounded-control border border-line">{terms.length ? terms.map((x: Row) => <label key={x.id} className="flex cursor-pointer items-start gap-2.5 px-3 py-3 hover:bg-bg-sunk/45"><input className="mt-1 accent-accent" type="checkbox" checked={selected.includes(Number(x.id))} onChange={(e) => setSelected((v) => e.target.checked ? [...new Set([...v, Number(x.id)])] : v.filter((id) => id !== Number(x.id)))} /><span className="min-w-0 flex-1"><b className="text-[11.5px] text-ink">{x.term}</b><span className="ml-2"><Badge tone={x.kind === "positive" ? "ok" : "bad"}>{KINDS[x.kind]}</Badge></span><small className="mt-1 block text-[9.5px] text-ink-4">{x.capabilityId} · 来源 {x.sourceCount} 篇</small><span className="mt-1 flex flex-wrap gap-1">{(x.variants ?? []).map((v: string) => <i key={v} className="rounded-full bg-bg-sunk px-2 py-0.5 text-[9.5px] not-italic text-ink-3">{v}</i>)}</span></span></label>) : <Empty>暂无候选词，请先完成人工词条判读。</Empty>}</div>
      <div className="mt-4 flex items-center justify-between"><span className="text-[10.5px] text-ink-3">已选 {selected.length} 个新词簇</span><Button tone="primary" busy={pending === "keyword-governance-draft"} disabled={!selected.length || !name.trim()} onClick={() => void create()}>生成新词草稿</Button></div>
    </Card><Card title="与现行正式词库整合" right={<Badge tone="info">业务配置 JSON</Badge>}><p className="mb-3 text-[11px] leading-5 text-ink-3">草稿基于当前业务配置草稿生成并保留已有业务字段。正向词写入能力的 semanticRoles，负向词写入 reviewNegativeTerms。当前正式配置不变。</p>{(d.profile.currentProfile?.profile.capabilities ?? []).map((c: Row) => <div key={c.id} className="mb-2 rounded-control border border-line px-3 py-2"><b className="text-[11px]">{c.name}</b><span className="float-right text-[9.5px] text-ink-4">正向 {c.serviceTerms.length + c.methodTerms.length + c.deliverableTerms.length} · 负向 {c.negativeKeywords.length}</span></div>)}<Json value={d.library.currentJson} label="查看现行业务配置 JSON" /></Card></div>
    : <div className="grid gap-4 xl:grid-cols-[minmax(370px,0.9fr)_minmax(0,1.2fr)]"><Card title="草稿配置" right={<Badge tone="info">版本 {d.profile.draft?.versionId}</Badge>}><div className="grid grid-cols-[90px_1fr] gap-2 text-[11px]"><span className="text-ink-4">名称</span><b>{meta.name}</b><span className="text-ink-4">新增词簇</span><b>{meta.term_ids?.length ?? 0} 个</b><span className="text-ink-4">治理范围</span><b>{d.profile.draftProfile?.profile.contexts.find((x: Row) => x.id === meta.context_id)?.name ?? "不限定"}</b></div><div className="mt-4 flex gap-2"><Button tone="primary" busy={pending === "keyword-governance-replay"} onClick={() => void replayNow()}>运行历史样本回放</Button><Link to="/admin/business" className="inline-flex h-9 items-center px-3 text-[11px] text-accent ring-1 ring-line">打开业务关键词</Link></div><div className="mt-4"><Json value={d.profile.jsonPreview} label="待发布业务配置 JSON 预览" /></div></Card>
      <Card title="回放验证" right={<span className="text-[10px] text-ink-4">只模拟词表命中，不重跑 AI，不修改历史标签</span>}>{!replay ? <div className="rounded-panel border border-dashed border-line-strong p-9 text-center"><b className="text-[13px]">尚未完成回放</b><p className="mx-auto mt-2 max-w-lg text-[11px] leading-5 text-ink-3">比较现行词库与草稿在已标注样本上的正向和负向命中变化。</p><Button className="mt-4" tone="primary" busy={pending === "keyword-governance-replay"} onClick={() => void replayNow()}>开始回放</Button></div> : <>
        <div className="mb-3 rounded-control bg-accent-soft/20 px-3 py-2 text-[10.5px] text-ink-3">样本 {num(replay.sampleCount)} 篇：相关 {num(replay.relatedCount)} · 不相关 {num(replay.unrelatedCount)} · 命中变化 {num(replay.changedCount)}</div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-panel border p-3"><small>相关样本正向命中</small><b className="mt-1 block text-[14px]">{rate(replay.relatedPositiveHitBefore)} → {rate(replay.relatedPositiveHitAfter)}</b></div><div className="rounded-panel border p-3"><small>不相关样本负向命中</small><b className="mt-1 block text-[14px]">{rate(replay.unrelatedNegativeHitBefore)} → {rate(replay.unrelatedNegativeHitAfter)}</b></div><div className="rounded-panel border p-3"><small>相关样本负向冲突</small><b className="mt-1 block text-[14px] text-hot">{num(replay.relatedNegativeConflictAfter)}</b></div><div className="rounded-panel border p-3"><small>回放完成</small><b className="mt-1 block text-[11px]">{bj(meta.replayed_at, true)}</b></div></div>
        <p className="mt-3 text-[10px] leading-5 text-ink-4">指标衡量词条命中覆盖，不等同于完整 AI 相关性准确率或自动精选结果。</p><div className="mt-3 max-h-[330px] overflow-auto rounded-control border"><table className="w-full min-w-[550px] text-left text-[10.5px]"><thead className="bg-surface-2"><tr><th className="px-3 py-2">变化文章</th><th className="px-3 py-2">人工标签</th><th className="px-3 py-2">现行词库</th><th className="px-3 py-2">草稿词库</th></tr></thead><tbody>{(replay.examples ?? []).map((x: Row) => <tr key={x.articleId} className="border-t border-line"><td className="max-w-[240px] px-3 py-2"><Link className="line-clamp-2 text-accent" to={"/admin/content/" + x.articleId}>{x.title}</Link></td><td className="px-3 py-2"><Badge tone={x.label === "relevant" ? "ok" : "bad"}>{LABELS[x.label]}</Badge></td><td className="px-3 py-2 text-ink-3">正 {x.before.positive.join("、") || "—"}<br />负 {x.before.negative.join("、") || "—"}</td><td className="px-3 py-2">正 {x.after.positive.join("、") || "—"}<br />负 {x.after.negative.join("、") || "—"}</td></tr>)}</tbody></table></div>
        <label className="mt-4 flex items-start gap-2 rounded-control bg-ok/5 p-3 text-[11px]"><input className="mt-1 accent-accent" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>我已核对回放指标及变化样例，确认无误后发布；历史标签不变。</span></label><div className="mt-3 flex justify-end"><Button tone="primary" disabled={!ack || !meta.replayed_at || meta.status === "published"} onClick={() => setPublishOpen(true)}>人工确认并发布</Button></div>
      </>}</Card>
      <ReasonDialog open={publishOpen} title="发布正式关键词库" description="发布后新采集和新分析将使用该版本；历史文章与人工标签不变。" confirmLabel="确认发布" busy={pending === "keyword-governance-publish"} onClose={() => setPublishOpen(false)} onSubmit={publish}><p className="rounded-control bg-amber/10 p-3 text-[11px] text-amber">发布原因会记入审计记录，并关联本次词库版本。</p></ReasonDialog>
    </div>}
  </>;
}
function rate(value: number | null | undefined) { return typeof value === "number" ? Math.round(value * 100) + "%" : "暂无"; }

function StepLibrary({ d, run, pending }: { d: Data; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const [kind, setKind] = useState<"positive" | "negative">("positive");
  const [target, setTarget] = useState<Row | null>(null);
  const json = d.library.currentJson ?? {};
  const caps: Row[] = json.capabilities ?? [];
  const rows = caps.flatMap((c) => {
    const positive = [...(c.semanticRoles?.serviceActions ?? []).map((term: string) => ({ term, role: "服务动作" })), ...(c.semanticRoles?.methods ?? []).map((term: string) => ({ term, role: "方法技术" })), ...(c.semanticRoles?.deliverables ?? []).map((term: string) => ({ term, role: "交付成果" }))];
    const negative = (c.reviewNegativeTerms ?? []).map((term: string) => ({ term, role: "负向词" }));
    return (kind === "positive" ? positive : negative).map((item: Row) => ({ ...item, capabilityName: c.name }));
  });
  const version = d.library.current?.versionId ?? d.library.currentProfile?.id ?? json.profileVersion ?? "seed-local";
  const targetVersionId = target?.id ?? "";
  const exportJson = () => { const blob = new Blob([JSON.stringify(json, null, 2) + "\n"], { type: "application/json;charset=utf-8" }); const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = "business.json"; a.click(); URL.revokeObjectURL(href); };
  const rollback = async (reason: string) => !!(await run("POST", "/api/admin/keywords/library/rollback", { versionId: targetVersionId, reason }, { label: "keyword-library-rollback-" + targetVersionId, success: "已回滚到词库版本 " + targetVersionId }));
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-4"><div><div className="flex items-center gap-2"><b className="text-[15px] text-ink">正式关键词库</b><Badge tone="ok">已生效</Badge></div><p className="mt-1 text-[10.5px] text-ink-3">运行版本 {version} · 最近发布 {bj(d.library.currentProfile?.published_at ?? null, true)} · 仅影响后续分析</p></div><div className="flex gap-2"><Button onClick={exportJson}>导出 business.json</Button><Link to="/admin/business" className="inline-flex h-9 items-center rounded-control px-3 text-[11px] ring-1 ring-line-strong">业务关键词管理 →</Link></div></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="正式正向词" value={caps.reduce((n, c) => n + (c.semanticRoles?.serviceActions?.length ?? 0) + (c.semanticRoles?.methods?.length ?? 0) + (c.semanticRoles?.deliverables?.length ?? 0), 0)} tone="ok" /><Stat label="正式负向词" value={caps.reduce((n, c) => n + (c.reviewNegativeTerms?.length ?? 0), 0)} tone="warn" /><Stat label="业务能力" value={caps.length} /><Stat label="历史版本" value={d.library.versions?.length ?? d.library.history?.length ?? 0} /></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.35fr)]"><Card title="正式词条" right={<div className="flex gap-1"><Button size="sm" tone={kind === "positive" ? "primary" : "secondary"} onClick={() => setKind("positive")}>正向词库</Button><Button size="sm" tone={kind === "negative" ? "primary" : "secondary"} onClick={() => setKind("negative")}>负向词库</Button></div>} pad={false}>
      <div className="border-b border-line bg-accent-soft/15 px-4 py-2 text-[10.5px] leading-5 text-ink-3">沿用现有人工维护的业务能力 JSON：正向词写入 semanticRoles，负向词写入 reviewNegativeTerms；导出文件保持现有 JSON 结构兼容。</div>
      {!rows.length ? <Empty>正式库暂时没有词条。</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-[11.5px]"><thead className="bg-surface-2/50 text-[10px]"><tr><th className="px-4 py-2.5">#</th><th className="px-4 py-2.5">正式词条</th><th className="px-4 py-2.5">词条角色</th><th className="px-4 py-2.5">业务能力</th><th className="px-4 py-2.5">状态</th></tr></thead><tbody>{rows.map((x: Row, i: number) => <tr key={x.capabilityName + x.role + x.term} className="border-t border-line"><td className="px-4 py-2.5 text-ink-4">{i + 1}</td><td className={"px-4 py-2.5 font-semibold " + (kind === "positive" ? "text-accent" : "text-hot")}>{x.term}</td><td className="px-4 py-2.5 text-ink-3">{x.role}</td><td className="px-4 py-2.5">{x.capabilityName}</td><td className="px-4 py-2.5"><Badge tone="ok">生效</Badge></td></tr>)}</tbody></table></div>}
      <details className="border-t border-line p-4"><summary className="cursor-pointer text-[11px] font-medium text-accent">查看完整运行 JSON</summary><div className="mt-3"><Json value={json} collapsed={false} label="industry/business.json 兼容内容" /></div></details>
    </Card><Card title="版本记录" right={<span className="text-[10px] text-ink-4">最多 100 个版本</span>} pad={false}>{!d.library.versions?.length ? <Empty>暂无版本历史。</Empty> : <div className="max-h-[700px] divide-y divide-line overflow-auto">{d.library.versions.map((x: Row) => <article key={x.id} className="px-4 py-3"><div className="flex items-center justify-between gap-2"><b className="text-[11.5px]">{x.id === version ? "当前正式版本" : x.id}</b><Badge tone={x.id === version ? "ok" : "muted"}>{x.status === "published" ? "生效" : x.status === "superseded" ? "历史" : x.status}</Badge></div><p className="mt-1 text-[9.5px] text-ink-4">{bj(x.published_at ?? x.created_at, true)} · {x.created_by}</p><details className="mt-2"><summary className="cursor-pointer text-[10.5px] text-accent">查看版本 JSON</summary><div className="mt-2"><Json value={x.aihotJson} label={"版本 " + x.id} /></div></details>{x.id !== version && <Button className="mt-2" size="sm" disabled={pending === "keyword-library-rollback-" + x.id} onClick={() => setTarget(x)}>回滚到此版本</Button>}</article>)}</div>}</Card></div>
    <ReasonDialog open={!!target} title="回滚正式关键词库" description={target ? "恢复到历史版本 " + target.id + "；当前版本会保留在历史记录中。" : ""} confirmLabel="确认回滚" busy={target ? pending === "keyword-library-rollback-" + target.id : false} onClose={() => setTarget(null)} onSubmit={rollback} danger><p className="rounded-control bg-amber/10 p-3 text-[10.5px] leading-5 text-amber">回滚会影响之后的 AI 分析；已保存的历史分析和人工标签不会改变。</p></ReasonDialog>
  </>;
}

export default function KeywordsAdmin({ loaderData }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const d = loaderData;
  const text = {
    samples: "回看已完成人工判读的文章。从历史 AI 任务分析中抽取词条，并核对它们是否真实出现在标题或正文。",
    clusters: "以去重词条簇为单位判读，核对 AI 提取的标准词、同义变体、关联业务能力和文档证据。仅显示能回溯到文章证据的词条。",
    pool: "按唯一词条统计来源文章、相关标签、不相关标签和重复出现频率。",
    draft: "将候选词加入业务配置草稿，在历史人工标签上回放后，确认再发布。",
    library: "查看和回滚正式关键词版本；运行 JSON 沿用 现行业务配置结构。",
  }[d.step];
  return <AdminPage wide title="新关键词筛选" subtitle={text}>
    <div className="mb-3 flex justify-end"><Link className="rounded-control border border-accent/20 bg-accent-soft/25 px-3 py-2 text-[10.5px] font-medium text-accent hover:bg-accent-soft/50" to="/admin/keyword-trends">关键词趋势 →</Link></div>
    <Steps active={d.step} />
      {d.step === "samples" && <StepSamples d={d} run={run} pending={pending} />}
      {d.step === "clusters" && <StepClusters d={d} run={run} pending={pending} />}
      {d.step === "pool" && <StepPool d={d} />}
      {d.step === "draft" && <StepDraft d={d} run={run} pending={pending} />}
      {d.step === "library" && <StepLibrary d={d} run={run} pending={pending} />}
  </AdminPage>;
}
