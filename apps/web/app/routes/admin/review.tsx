import { SITE } from "@aihot/industry/site";
import { Form, Link } from "react-router";
import type { Route } from "./+types/review";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Input, Select, Stat } from "../../features/admin/ui";
import { CATEGORIES } from "@aihot/industry/taxonomy";

type KeywordHit = { term: string; capabilityId: string; capabilityName: string; role: string };
type Evidence = { id: string; quote: string; source: string; strength: string; verified?: boolean };
type BusinessMatch = {
  label?: string;
  reason?: string;
  calibrationExamples?: Array<{ articleId: string; title: string; label: string; capabilityIds: string[] }>;
  projects?: Array<{ name?: string; tasks?: Array<{ name?: string; action?: string; object?: string; deliverables?: string[]; matches?: Array<{ capabilityId: string; relation: string; rationale: string }> }> }>;
  evidence?: Evidence[];
  missingInformation?: string[];
  materialCoverage?: { status?: string; sectionsRead?: string[]; missing?: string[]; notes?: string };
};
type ScoreAxis = { score: number; reason: string };
type ScoreDetails = { fit?: ScoreAxis; region?: ScoreAxis; deadline?: ScoreAxis; stage?: ScoreAxis; scale?: ScoreAxis; trend?: ScoreAxis };
type AnalysisOutput = {
  scores?: number[] | null;
  scoreDetails?: ScoreDetails[] | null;
  scoreWeights?: { fit: number; region: number; deadline: number } | null;
  dueSoonDays?: number;
  deadlineStatus?: "open" | "due_soon" | "passed" | "unknown";
  threshold?: number | null;
  prefilter?: { label?: string; reason?: string };
  itemType?: string | null;
  businessMatch?: BusinessMatch;
  scoreModel?: string;
};
type ReviewRow = {
  article_id: string; title: string; url: string; source_name: string; source_tier: string; discovered_at: string; published_at: string | null;
  body_status: string; excerpt: string | null; body_preview: string; title_zh: string | null; summary_zh: string | null; category: string | null;
  procurementFacts: { buyer: string | null; budget: string | null; location: string | null; deadline: string | null; method: string | null };
  positiveHits: KeywordHit[]; negativeHits: KeywordHit[]; prefilter_402_failed: boolean;
  relevance: string | null; score: number | null; selected: boolean | null; model: string | null; prompt_version: string | null;
  reason_zh: string | null; analysis_output: AnalysisOutput | null;
  human_label: string | null; human_capability_ids: string[] | null; human_evidence_quality: string | null; human_note: string | null; human_reviewed_at: string | null;
  human_history: Array<{ label: string; capabilityIds: string[]; evidenceQuality: string | null; note: string | null; createdAt: string }>;
};
type Data = {
  page: number; pageSize: number; total: number; filter: string; days: number; profileVersion: string;
  rules: { positive: KeywordHit[]; negative: KeywordHit[]; scoreThresholds: Record<string, number>; scoreCalls: number; understandFloor: number; dueSoonDays: number; dimensions: Array<{ key: string; label: string; weight: number }> };
  rows: ReviewRow[];
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const filter = url.searchParams.get("filter") ?? "unreviewed";
  const dayParam = url.searchParams.get("days");
  const days = dayParam === null ? 30 : Number(dayParam);
  const page = Number(url.searchParams.get("page") ?? 1) || 1;
  const data = await adminGet<Data>(request, `/api/admin/review?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&days=${days}&page=${page}`);
  return { ...data, q };
}

export const meta: Route.MetaFunction = () => [{ title: `AI 人工复核 · ${SITE.name} 后台` }];

const LABELS: Record<string, string> = { relevant: "人工判定相关", irrelevant: "人工判定无关", unknown: "人工判定待补证据" };
const ROLE_LABELS: Record<string, string> = { serviceAction: "服务动作", method: "方法技术", deliverable: "交付成果", object: "对象场景", negative: "负向词" };
const AXIS_LABELS: Record<string, string> = { fit: "业务匹配", region: "地域匹配", deadline: "开标时效", stage: "旧版阶段", scale: "旧版规模", trend: "旧版趋势" };
const LEGACY_WEIGHTS: Record<string, number> = { fit: 40, stage: 20, scale: 20, trend: 20 };

