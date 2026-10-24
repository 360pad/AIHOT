import { SITE } from "@aihot/industry/site";
import { useState } from "react";
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
  selectionPolicyVersion?: string;
  calibrationExamples?: Array<{ articleId: string; title: string; label: string; capabilityIds: string[] }>;
  projects?: Array<{ name?: string; tasks?: Array<{ name?: string; action?: string; object?: string; deliverables?: string[]; matches?: Array<{ capabilityId: string; relation: string; rationale: string }> }> }>;
  evidence?: Evidence[];
  qualificationRequirements?: Array<{ kind: "company" | "personnel"; requirement: string; evidenceIds: string[] }>;
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
  businessScore?: { total: number; dimensions: { taskFit: ScoreAxis; delivery: ScoreAxis; importance: ScoreAxis } };
  regionScore?: ScoreAxis;
  scoreBreakdown?: { business: number; region: number; deadline: number; total: number; weights: { fit: number; region: number; deadline: number } };
  selectionPolicy?: {
    weights: { fit: number; region: number; deadline: number };
    featuredThreshold: number; reviewFloor: number; reviewHighFloor?: number; dueSoonDays: number;
    dimensions: { taskFit: { max: number }; delivery: { max: number }; importance: { max: number } };
  };
};
type ReviewRow = {
  article_id: string; title: string; url: string; source_name: string; source_tier: string; discovered_at: string; published_at: string | null;
  body_status: string; excerpt: string | null; body_preview: string; title_zh: string | null; summary_zh: string | null; category: string | null;
  procurementFacts: { buyer: string | null; budget: string | null; location: string | null; deadline: string | null; method: string | null };
  positiveHits: KeywordHit[]; negativeHits: KeywordHit[]; prefilter_402_failed: boolean;
  relevance: string | null; score: number | null; selected: boolean | null; model: string | null; prompt_version: string | null;
  published_selected: boolean; manual_selected: boolean; override_version: number; publication_visibility: string | null;
  reason_zh: string | null; analysis_output: AnalysisOutput | null;
  human_label: string | null; human_capability_ids: string[] | null; human_evidence_quality: string | null; human_note: string | null; human_reviewed_at: string | null;
  human_history: Array<{ label: string; capabilityIds: string[]; evidenceQuality: string | null; note: string | null; createdAt: string }>;
  qualificationExtractionAvailable: boolean;
  qualificationRequirements: Array<{ kind: "company" | "personnel"; requirement: string; evidenceIds: string[]; matchedName: string | null; evidence: string[] }>;
};
type Data = {
  page: number; pageSize: number; total: number; sampleEligibleTotal: number | null; filter: string; humanStatus: string; days: number; profileVersion: string; runSlot: string;
  collectionBatches: Array<{ slot: string; sourceCount: number; foundCount: number; newCount: number; failedCount: number; runningCount: number }>;
  selectedCollectionBatch: { slot: string; sourceCount: number; foundCount: number; newCount: number; failedCount: number; runningCount: number; retainedCount: number; passCount: number; unknownCount: number; unanalyzedCount: number } | null;
  rules: { positive: KeywordHit[]; negative: KeywordHit[]; capabilities: Array<{ id: string; name: string }>; scoreThresholds: Record<string, number>; scoreCalls: number; understandFloor: number; dueSoonDays: number; featuredThreshold: number; reviewFloor: number; reviewHighFloor: number; weights: { fit: number; region: number; deadline: number }; dimensions: Array<{ key: string; label: string; max: number }> };
  rows: ReviewRow[];
  bulkPreview: { days: number; threshold: number; total: number; rows: Array<{ article_id: string; title: string; score: number; relevance: string }> };
};
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const filter = url.searchParams.get("filter") ?? "priority";
  const dayParam = url.searchParams.get("days");
  const days = dayParam === null ? 30 : Number(dayParam);
  const page = Number(url.searchParams.get("page") ?? 1) || 1;
  const runSlot = url.searchParams.get("runSlot") ?? "";
  const humanStatus = url.searchParams.get("humanStatus") ?? "unmarked";
  const bulkDays = Number(url.searchParams.get("bulkDays") ?? 1) || 1;
  const [data, bulkPreview] = await Promise.all([
    adminGet<Omit<Data, "q" | "bulkPreview">>(request, `/api/admin/review?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&humanStatus=${encodeURIComponent(humanStatus)}&days=${days}&page=${page}&runSlot=${encodeURIComponent(runSlot)}`),
    adminGet<Data["bulkPreview"]>(request, `/api/admin/review/bulk-preview?days=${bulkDays}`),
  ]);
  return { ...data, q, bulkPreview };
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
  const businessScore = row.analysis_output?.businessScore;
  const selectionPolicy = row.analysis_output?.selectionPolicy;
  if (businessScore && selectionPolicy) {
    const threshold = selectionPolicy.featuredThreshold;
    const breakdown = row.analysis_output?.scoreBreakdown;
    const score = breakdown?.total ?? row.score ?? businessScore.total;
    const tone = scoreTone(score, threshold);
    const toneClass = tone === "ok" ? "border-ok/20 bg-ok/5 text-ok" : tone === "warn" ? "border-amber/25 bg-amber/5 text-amber" : tone === "bad" ? "border-hot/20 bg-hot-soft/60 text-hot" : "border-line bg-bg-sunk/60 text-ink-3";
    const dimensions = [
      ["taskFit", "采购任务与企业能力匹配", selectionPolicy.dimensions.taskFit.max],
      ["delivery", "交付内容吻合", selectionPolicy.dimensions.delivery.max],
      ["importance", "相关任务重要性", selectionPolicy.dimensions.importance.max],
    ] as const;
    const status = row.analysis_output?.deadlineStatus;
    const deadlineLabel = status === "passed" ? "已截止/已开标" : status === "due_soon" ? `临近开标 · ${selectionPolicy.dueSoonDays} 天内` : status === "open" ? "有效期内" : "时限未确认";
    const regionMax = selectionPolicy.weights?.region ?? 0;
    const deadlineMax = selectionPolicy.weights?.deadline ?? 0;
    const deadlineReason = status === "passed" ? "截止时间已过，综合总分归零并剔除。" : status === "open" ? "项目仍在有效期，获得全部时效分。" : status === "due_soon" ? "临近开标，按规则获得一半时效分并转人工复核。" : "时限未确认，按中性分处理并保留人工复核。";
    return (
      <section className="rounded-panel border border-line bg-surface p-4 xl:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-[15px] font-semibold text-ink">综合评分拆解</h3><p className="mt-1 text-[12px] text-ink-3">业务、地域与时效合计 100 分；业务结论与评分来自同一次 AI 判读</p></div><div className={`flex min-w-[116px] items-baseline justify-center gap-1 rounded-panel border px-4 py-2 ${toneClass}`}><span className="num text-[30px] font-bold leading-none">{score}</span><span className="text-[12px] font-semibold">/ 100</span></div></div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone={tone}>{score >= threshold ? "达到精选分数线" : score >= selectionPolicy.reviewFloor ? "进入人工复核分数段" : "低于人工复核起始分"}</Badge><Badge tone="info">精选线 {threshold}</Badge><Badge tone={status === "passed" ? "bad" : status === "due_soon" ? "warn" : status === "open" ? "ok" : "muted"}>{deadlineLabel}</Badge><Badge tone={row.relevance === "pass" ? "ok" : row.relevance === "unknown" ? "warn" : "muted"}>业务结论 {row.relevance?.toUpperCase() ?? "未判读"}</Badge></div>
        <div className="mt-4 space-y-3">{dimensions.map(([key, label, max]) => {
          const axis = businessScore.dimensions[key];
          const axisTone = axis.score >= max * 0.7 ? "bg-ok" : axis.score >= max * 0.4 ? "bg-amber" : "bg-hot";
          return <div key={key} className="rounded-control bg-bg-sunk/55 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">{label}</div><div className="num text-[13px] font-semibold text-ink-2">{axis.score} / {max} 分</div></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70"><div className={`h-full rounded-full ${axisTone}`} style={{ width: `${max ? axis.score / max * 100 : 0}%` }} /></div><p className="mt-2 break-words text-[12.5px] leading-5 text-ink-3">{axis.reason}</p></div>;
        })}
          <div className="rounded-control bg-bg-sunk/55 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">地域匹配</div><div className="num text-[13px] font-semibold text-ink-2">{breakdown?.region ?? row.analysis_output?.regionScore?.score ?? "—"} / {regionMax} 分</div></div><p className="mt-2 break-words text-[12.5px] leading-5 text-ink-3">{row.analysis_output?.regionScore?.reason ?? "地域判读依据未记录。"}</p></div>
          <div className="rounded-control bg-bg-sunk/55 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-ink">开标时效</div><div className="num text-[13px] font-semibold text-ink-2">{breakdown?.deadline ?? "—"} / {deadlineMax} 分</div></div><p className="mt-2 break-words text-[12.5px] leading-5 text-ink-3">{deadlineReason}</p></div>
        </div>
        <p className="mt-3 text-[11.5px] text-ink-4">综合复核起始分 {selectionPolicy.reviewFloor} · 复核业务高分线 {selectionPolicy.reviewHighFloor ?? selectionPolicy.reviewFloor} · 配置版本 {row.analysis_output?.businessMatch?.selectionPolicyVersion ?? "未记录"} · 模型 {row.model ?? "未记录"}</p>
      </section>
    );
  }
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