function aiStatus(row: ReviewRow) {
  if (row.relevance === "block") return { text: "AI 判定：排除", tone: "bad" as const };
  if (row.relevance === "unknown") return { text: "AI 判定：待人工复核", tone: "warn" as const };
  if (row.analysis_output?.deadlineStatus === "passed") return { text: "投标截止/开标已过", tone: "muted" as const };
  if (row.analysis_output?.deadlineStatus === "due_soon") return { text: "临近开标 · 低优先级", tone: "warn" as const };
  if (row.relevance === "pass" && row.selected) return { text: "AI 已精选", tone: "ok" as const };
  if (row.relevance === "pass") return { text: "AI 判相关，未达精选线", tone: "accent" as const };
  return { text: "尚无 AI 结论", tone: "muted" as const };
}

function uniqueHits(hits: KeywordHit[]) {
  return [...new Set(hits.map((hit) => hit.term))];
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  tender_notice: "招标/采购公告", procurement_intention: "采购意向", tender_plan: "招标计划",
  pre_bid_notice: "标前公示", award_result: "中标/成交结果", policy_market_signal: "行业动态",
};

function scoreTone(score: number | null, threshold: number | null) {
  if (score === null || threshold === null) return "muted" as const;
  if (threshold !== null && score >= threshold) return "ok" as const;
  if (threshold !== null && score >= threshold - 10) return "warn" as const;
  return "bad" as const;
}

function KeyFact({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="min-w-0 rounded-control bg-bg-sunk/55 px-3 py-2.5"><div className="text-[11.5px] font-medium text-ink-4">{label}</div><div className="mt-1 break-words text-[13px] font-medium leading-5 text-ink-2">{value || "未从已采材料中识别"}</div></div>;
}

function AiEvidence({ row }: { row: ReviewRow }) {
  const output = row.analysis_output;
  const business = output?.businessMatch;
  const reason = output?.prefilter?.reason ?? business?.reason ?? row.reason_zh;
  const projects = business?.projects ?? [];
  const evidence = business?.evidence ?? [];
  const visibleEvidence = evidence.slice(0, 2);
  const additionalEvidence = evidence.slice(2);
  const coverage = business?.materialCoverage;
  return (
    <section className="rounded-panel border border-accent/20 bg-accent-soft/25 p-4 text-[13.5px] leading-7 text-ink-2 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">AI 相关性判读理由</h3>
        {coverage && <Badge tone={coverage.status === "complete" ? "ok" : "info"}>网页材料：{coverage.status === "partial" ? "部分读取" : coverage.status === "complete" ? "已读完整" : coverage.status === "missing" ? "缺失" : "未确认"}</Badge>}
      </div>
      {reason ? <p className="mt-3 whitespace-pre-wrap break-words">{reason}</p> : <p className="mt-3 text-ink-4">这条历史分析没有保存独立判读理由。</p>}
      {row.prefilter_402_failed && <p className="mt-3 rounded-control bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>请求故障记录：</b>相关性预筛曾收到 HTTP 402；当前显示的是已保存的后续分析，不代表评分接口也发生了 402。</p>}
      {coverage && <div className="mt-3 rounded-control bg-surface/80 px-3 py-2 text-[12.5px] text-ink-3"><b>材料覆盖：</b>已读 {coverage.sectionsRead?.join("、") || "未记录"}；待核实 {coverage.missing?.join("、") || "无"}{coverage.notes ? `；${coverage.notes}` : ""}</div>}
      {projects.length > 0 && <div className="mt-4 space-y-3">{projects.map((project, i) => <div key={`${project.name}-${i}`} className="rounded-control border border-line bg-surface/80 p-4"><b className="text-ink">{project.name || `采购项目 ${i + 1}`}</b>{project.tasks?.map((task, j) => <div key={`${task.name}-${j}`} className="mt-2 border-l-2 border-accent/30 pl-3"><p>{[task.name, task.action, task.object, ...(task.deliverables ?? [])].filter(Boolean).join(" · ") || "未拆出具体采购任务"}</p>{task.matches?.map((match, k) => <p key={k} className="mt-1 text-[12.5px] text-ink-3">能力 {match.capabilityId}（{match.relation === "direct" ? "直接匹配" : match.relation === "partial" ? "部分匹配" : match.relation}）：{match.rationale}</p>)}</div>)}</div>)}</div>}
      {visibleEvidence.length > 0 && <div className="mt-4"><h4 className="font-semibold text-ink">原文证据</h4><ul className="mt-1 space-y-2">{visibleEvidence.map((item) => <li key={item.id} className="break-words rounded-control bg-surface/80 px-3 py-2"><span className="mr-2 text-[12px] text-ink-4">{item.source} · {item.verified ? "已核验" : "未核验"}</span>“{item.quote}”</li>)}</ul>{additionalEvidence.length > 0 && <details className="mt-2 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">展开其余 {additionalEvidence.length} 条原文证据</summary><ul className="mt-2 space-y-2">{additionalEvidence.map((item) => <li key={item.id} className="break-words rounded-control bg-surface/80 px-3 py-2">{item.source} · {item.verified ? "已核验" : "未核验"}：“{item.quote}”</li>)}</ul></details>}</div>}
      {business?.missingInformation?.length ? <p className="mt-3"><b className="text-ink">尚无法确认：</b>{business.missingInformation.join("、")}</p> : null}
      {business?.calibrationExamples?.length ? <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">参考的人工校准样例（{business.calibrationExamples.length}）</summary><p className="mt-2">{business.calibrationExamples.map((item) => `${item.title}（${item.label === "relevant" ? "相关" : "无关"}）`).join("；")}</p></details> : null}
      {row.body_preview && <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">查看采集到的网页正文片段</summary><p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface/80 p-3">{row.body_preview}</p></details>}
      <Link to={`/admin/content/${row.article_id}`} className="mt-4 inline-block text-[12.5px] font-medium text-accent hover:underline">打开内容完整链路 →</Link>
    </section>
  );
}

function ScoreEvidence({ row }: { row: ReviewRow }) {
  const details = row.analysis_output?.scoreDetails ?? [];
  const scores = row.analysis_output?.scores ?? [];
  const currentWeights = row.analysis_output?.scoreWeights;
  const deadlineStatus = row.analysis_output?.deadlineStatus;
  const deadlineLabel = deadlineStatus === "passed" ? "已过期" : deadlineStatus === "due_soon" ? `剩余 ${row.analysis_output?.dueSoonDays ?? 4} 天内` : deadlineStatus === "open" ? "仍可跟进" : "日期未确认";
  const weights = currentWeights ?? { fit: 60, region: 25, deadline: 15 };
  const tone = scoreTone(row.score, row.analysis_output?.threshold ?? null);
  const totalToneClass = tone === "ok" ? "border-ok/20 bg-ok/5 text-ok" : tone === "warn" ? "border-amber/25 bg-amber/5 text-amber" : tone === "bad" ? "border-hot/20 bg-hot-soft/60 text-hot" : "border-line bg-bg-sunk/60 text-ink-3";
  const dimensions = [
    { key: "fit", label: "业务匹配", weight: weights.fit },
    { key: "region", label: "地域匹配", weight: weights.region },
    { key: "deadline", label: "开标时效", weight: weights.deadline },
  ] as const;
  return (
    <section className="rounded-panel border border-line bg-surface p-4 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[15px] font-semibold text-ink">AI 评分拆解</h3><p className="mt-1 text-[12px] text-ink-3">业务 {weights.fit}% · 地域 {weights.region}% · 时效 {weights.deadline}%</p></div><div className={`flex min-w-[116px] items-baseline justify-center gap-1 rounded-panel border px-4 py-2 ${totalToneClass}`}><span className="num text-[30px] font-bold leading-none">{row.score ?? "—"}</span><span className="text-[12px] font-semibold">/ 100</span></div></div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone={tone}>{row.score === null ? "尚未评分" : row.score >= (row.analysis_output?.threshold ?? 101) ? "达到精选分数线" : "低于精选分数线"}</Badge><Badge tone="muted">门槛 {row.analysis_output?.threshold ?? "未评分"}</Badge><Badge tone={deadlineStatus === "passed" ? "bad" : deadlineStatus === "due_soon" ? "warn" : deadlineStatus === "open" ? "ok" : "muted"}>{deadlineLabel}</Badge>{scores.length === 2 && <span className="text-[12px] text-ink-4">两次独立总分：{scores[0]}、{scores[1]} → 均分 {row.score}</span>}</div>
      {details.length > 0 ? <div className="mt-4 space-y-3">{dimensions.map(({ key, label, weight }) => {
        const axisScores = details.map((detail) => detail[key]?.score).filter((value): value is number => typeof value === "number");
        const average = axisScores.length ? axisScores.reduce((sum, value) => sum + value, 0) / axisScores.length : null;
        const contribution = average === null ? null : average * weight / 10;
        const reasons = details.map((detail, index) => ({ reason: detail[key]?.reason, index })).filter((item): item is { reason: string; index: number } => !!item.reason);
        const axisTone = average === null ? "bg-line-strong" : average >= 7 ? "bg-ok" : average >= 4 ? "bg-amber" : "bg-hot";
        return <div key={key} className="rounded-control bg-bg-sunk/55 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">{label}<span className="ml-1 text-[11.5px] font-normal text-ink-4">权重 {weight}%</span></div><div className="num text-[13px] font-semibold text-ink-2">{average === null ? "—" : `${average.toFixed(1).replace(/\.0$/, "")}/10`}{axisScores.length > 1 ? `（${axisScores.join("、")}）` : ""}<span className="ml-2 text-[11.5px] font-normal text-ink-4">贡献约 {contribution === null ? "—" : contribution.toFixed(1).replace(/\.0$/, "")} 分</span></div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70"><div className={`h-full rounded-full ${axisTone}`} style={{ width: `${(average ?? 0) * 10}%` }} /></div>{reasons.map(({ reason, index }) => <p key={`${key}-${index}`} className="mt-2 break-words text-[12.5px] leading-5 text-ink-3">{reasons.length > 1 ? `第 ${index + 1} 次：` : "依据："}{reason}</p>)}</div>;
      })}</div> : scores.length > 0 ? <p className="mt-4 rounded-control bg-bg-sunk px-3 py-2 text-[12.5px] text-ink-3">这条历史分析只保存了总分，未保存逐项评分理由。</p> : <p className="mt-4 text-[12.5px] text-ink-4">尚未完成 AI 评分。</p>}
      <p className="mt-3 break-all font-mono text-[10.5px] text-ink-4">{row.prompt_version ?? "无提示词版本记录"} · {row.analysis_output?.scoreModel ?? row.model ?? "模型未记录"}</p>
    </section>
  );
}

function ReviewActions({ row, run, pending }: { row: ReviewRow; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const analysisCapabilities = row.analysis_output?.businessMatch?.projects?.flatMap((project) => project.tasks?.flatMap((task) => task.matches?.map((match) => match.capabilityId) ?? []) ?? []) ?? [];
  const capabilities = [...new Set([...row.positiveHits.map((hit) => hit.capabilityId), ...analysisCapabilities])];
  const mark = (label: "relevant" | "irrelevant" | "unknown") => run("POST", "/api/admin/business/feedback", {
    articleId: row.article_id,
    label,
    capabilityIds: capabilities,
    participation: "unknown",
    evidenceQuality: label === "unknown" ? "insufficient" : "limited",
    note: `AI 人工复核：${LABELS[label]}`,
  }, { label: `review-${row.article_id}-${label}`, success: `${row.title} 已保存人工标注` });
  return (
    <section className="rounded-panel bg-bg-sunk/60 p-4 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold text-ink">人工判读</h3>{row.human_label ? <Badge tone="ok">已标注</Badge> : <Badge tone="warn">待复核</Badge>}</div><div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
        <Button tone="primary" busy={pending === `review-${row.article_id}-relevant`} onClick={() => void mark("relevant")}>标记相关</Button>
        <Button busy={pending === `review-${row.article_id}-irrelevant`} onClick={() => void mark("irrelevant")}>标记无关</Button>
        <Button busy={pending === `review-${row.article_id}-unknown`} onClick={() => void mark("unknown")}>保留待补证据</Button>
      </div></div>
      {row.human_label && <p className="mt-3 text-[13px] font-medium text-ink">{LABELS[row.human_label] ?? row.human_label}<span className="mt-1 block text-[11.5px] font-normal text-ink-4">{row.human_reviewed_at ? bj(row.human_reviewed_at, true) : ""}</span></p>}
      {row.human_note && <p className="mt-3 break-words text-[12.5px] leading-6 text-ink-3">{row.human_note}</p>}
      {row.human_history?.length > 0 && <details className="mt-4 text-[12px] text-ink-3"><summary className="cursor-pointer font-medium">标注历史（{row.human_history.length} 次）</summary><ul className="mt-2 space-y-2">{row.human_history.map((item, index) => <li key={`${item.createdAt}-${index}`} className="border-t border-line pt-2">{bj(item.createdAt, true)} · {LABELS[item.label] ?? item.label}{item.note ? ` · ${item.note}` : ""}</li>)}</ul></details>}
      <p className="mt-3 text-[11.5px] leading-5 text-ink-4">人工标注会进入业务校准样例，供后续判读参考；中标结果仍保留为独立学习样本。</p>
    </section>
  );
}

export default function ReviewAdmin({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const pageCount = Math.max(1, Math.ceil(d.total / d.pageSize));
  const link = (page: number) => `/admin/review?${new URLSearchParams({ q: d.q, filter: d.filter, days: String(d.days), page: String(page) })}`;
  return (
    <AdminPage wide title="AI 人工复核" subtitle="AI 结论、命中关键词、原文证据和人工标注在同一视图展开；UNKNOWN 会进入待判读队列，不因网页信息不全而静默消失。">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Stat label="当前队列" value={d.total} hint={`第 ${d.page} / ${pageCount} 页`} />
        <Stat label="正向规则词" value={d.rules.positive.length} hint={<span title={d.profileVersion} className="block max-w-full truncate">规则版本 {d.profileVersion}</span>} tone="ok" />
        <Stat label="负向规则词" value={d.rules.negative.length} hint="命中后结合采购任务判断，不单独自动排除" tone="warn" />
      </div>

      <Card title="判读规则" right={<Link to="/admin/scoring" className="font-medium text-accent hover:underline">评分权重设置 →</Link>} className="mb-4">
        <div className="grid gap-5 2xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.7fr)] 2xl:items-start">
          <div className="min-w-0 rounded-panel bg-accent/5 p-4 ring-1 ring-accent/10">
            <h3 className="text-[14px] font-semibold text-ink">关键词负责召回，AI 负责理解采购任务</h3>
            <p className="mt-2 text-[13px] leading-6 text-ink-3">标题、摘要和已采正文的命中词用于找候选；AI 再结合采购对象、动作和交付判断语义。通用词如“平台、系统、服务、运维”不能单独作为相关依据。负向词须确实描述本次采购任务，不能被背景、其他标段或附带义务误触发。</p>
            <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">查看当前正向词与负向词</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><div><b>正向词</b><div className="mt-2 max-h-56 overflow-auto rounded-control bg-surface p-3 leading-6 ring-1 ring-line">{d.rules.positive.map((item, i) => <span key={`${item.capabilityId}-${item.role}-${item.term}-${i}`} className="mr-2 inline-block">{item.term}<span className="text-ink-4"> / {item.capabilityName} / {ROLE_LABELS[item.role] ?? item.role}</span></span>)}</div></div><div><b>负向词组</b><div className="mt-2 max-h-56 overflow-auto rounded-control bg-surface p-3 leading-6 ring-1 ring-line">{d.rules.negative.map((item, i) => <span key={`${item.capabilityId}-${item.term}-${i}`} className="mr-2 inline-block">{item.term}<span className="text-ink-4"> / {item.capabilityName}</span></span>)}</div></div></div></details>
            <Link to="/admin/business" className="mt-3 inline-block text-[12.5px] font-medium text-accent hover:underline">编辑业务能力和负向关键词 →</Link>
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-ink">PASS、UNKNOWN 和 BLOCK 的处理</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <section className="rounded-panel bg-ok/5 p-4 ring-1 ring-ok/15"><b className="text-ok">PASS</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">标题、摘要或网页正文已明确说明采购任务，并能与企业能力直接或部分对应；不要求先下载招标文件，也不要求详情参数齐全。</p></section>
              <section className="rounded-panel bg-amber/5 p-4 ring-1 ring-amber/15"><b className="text-amber">UNKNOWN</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">仅用于页面解析失败、采购范围未写清、相关词只是背景提及或标段信息无法归属。进入默认人工队列；理由、证据和具体缺口会展开显示。</p></section>
              <section className="rounded-panel bg-hot-soft/50 p-4 ring-1 ring-hot/15"><b className="text-hot">BLOCK</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">网页已说明实际交付与企业能力无关，且负向排除确实针对本次采购任务。词面命中本身不能决定 BLOCK。</p></section>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{Object.entries(d.rules.scoreThresholds).map(([tier, threshold]) => <Badge key={tier}>{tier === "T1" ? "官方一手" : tier === "T1_5" ? "官方账号" : tier === "T2" ? "媒体/个人" : tier}精选线：{threshold} 分</Badge>)}<Badge tone="info">每条 PASS 独立评分 {d.rules.scoreCalls} 次</Badge></div>
          </div>
        </div>
      </Card>

      <Card title="文章复核队列" right={<span>采集时间倒序 · 每页 {d.pageSize} 条</span>} pad={false}>
        <Form method="get" className="grid gap-3 border-b border-line p-4 lg:grid-cols-[minmax(240px,1.4fr)_minmax(250px,1fr)_minmax(150px,0.55fr)_auto] lg:items-end xl:px-5 xl:py-4">
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">搜索文章</span><Input name="q" defaultValue={d.q} placeholder="标题、正文关键词" /></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">复核范围</span><Select name="filter" defaultValue={d.filter}><option value="unreviewed">尚未人工标注（默认队列）</option><option value="unknown">AI 判为 UNKNOWN（待人工复核）</option><option value="keyword">关键词候选（正向命中且无负向）</option><option value="keyword-and-negative">正负关键词同时命中</option><option value="ai-rejected">AI 未入选或未分析</option><option value="prefilter-402-keyword">402 批次 + 关键词候选</option><option value="prefilter-402">相关性预筛曾 HTTP 402</option><option value="all">全部文章</option></Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">采集范围</span><Select name="days" defaultValue={String(d.days)}><option value="1">近 1 天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="0">全部历史</option></Select></label>
          <input type="hidden" name="page" value="1" />
          <Button type="submit" tone="primary">筛选队列</Button>
        </Form>
        {d.filter.startsWith("prefilter-402") && <div className="border-b border-line bg-amber-50 px-5 py-3 text-[12.5px] leading-6 text-amber-900">此筛选定位曾在相关性预筛收到 HTTP 402 的文章。失败收据与后来保存的分析是两条记录；组合筛选只保留命中正向词且未命中负向词的文章。选择“全部历史”可以查看所有批次。</div>}
        {!d.rows.length ? <Empty>当前条件下没有文章。选择“AI 判为 UNKNOWN”可单独检查待判读内容，或切换“全部文章”查看分析历史。</Empty> : (
          <div className="space-y-4 p-4 xl:space-y-5 xl:p-6">
            {d.rows.map((row) => {
              const status = aiStatus(row);
              const positiveTerms = uniqueHits(row.positiveHits);
              const negativeTerms = uniqueHits(row.negativeHits);
              const summary = row.summary_zh?.trim() || row.excerpt?.trim() || row.body_preview?.trim() || "当前文章没有可展示的摘要或正文片段。";
              const summaryLabel = row.summary_zh?.trim() ? "AI 摘要" : row.excerpt?.trim() ? "网页摘要" : row.body_preview?.trim() ? "正文摘录" : "摘要内容";
              const category = CATEGORIES.find((item) => item.key === row.category)?.label ?? row.category ?? null;
              const facts = row.procurementFacts;
              const deadlineLabel = row.analysis_output?.deadlineStatus === "passed" ? "AI 判断：已截止" : row.analysis_output?.deadlineStatus === "due_soon" ? `AI 判断：${row.analysis_output?.dueSoonDays ?? 4} 天内截止` : row.analysis_output?.deadlineStatus === "open" ? "AI 判断：仍在有效期" : "AI 未能判断截止状态";
              const scoreToneValue = scoreTone(row.score, row.analysis_output?.threshold ?? null);
              return <article key={row.article_id} className="overflow-hidden rounded-panel bg-surface ring-1 ring-line">
                <header className="flex flex-col gap-3 border-b border-line bg-surface-2/60 px-5 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-6">
                  <div className="min-w-0"><Link to={`/admin/content/${row.article_id}`} className="break-words text-[16px] font-semibold leading-7 text-ink hover:text-accent">{row.title}</Link><p className="mt-1 text-[12px] text-ink-3">{row.source_name} · {row.source_tier || "未分级"} · 采集 {bj(row.discovered_at, true)} · 正文 {row.body_status}</p></div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2"><Badge tone={status.tone}>{status.text}</Badge><Badge tone={scoreToneValue}>{row.score === null ? "总分未生成" : `总分 ${row.score}/100`}</Badge>{row.prefilter_402_failed && <Badge tone="bad">预筛曾 HTTP 402</Badge>}</div>
                </header>
                <div className="space-y-4 p-4 xl:space-y-5 xl:p-6">
                  <section>
                    <h3 className="text-[13px] font-semibold text-ink">项目基本信息</h3>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                      <KeyFact label="公告类别" value={row.analysis_output?.itemType ? ITEM_TYPE_LABELS[row.analysis_output.itemType] ?? row.analysis_output.itemType : null} />
                      <KeyFact label="所属行业" value={category} />
                      <KeyFact label="采购人" value={facts.buyer} />
                      <KeyFact label="预算 / 最高限价（原文）" value={facts.budget} />
                      <KeyFact label="项目地点（原文）" value={facts.location} />
                      <KeyFact label="投标截止 / 开标时间（原文）" value={facts.deadline} />
                      <KeyFact label="采购方式（原文）" value={facts.method} />
                      <KeyFact label="发布时间" value={row.published_at ? bj(row.published_at, true) : null} />
                      <KeyFact label="AI 截止状态" value={deadlineLabel} />
                      <KeyFact label="AI 项目名称" value={row.title_zh && row.title_zh !== row.title ? row.title_zh : null} />
                    </div>
                  </section>
                  <section className="rounded-panel border border-accent/15 bg-accent-soft/15 p-4 xl:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[13px] font-semibold text-ink">{summaryLabel}</h3><span className="text-[11.5px] text-ink-4">先看采购内容，再核对 AI 判断</span></div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px] leading-6 text-ink-2">{summary.length > 900 ? `${summary.slice(0, 900)}…` : summary}</p>
                    {summary.length > 900 && <details className="mt-2 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">在卡片内展开完整摘要</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-control bg-surface/80 p-3 leading-6 text-ink-2">{summary}</p></details>}
                    {!row.summary_zh && !row.excerpt && row.body_preview && <details className="mt-2 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">展开更多网页正文摘录</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-control bg-surface/80 p-3 leading-6 text-ink-2">{row.body_preview}</p></details>}
                  </section>
                  <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.25fr)_minmax(420px,0.9fr)] 2xl:items-start">
                    <div className="min-w-0 space-y-4">
                      <section className="rounded-panel border border-line bg-surface p-4 xl:p-5">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-[14px] font-semibold text-ink">关键词命中</h3><Badge tone="ok">正向 {positiveTerms.length} 个</Badge><Badge tone={negativeTerms.length ? "bad" : "muted"}>负向 {negativeTerms.length} 个</Badge></div>
                        <div className="mt-3 flex flex-wrap gap-2">{positiveTerms.map((hit) => <Badge key={hit} tone="ok">+ {hit}</Badge>)}{negativeTerms.map((hit) => <Badge key={`negative-${hit}`} tone="bad">− {hit}</Badge>)}{!positiveTerms.length && !negativeTerms.length && <span className="text-[13px] text-ink-4">未命中现行词表，AI 仍可能通过语义识别</span>}</div>
                        {row.positiveHits.length > 0 && <p className="mt-3 text-[12.5px] leading-6 text-ink-3">对应能力：{[...new Set(row.positiveHits.map((hit) => hit.capabilityName))].join("、")}</p>}
                        {negativeTerms.length > 0 && <p className="mt-3 rounded-control bg-hot-soft px-3 py-2 text-[12.5px] leading-6 text-hot">负向词只提示核对，不代表自动否决；请看它是否描述本次采购任务。</p>}
                      </section>
                      <AiEvidence row={row} />
                    </div>
                    <div className="min-w-0 space-y-4"><ScoreEvidence row={row} /><ReviewActions row={row} run={run} pending={pending} /></div>
                  </div>
                </div>
              </article>;
            })}
          </div>
        )}
        {d.total > d.pageSize && <div className="flex items-center justify-between border-t border-line px-5 py-4 text-[12.5px] text-ink-3"><span>共 {d.total} 条 · 第 {d.page} / {pageCount} 页</span><div className="flex gap-2"><Link aria-disabled={d.page <= 1} className={`rounded-control px-3 py-1.5 ring-1 ring-line ${d.page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-bg-sunk"}`} to={link(Math.max(1, d.page - 1))}>上一页</Link><Link aria-disabled={d.page >= pageCount} className={`rounded-control px-3 py-1.5 ring-1 ring-line ${d.page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-bg-sunk"}`} to={link(Math.min(pageCount, d.page + 1))}>下一页</Link></div></div>}
      </Card>
    </AdminPage>
  );
}