function ReviewActions({ row, capabilities: availableCapabilities, run, pending }: { row: ReviewRow; capabilities: Data["rules"]["capabilities"]; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const initialIds = row.human_capability_ids?.length ? row.human_capability_ids : null;
  const analysisCapabilities = row.analysis_output?.businessMatch?.projects?.flatMap((project) => project.tasks?.flatMap((task) => task.matches?.map((match) => match.capabilityId) ?? []) ?? []) ?? [];
  const inferredIds = [...new Set([...row.positiveHits.map((hit) => hit.capabilityId), ...analysisCapabilities])];
  const [capabilities, setCapabilities] = useState<string[]>(initialIds ?? inferredIds);
  const mark = (label: "relevant" | "irrelevant" | "unknown") => run("POST", "/api/admin/business/feedback", {
    articleId: row.article_id,
    label,
    capabilityIds: capabilities,
    participation: "unknown",
    evidenceQuality: label === "unknown" ? "insufficient" : "limited",
    note: `AI 人工复核：${LABELS[label]}`,
  }, { label: `review-${row.article_id}-${label}`, success: `${row.title} 已保存人工标注` });
  const feature = () => run("POST", `/api/admin/review/${encodeURIComponent(row.article_id)}/feature`, { version: row.override_version }, {
    label: `review-${row.article_id}-feature`, success: `${row.title} 已人工纳入精选`,
  });
  return (
    <section className="rounded-panel bg-bg-sunk/60 p-4 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold text-ink">人工判读</h3>{row.human_label ? <Badge tone="ok">已标注</Badge> : <Badge tone="warn">待复核</Badge>}</div><div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2 xl:grid-cols-4">
        <Button tone="primary" busy={pending === `review-${row.article_id}-relevant`} onClick={() => void mark("relevant")}>标记相关</Button>
        <Button busy={pending === `review-${row.article_id}-irrelevant`} onClick={() => void mark("irrelevant")}>标记无关</Button>
        <Button busy={pending === `review-${row.article_id}-unknown`} onClick={() => void mark("unknown")}>保留待补证据</Button>
        {row.manual_selected ? <Button disabled>已人工纳入精选</Button> : row.published_selected ? <Button disabled>已在精选</Button> : <Button tone="primary" busy={pending === `review-${row.article_id}-feature`} onClick={() => void feature()}>人工纳入精选</Button>}
      </div></div>
      {row.human_label && <p className="mt-3 text-[13px] font-medium text-ink">{LABELS[row.human_label] ?? row.human_label}<span className="mt-1 block text-[11.5px] font-normal text-ink-4">{row.human_reviewed_at ? bj(row.human_reviewed_at, true) : ""}</span></p>}
      <fieldset className="mt-4 rounded-control border border-line bg-surface/70 p-3">
        <legend className="px-1 text-[12px] font-medium text-ink-3">关联企业能力（用于后续校准）</legend>
        <div className="grid gap-2 sm:grid-cols-2">{availableCapabilities.map((capability) => <label key={capability.id} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-ink-2"><input type="checkbox" className="mt-1 accent-accent" checked={capabilities.includes(capability.id)} onChange={(event) => setCapabilities((current) => event.target.checked ? [...new Set([...current, capability.id])] : current.filter((id) => id !== capability.id))} /><span>{capability.name}</span></label>)}</div>
        <p className="mt-2 text-[11px] leading-5 text-ink-4">人工标记会作为后续校准样例。相关时从 AI 采购任务中提取有原文依据的新正向词；无关且业务高分时整理负向词。候选词需人工加入草稿并发布，才进入正式词库。</p>
      </fieldset>
      {row.human_note && <p className="mt-3 break-words text-[12.5px] leading-6 text-ink-3">{row.human_note}</p>}
      {row.human_history?.length > 0 && <details className="mt-4 text-[12px] text-ink-3"><summary className="cursor-pointer font-medium">标注历史（{row.human_history.length} 次）</summary><ul className="mt-2 space-y-2">{row.human_history.map((item, index) => <li key={`${item.createdAt}-${index}`} className="border-t border-line pt-2">{bj(item.createdAt, true)} · {LABELS[item.label] ?? item.label}{item.note ? ` · ${item.note}` : ""}</li>)}</ul></details>}
      <p className="mt-3 text-[11.5px] leading-5 text-ink-4">“人工纳入精选”会保留 AI 原始判定和评分，只改变精选展示；过期、非公开或缺少中文标题/摘要的内容不能纳入。</p>
    </section>
  );
}

function QualificationRequirements({ row }: { row: ReviewRow }) {
  if (row.relevance !== "pass" && row.human_label !== "relevant") return null;
  const coverage = row.analysis_output?.businessMatch?.materialCoverage;
  const missing = row.qualificationRequirements.some((item) => !item.matchedName);
  return <section className="rounded-panel border border-amber/25 bg-amber/5 p-4 xl:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[14px] font-semibold text-ink">投标资质要求核对</h3><Badge tone={missing ? "warn" : row.qualificationRequirements.length ? "ok" : "muted"}>{missing ? "有要求待核实" : row.qualificationRequirements.length ? "已与资质清单比对" : "未识别到明确要求"}</Badge></div>
    {!row.qualificationExtractionAvailable ? <p className="mt-2 text-[12.5px] leading-6 text-ink-3">这条历史分析没有资质提取记录。重新分析后才会生成核对结果；打开页面不会调用 AI。</p>
      : row.qualificationRequirements.length ? <ul className="mt-3 space-y-2">{row.qualificationRequirements.map((item, index) => <li key={`${item.kind}-${item.requirement}-${index}`} className={`rounded-control px-3 py-2.5 ${item.matchedName ? "bg-ok/5 ring-1 ring-ok/15" : "bg-amber/10 ring-1 ring-amber/20"}`}>
        <div className="flex flex-wrap items-center gap-2"><Badge tone="info">{item.kind === "company" ? "公司资质" : "人员证书"}</Badge><b className="text-[13px] text-ink-2">{item.requirement}</b><Badge tone={item.matchedName ? "ok" : "warn"}>{item.matchedName ? `清单已登记：${item.matchedName}` : "清单未登记，请核实"}</Badge></div>
        {item.evidence.map((quote, quoteIndex) => <p key={quoteIndex} className="mt-1.5 text-[12px] leading-5 text-ink-3">原文依据：“{quote}”</p>)}
      </li>)}</ul>
      : <p className="mt-2 text-[12.5px] leading-6 text-ink-3">AI 未从已读取材料中识别到明确的公司资质或人员证书要求。{coverage && coverage.status !== "complete" ? ` 材料覆盖：${coverage.status === "partial" ? "部分读取" : coverage.status === "missing" ? "正文或附件缺失" : "未确认"}，请结合招标文件附件核实。` : ""}</p>}
    <p className="mt-3 text-[11.5px] leading-5 text-ink-4">“已登记”只表示资质名称在当前清单中，不代表已完成投标资格审查；AI 未读取到附件时请打开原文核实。</p>
  </section>;
}

export default function ReviewAdmin({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const pageCount = Math.max(1, Math.ceil(d.total / d.pageSize));
  const link = (page: number) => `/admin/review?${new URLSearchParams({ q: d.q, filter: d.filter, humanStatus: d.humanStatus, days: String(d.days), runSlot: d.runSlot, page: String(page) })}`;
  return (
    <AdminPage wide title="AI 判读复核" subtitle="优先抽查 AI 高分、关键词与 AI 结论不一致，以及 UNKNOWN 样本；标记相关或无关，为判读校准和关键词候选积累样本。">
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Stat label="当前队列" value={d.total} hint={`第 ${d.page} / ${pageCount} 页`} />
        <Stat label="正向规则词" value={d.rules.positive.length} hint={<span title={d.profileVersion} className="block max-w-full truncate">规则版本 {d.profileVersion}</span>} tone="ok" />
        <Stat label="负向规则词" value={d.rules.negative.length} hint="命中后结合采购任务判断，不单独自动排除" tone="warn" />
      </div>

      <Card title="低分样本批量判读" right={<Badge tone="info">总分低于 {d.bulkPreview.threshold} 分</Badge>} className="mb-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] xl:items-start">
          <div>
            <p className="text-[13px] leading-6 text-ink-3">仅筛选未人工标注、业务分为 0、没有正向或负向关键词命中、AI 未判相关且已读取到正文或摘要的文章。批量标记保留 AI 原判，只写入人工“不相关”，不会生成负向关键词候选。</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Badge tone={d.bulkPreview.total ? "warn" : "ok"}>近 {d.bulkPreview.days} 天符合 {d.bulkPreview.total} 条</Badge>
              <form method="get" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="q" value={d.q} /><input type="hidden" name="filter" value={d.filter} /><input type="hidden" name="humanStatus" value={d.humanStatus} /><input type="hidden" name="days" value={d.days} /><input type="hidden" name="runSlot" value={d.runSlot} /><input type="hidden" name="page" value="1" />
                <label className="flex items-center gap-2 text-[12.5px] text-ink-3">批量范围<Select name="bulkDays" defaultValue={String(d.bulkPreview.days)} className="!w-auto"><option value="1">近 1 天</option><option value="7">近 7 天</option><option value="30">近 30 天</option></Select></label>
                <Button type="submit" size="sm">刷新预览</Button>
              </form>
              <Button tone="primary" disabled={!d.bulkPreview.total} busy={pending === `review-low-score-bulk-${d.bulkPreview.days}`} onClick={() => {
                const message = `将把近 ${d.bulkPreview.days} 天内符合条件的 ${d.bulkPreview.total} 篇文章标记为人工不相关。AI 原判会保留。确认继续吗？`;
                if (!window.confirm(message)) return;
                void run("POST", "/api/admin/review/bulk-mark-irrelevant", { days: d.bulkPreview.days, expectedCount: d.bulkPreview.total }, {
                  label: `review-low-score-bulk-${d.bulkPreview.days}`, success: `已批量标记 ${d.bulkPreview.total} 篇文章为人工不相关`,
                });
              }}>批量标记为不相关</Button>
            </div>
          </div>
          <div className="rounded-control bg-bg-sunk/50 p-3">
            <div className="text-[12px] font-medium text-ink-3">符合条件的文章样例</div>
            {d.bulkPreview.rows.length ? <ul className="mt-2 space-y-1.5">{d.bulkPreview.rows.slice(0, 5).map((row) => <li key={row.article_id} className="flex items-start justify-between gap-3 text-[12px] leading-5"><span className="min-w-0 break-words text-ink-2">{row.title}</span><span className="num shrink-0 text-ink-4">{Number(row.score).toFixed(0)} 分</span></li>)}</ul> : <p className="mt-2 text-[12px] text-ink-4">当前没有符合条件的未标注文章。</p>}
          </div>
        </div>
      </Card>

      <Card title="判读规则" right={<Link to="/admin/scoring" className="font-medium text-accent hover:underline">精选规则配置 →</Link>} className="mb-4">
        <div className="grid gap-5 2xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.7fr)] 2xl:items-start">
          <div className="min-w-0 rounded-panel bg-accent/5 p-4 ring-1 ring-accent/10">
            <h3 className="text-[14px] font-semibold text-ink">关键词负责召回，AI 负责理解采购任务</h3>
            <p className="mt-2 text-[13px] leading-6 text-ink-3">标题、摘要和已采正文的命中词用于找候选；AI 再结合采购对象、动作和交付判断语义。通用词如“平台、系统、服务、运维”不能单独作为相关依据。负向词须确实描述本次采购任务，不能被背景、其他标段或附带义务误触发。</p>
            <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer font-medium text-accent">查看当前正向词与负向词</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><div><b>正向词</b><div className="mt-2 max-h-56 overflow-auto rounded-control bg-surface p-3 leading-6 ring-1 ring-line">{d.rules.positive.map((item, i) => <span key={`${item.capabilityId}-${item.role}-${item.term}-${i}`} className="mr-2 inline-block">{item.term}<span className="text-ink-4"> / {item.capabilityName} / {ROLE_LABELS[item.role] ?? item.role}</span></span>)}</div></div><div><b>负向词组</b><div className="mt-2 max-h-56 overflow-auto rounded-control bg-surface p-3 leading-6 ring-1 ring-line">{d.rules.negative.map((item, i) => <span key={`${item.capabilityId}-${item.term}-${i}`} className="mr-2 inline-block">{item.term}<span className="text-ink-4"> / {item.capabilityName}</span></span>)}</div></div></div></details>
            <Link to="/admin/business" className="mt-3 inline-block text-[12.5px] font-medium text-accent hover:underline">编辑业务能力和负向关键词 →</Link>
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-ink">先核时限，再用同一次判读给出业务结论和分数</h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <section className="rounded-panel bg-ok/5 p-4 ring-1 ring-ok/15"><b className="text-ok">PASS</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">同一采购任务存在直接或部分能力匹配，并有可核验的标题、摘要或正文证据。PASS 和业务分来自同一次模型判读，未命中关键词不阻止通过。</p></section>
              <section className="rounded-panel bg-amber/5 p-4 ring-1 ring-amber/15"><b className="text-amber">UNKNOWN</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">网页内容不足或业务分较高但缺少可核验任务证据时进入人工队列。页面会展示各分项得分、评分理由、摘要和原文证据。</p></section>
              <section className="rounded-panel bg-hot-soft/50 p-4 ring-1 ring-hot/15"><b className="text-hot">BLOCK / 过期</b><p className="mt-2 text-[12.5px] leading-6 text-ink-3">AI 排除或已过期会退出当前机会，文章记录仍保留；复核分组可抽查高分和关键词冲突样本，已过期记录只用于历史核对。</p></section>
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><Badge tone="ok">综合精选线 {d.rules.featuredThreshold} / 100</Badge><Badge tone="warn">综合复核起始 {d.rules.reviewFloor} / 100</Badge><Badge tone="info">复核业务高分线 {d.rules.reviewHighFloor} / {d.rules.weights.fit}</Badge><Badge tone="muted">临近开标 {d.rules.dueSoonDays} 天不自动精选</Badge></div>
          </div>
        </div>
      </Card>

      <Card title="文章复核队列" right={<span>{d.filter === "low-no-keyword" ? `每日抽样 ${d.total} / 符合条件 ${d.sampleEligibleTotal ?? 0} 条` : `采集时间倒序 · 每页 ${d.pageSize} 条`}</span>} pad={false}>
        <Form method="get" className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 2xl:grid-cols-[minmax(200px,1.1fr)_minmax(220px,1.25fr)_minmax(240px,1.35fr)_minmax(130px,0.65fr)_minmax(140px,0.7fr)_auto] 2xl:items-end xl:px-5 xl:py-4">
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">搜索文章</span><Input name="q" defaultValue={d.q} placeholder="标题、正文关键词" /></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">复核分组</span><Select name="filter" defaultValue={d.filter}><optgroup label="判读校准样本"><option value="priority">重点复核（高分、低分关键词命中、UNKNOWN）</option><option value="high-keyword">高业务分 + 关键词命中</option><option value="high-no-keyword">高业务分 + 无关键词命中</option><option value="low-keyword">低业务分 + 关键词命中</option><option value="low-no-keyword">低业务分 + 无关键词命中（每日抽样）</option></optgroup><optgroup label="状态与历史排查"><option value="unknown">AI 判为 UNKNOWN</option><option value="unreviewed">旧版待复核范围</option><option value="keyword">正向命中且无负向词</option><option value="keyword-and-negative">正负关键词同时命中</option><option value="ai-rejected">AI 非 BLOCK：未精选或未分析</option><option value="unanalyzed">尚无 AI 判定（处理中或失败）</option><option value="prefilter-402-keyword">402 批次 + 正向命中</option><option value="prefilter-402">相关性预筛曾 HTTP 402</option><option value="all">全部文章历史</option></optgroup></Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">采集批次（日期 / 时段）</span><Select name="runSlot" defaultValue={d.runSlot}><option value="">不限定批次</option>{d.collectionBatches.map((batch) => <option key={batch.slot} value={batch.slot}>{batch.slot.replace("T", " ")}:00 · 新增 {batch.newCount} / 抓取 {batch.foundCount} · {batch.sourceCount} 个信源{batch.failedCount ? ` · 失败 ${batch.failedCount}` : ""}</option>)}</Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">采集范围</span><Select name="days" defaultValue={String(d.days)}><option value="1">近 1 天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="0">全部历史</option></Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">人工标记状态</span><Select name="humanStatus" defaultValue={d.humanStatus}><option value="unmarked">未标记</option><option value="marked">已标记</option><option value="all">全部</option></Select></label>
          <input type="hidden" name="page" value="1" />
          <Button type="submit" tone="primary">筛选队列</Button>
        </Form>
        {d.selectedCollectionBatch && <div className="border-b border-line bg-accent-soft/20 px-5 py-4 xl:px-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <div><div className="text-[11.5px] text-ink-4">本次采集</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.slot.replace("T", " ")}:00</div></div>
          <div><div className="text-[11.5px] text-ink-4">参与信源</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.sourceCount} 个{d.selectedCollectionBatch.runningCount ? ` · ${d.selectedCollectionBatch.runningCount} 个仍在运行` : ""}</div></div>
          <div><div className="text-[11.5px] text-ink-4">列表发现条目</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.foundCount.toLocaleString()} 条</div></div>
          <div><div className="text-[11.5px] text-ink-4">抓取时新入库</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.newCount.toLocaleString()} 条</div></div>
          <div><div className="text-[11.5px] text-ink-4">当前保留文章</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.retainedCount} 条 · PASS {d.selectedCollectionBatch.passCount} / UNKNOWN {d.selectedCollectionBatch.unknownCount} / 未分析 {d.selectedCollectionBatch.unanalyzedCount}</div></div>
          <div><div className="text-[11.5px] text-ink-4">失败信源</div><div className="mt-1 text-[14px] font-semibold text-ink">{d.selectedCollectionBatch.failedCount} 个</div></div>
          </div>
          <p className="mt-3 text-[11.5px] leading-5 text-ink-4">文章记录会保留。BLOCK 表示 AI 排除当前机会，不代表从文章库删除；高分/关键词分组和“全部文章历史”可抽查其中的误判。</p>
        </div>}
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
                  <div className="flex shrink-0 flex-wrap items-center gap-2"><Badge tone={status.tone}>{status.text}</Badge><Badge tone="info">业务 {row.analysis_output?.businessScore?.total ?? row.analysis_output?.scoreBreakdown?.business ?? "—"}/{d.rules.weights.fit}</Badge><Badge tone={scoreToneValue}>{row.score === null ? "总分未生成" : `总分 ${row.score}/100`}</Badge>{row.prefilter_402_failed && <Badge tone="bad">预筛曾 HTTP 402</Badge>}</div>
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
                        {!row.positiveHits.length && <p className="mt-3 text-[12.5px] leading-6 text-ink-4">未命中具体服务动作、方法或交付词；行业/对象词（如“公共资源交易”）只作 AI 上下文，不算正向关键词。AI 判定请看卡片顶部状态。</p>}
                        {negativeTerms.length > 0 && <p className="mt-3 rounded-control bg-hot-soft px-3 py-2 text-[12.5px] leading-6 text-hot">负向词只提示核对，不代表自动否决；请看它是否描述本次采购任务。</p>}
                      </section>
                      <AiEvidence row={row} />
                    </div>
                    <div className="min-w-0 space-y-4"><ScoreEvidence row={row} /><QualificationRequirements row={row} /><ReviewActions row={row} capabilities={d.rules.capabilities} run={run} pending={pending} /></div>
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
