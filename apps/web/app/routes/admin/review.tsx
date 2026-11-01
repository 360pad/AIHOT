import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/review";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Input, Select } from "../../features/admin/ui";

type KeywordHit = { term: string; capabilityId: string; capabilityName: string; role: string };
type AiKeywordCandidate = { kind: string; phrase: string; evidence_source: string; evidence: string | null };
type Evidence = { id: string; quote: string; source: string; strength: string; verified?: boolean };
type BusinessMatch = {
  label?: string;
  reason?: string;
  businessScore?: { total?: number };
  selectionPolicyVersion?: string;
  calibrationExamples?: Array<{ articleId: string; title: string; label: string; capabilityIds: string[] }>;
  projects?: Array<{ name?: string; tasks?: Array<{ name?: string; action?: string; object?: string; methods?: string[]; deliverables?: string[]; matches?: Array<{ capabilityId: string; relation: string; rationale: string }> }> }>;
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
  positiveHits: KeywordHit[]; negativeHits: KeywordHit[]; ai_keyword_candidates?: AiKeywordCandidate[]; prefilter_402_failed: boolean;
  relevance: string | null; score: number | null; selected: boolean | null; model: string | null; prompt_version: string | null;
  published_selected: boolean; manual_selected: boolean; override_version: number; publication_visibility: string | null;
  reason_zh: string | null; analysis_output: AnalysisOutput | null;
  human_label: string | null; human_capability_ids: string[] | null; human_evidence_quality: string | null; human_note: string | null; human_reviewed_at: string | null;
  human_history: Array<{ label: string; capabilityIds: string[]; evidenceQuality: string | null; note: string | null; createdAt: string }>;
  qualificationExtractionAvailable: boolean;
  qualificationRequirements: Array<{ kind: "company" | "personnel"; requirement: string; evidenceIds: string[]; matchedName: string | null; evidence: string[] }>;
};
type Data = {
  page: number; pageSize: number; total: number; sampleEligibleTotal: number | null; sampleLimit?: number | null; filter: string; humanStatus: string; days: number; profileVersion: string; runSlot: string;
  articleId: string | null;
  humanLabelCounts: { relevant: number; irrelevant: number };
  collectionBatches: Array<{ slot: string; sourceCount: number; foundCount: number; newCount: number; failedCount: number; runningCount: number }>;
  selectedCollectionBatch: { slot: string; sourceCount: number; foundCount: number; newCount: number; failedCount: number; runningCount: number; retainedCount: number; passCount: number; unknownCount: number; unanalyzedCount: number; manualReviewRequired?: number; manualMarked?: number; manualPending?: number } | null;
  rules: { positive: KeywordHit[]; negative: KeywordHit[]; capabilities: Array<{ id: string; name: string }>; scoreThresholds: Record<string, number>; scoreCalls: number; understandFloor: number; dueSoonDays: number; featuredThreshold: number; reviewFloor: number; reviewHighFloor: number; weights: { fit: number; region: number; deadline: number }; dimensions: Array<{ key: string; label: string; max: number }> };
  rows: ReviewRow[];
  bulkPreview: { days: number; threshold: number; total: number; selectedBatchSlot: string | null; selectedBatchTotal: number | null; rows: Array<{ article_id: string; title: string; score: number; relevance: string }> };
};
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const filter = url.searchParams.get("filter") ?? "priority";
  const dayParam = url.searchParams.get("days");
  const days = dayParam === null ? 30 : Number(dayParam);
  const page = Number(url.searchParams.get("page") ?? 1) || 1;
  const runSlot = url.searchParams.get("runSlot") ?? "";
  const articleId = url.searchParams.get("articleId") ?? "";
  const humanStatus = url.searchParams.get("humanStatus") ?? "unmarked";
  const bulkDays = Number(url.searchParams.get("bulkDays") ?? 1) || 1;
  const [data, bulkPreview] = await Promise.all([
    adminGet<Omit<Data, "q" | "bulkPreview">>(request, `/api/admin/review?q=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&humanStatus=${encodeURIComponent(humanStatus)}&days=${days}&page=${page}&runSlot=${encodeURIComponent(runSlot)}&articleId=${encodeURIComponent(articleId)}`),
    adminGet<Data["bulkPreview"]>(request, `/api/admin/review/bulk-preview?days=${bulkDays}&runSlot=${encodeURIComponent(runSlot)}`),
  ]);
  return { ...data, q, bulkPreview };
}

export const meta: Route.MetaFunction = () => [{ title: `AI 人工复核 · ${SITE.name} 后台` }];

const LABELS: Record<string, string> = { relevant: "人工判定相关", irrelevant: "人工判定不相关", unknown: "待重新明确判断" };
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

function aiBusinessExpressions(row: ReviewRow) {
  const tasks = row.analysis_output?.businessMatch?.projects?.flatMap((project) => project.tasks ?? []) ?? [];
  const expressions = tasks.flatMap((task) => [
    ["任务", task.name], ["动作", task.action], ["对象", task.object],
    ...(task.methods ?? []).map((phrase) => ["方法", phrase] as const),
    ...(task.deliverables ?? []).map((phrase) => ["交付", phrase] as const),
  ]).filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0);
  return [...new Map(expressions.map(([kind, phrase]) => [phrase.trim().toLocaleLowerCase(), { kind, phrase: phrase.trim() }])).values()];
}

function AiKeywordExtraction({ row, businessScore, threshold }: { row: ReviewRow; businessScore: number; threshold: number }) {
  const expressions = aiBusinessExpressions(row);
  const evidence = (row.analysis_output?.businessMatch?.evidence ?? []).filter((item) => item.quote).slice(0, 3);
  return <section className="review-keyword-hits border-accent/20 bg-accent-soft/15">
    <div className="flex flex-wrap items-center gap-2"><h3>AI 识别的业务词组</h3><Badge tone={expressions.length ? "info" : "warn"}>{expressions.length ? `提取到 ${expressions.length} 组` : "未提取到可用词组"}</Badge><Badge tone="info">业务分 {businessScore} · 高分线 {threshold}</Badge></div>
    {expressions.length ? <div className="review-term-tags">{expressions.map(({ kind, phrase }) => <Badge key={`${kind}-${phrase}`} tone="info">{kind} · {phrase}</Badge>)}</div> : <p className="mt-2 text-[12px] text-ink-3">已保存的 AI 任务拆解中没有可展示的任务、动作、方法或交付词组。</p>}
    {evidence.length ? <div className="mt-3 space-y-1 text-[11.5px] leading-5 text-ink-3"><b>AI 原文证据</b>{evidence.map((item, index) => <p key={`${item.id}-${index}`}>“{item.quote}”</p>)}</div> : <p className="mt-2 text-[11px] text-ink-4">这条分析没有保存可展示的原文证据。</p>}
    <p className="mt-2 text-[11px] leading-5 text-ink-4">正式词没有命中。人工判为相关时，原文出现且词表未收录的任务、动作、方法或交付表达可进入正向候选；判为不相关时，高业务分下有原文依据的表达才形成负向线索。</p>
  </section>;
}

function AiKeywordCandidates({ candidates }: { candidates: AiKeywordCandidate[] }) {
  if (!candidates.length) return null;
  return <section className="review-keyword-hits border-accent/20 bg-accent-soft/15">
    <div className="flex flex-wrap items-center gap-2"><h3>AI 提取词（词库候选）</h3><Badge tone="info">{candidates.length} 条</Badge></div>
    <div className="mt-2 space-y-2">{candidates.map((candidate) => <div key={`${candidate.kind}-${candidate.phrase}`}>
      <Badge tone={candidate.kind === "positive" ? "ok" : "bad"}>{candidate.kind === "positive" ? "正向" : "负向"} · {candidate.phrase}</Badge>
      {candidate.evidence && <p className="mt-1 text-[11.5px] leading-5 text-ink-3">{candidate.evidence_source === "title" ? "标题" : "正文"}原文依据：“{candidate.evidence}”</p>}
    </div>)}</div>
    <p className="mt-2 text-[11px] leading-5 text-ink-4">这些词条来自人工标注样本中的 AI 任务表达，仍是治理候选，尚不代表已加入正式词表。</p>
  </section>;
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
  const coverage = business?.materialCoverage;
  return (
    <section className="rounded-panel border border-accent/20 bg-accent-soft/25 p-4 text-[13.5px] leading-7 text-ink-2 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">AI 相关性判读（业务匹配）</h3>
        {coverage && <Badge tone={coverage.status === "complete" ? "ok" : "info"}>网页材料：{coverage.status === "partial" ? "部分读取" : coverage.status === "complete" ? "已读完整" : coverage.status === "missing" ? "缺失" : "未确认"}</Badge>}
      </div>
      <p className="mt-2 text-[13px] font-medium text-ink-3">判断公告中的采购任务是否匹配已维护的企业业务能力。</p>
      {reason ? <p className="mt-3 whitespace-pre-wrap break-words">{reason}</p> : <p className="mt-3 text-ink-4">这条历史分析没有保存独立判读理由。</p>}
      {row.prefilter_402_failed && <p className="mt-3 rounded-control bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>请求故障记录：</b>相关性预筛曾收到 HTTP 402；当前显示的是已保存的后续分析，不代表评分接口也发生了 402。</p>}
      {coverage && <div className="mt-3 rounded-control bg-surface/80 px-3 py-2 text-[12.5px] text-ink-3"><b>材料覆盖：</b>已读 {coverage.sectionsRead?.join("、") || "未记录"}；待核实 {coverage.missing?.join("、") || "无"}{coverage.notes ? `；${coverage.notes}` : ""}</div>}
      {projects.length > 0 && <div className="mt-4 space-y-3">{projects.map((project, i) => <div key={`${project.name}-${i}`} className="rounded-control border border-line bg-surface/80 p-4"><b className="text-ink">{project.name || `采购项目 ${i + 1}`}</b>{project.tasks?.map((task, j) => <div key={`${task.name}-${j}`} className="mt-2 border-l-2 border-accent/30 pl-3"><p>{[task.name, task.action, task.object, ...(task.deliverables ?? [])].filter(Boolean).join(" · ") || "未拆出具体采购任务"}</p>{task.matches?.map((match, k) => <p key={k} className="mt-1 text-[12.5px] text-ink-3">能力 {match.capabilityId}（{match.relation === "direct" ? "直接匹配" : match.relation === "partial" ? "部分匹配" : match.relation}）：{match.rationale}</p>)}</div>)}</div>)}</div>}
      {evidence.length > 0 && <div className="mt-4"><h4 className="font-semibold text-ink">原文证据</h4><ul className="mt-1 space-y-2">{evidence.map((item) => <li key={item.id} className="break-words rounded-control bg-surface/80 px-3 py-2"><span className="mr-2 text-[12px] text-ink-4">{item.source} · {item.verified ? "已核验" : "未核验"}</span>“{item.quote}”</li>)}</ul></div>}
      {business?.missingInformation?.length ? <p className="mt-3"><b className="text-ink">尚无法确认：</b>{business.missingInformation.join("、")}</p> : null}
      {business?.calibrationExamples?.length ? <div className="mt-3 text-[12.5px]"><b>参考的人工校准样例（{business.calibrationExamples.length}）：</b>{business.calibrationExamples.map((item) => `${item.title}（${item.label === "relevant" ? "相关" : "无关"}）`).join("；")}</div> : null}
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
      <section className="review-score-evidence rounded-panel border border-line bg-surface p-4 xl:p-5">
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
    <section className="review-score-evidence rounded-panel border border-line bg-surface p-4 xl:p-5">
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
  const mark = (label: "relevant" | "irrelevant") => run("POST", "/api/admin/business/feedback", {
    articleId: row.article_id,
    label,
    capabilityIds: capabilities,
    participation: "unknown",
    evidenceQuality: "limited",
    note: `AI 人工复核：${LABELS[label]}`,
  }, { label: `review-${row.article_id}-${label}`, success: `${row.title} 已保存人工标注` });
  const feature = () => run("POST", `/api/admin/review/${encodeURIComponent(row.article_id)}/feature`, { version: row.override_version }, {
    label: `review-${row.article_id}-feature`, success: `${row.title} 已人工纳入精选`,
  });
  return (
    <>
      <div className="review-human-context">
        <fieldset className="rounded-control border border-line bg-surface/70 p-3">
          <legend className="px-1 text-[12px] font-medium text-ink-3">关联企业能力（用于后续校准）</legend>
          <div className="grid gap-x-3 gap-y-1 sm:grid-cols-3">{availableCapabilities.map((capability) => <label key={capability.id} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-ink-2"><input type="checkbox" className="mt-1 accent-accent" checked={capabilities.includes(capability.id)} onChange={(event) => setCapabilities((current) => event.target.checked ? [...new Set([...current, capability.id])] : current.filter((id) => id !== capability.id))} /><span>{capability.name}</span></label>)}</div>
        </fieldset>
        <div className="review-history-content">
          {row.human_note && <p className="break-words text-[12px] text-ink-3">标注备注：{row.human_note}</p>}
          {row.human_history?.length > 0 && <ul className="space-y-1 text-[12px] text-ink-3">{row.human_history.map((item, index) => <li key={`${item.createdAt}-${index}`}>{bj(item.createdAt, true)} · {LABELS[item.label] ?? item.label}{item.note ? ` · ${item.note}` : ""}</li>)}</ul>}
          {!row.human_note && !row.human_history?.length && <span className="text-[12px] text-ink-4">暂无人工标注历史</span>}
        </div>
      </div>
      <section className="review-actions-sticky">
        <div className="review-actions-row"><div className="flex items-center gap-2"><h3>人工判读</h3>{row.human_label && <Badge tone="ok">{LABELS[row.human_label] ?? row.human_label}{row.human_reviewed_at ? ` · ${bj(row.human_reviewed_at, true)}` : ""}</Badge>}</div><div>
          <Button size="sm" tone="primary" busy={pending === `review-${row.article_id}-relevant`} onClick={() => void mark("relevant")}>相关</Button>
          <Button size="sm" busy={pending === `review-${row.article_id}-irrelevant`} onClick={() => void mark("irrelevant")}>不相关</Button>
          {row.manual_selected ? <Button size="sm" disabled>已推荐</Button> : row.published_selected ? <Button size="sm" disabled>已在精选</Button> : <Button size="sm" tone="primary" busy={pending === `review-${row.article_id}-feature`} onClick={() => void feature()}>推荐</Button>}
        </div></div>
      </section>
    </>
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
    <AdminPage wide className="review-page" title="AI 判读复核" subtitle="核对 AI 与人工标签，为后续校准和关键词治理积累样本。">
      <div className="review-compact-summary"><strong>当前队列 {d.total.toLocaleString()} 篇</strong><span>当前第 {d.page} 篇</span><span>正向词 {d.rules.positive.length} · 负向词 {d.rules.negative.length}</span></div>

      <section className="review-bulk-bar">
        <div className="review-bulk-title"><b>低分批量标记</b><Badge tone="info">总分低于 {d.bulkPreview.threshold}</Badge><span>业务分 0、无关键词命中、AI 非 PASS 的未标注文档可批量标为不相关。</span></div>
        <div className="review-bulk-toolbar">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.bulkPreview.total ? "warn" : "ok"}>近 {d.bulkPreview.days} 天 {d.bulkPreview.total} 篇</Badge>
            {d.bulkPreview.selectedBatchSlot && <Badge tone="info">当前批次 {d.bulkPreview.selectedBatchTotal ?? 0}</Badge>}
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="q" value={d.q} /><input type="hidden" name="filter" value={d.filter} /><input type="hidden" name="humanStatus" value={d.humanStatus} /><input type="hidden" name="days" value={d.days} /><input type="hidden" name="runSlot" value={d.runSlot} /><input type="hidden" name="page" value="1" />
              <label className="flex items-center gap-2 text-[12.5px] text-ink-3">范围<Select name="bulkDays" defaultValue={String(d.bulkPreview.days)} className="!w-auto"><option value="1">近 1 天</option><option value="7">近 7 天</option><option value="30">近 30 天</option></Select></label>
              <Button type="submit" size="sm">刷新</Button>
            </form>
            <Button tone="primary" disabled={!d.bulkPreview.total} busy={pending === `review-low-score-bulk-${d.bulkPreview.days}`} onClick={() => {
              const message = `将把近 ${d.bulkPreview.days} 天内全部采集批次符合条件的 ${d.bulkPreview.total} 篇文章标记为人工不相关。AI 原判会保留。确认继续吗？`;
              if (!window.confirm(message)) return;
              void run("POST", "/api/admin/review/bulk-mark-irrelevant", { days: d.bulkPreview.days, expectedCount: d.bulkPreview.total }, {
                label: `review-low-score-bulk-${d.bulkPreview.days}`, success: `已批量标记 ${d.bulkPreview.total} 篇文章为人工不相关`,
              });
            }}>批量标记不相关</Button>
          </div>
        </div>
      </section>

      <div className="review-rules-compact mb-3"><span>判读规则：关键词负责召回，AI 按采购任务判断相关性；UNKNOWN 和重点样本进入复核。精选线 {d.rules.featuredThreshold}，复核起始 {d.rules.reviewFloor}。</span><span><Link to="/admin/scoring">规则配置 →</Link> · <Link to="/admin/business">业务关键词 →</Link></span></div>

      <Card title="单篇文章复核" right={<div className="review-page-nav"><span>{d.total.toLocaleString()} 篇 · 第 {d.page} 篇</span><Link aria-disabled={d.page <= 1} className={d.page <= 1 ? "is-disabled" : ""} to={link(Math.max(1, d.page - 1))}>← 上一篇</Link><Link aria-disabled={d.page >= pageCount} className={d.page >= pageCount ? "is-disabled" : ""} to={link(Math.min(pageCount, d.page + 1))}>下一篇 →</Link></div>} pad={false}>
        <Form method="get" className="review-filter-form grid gap-3 border-b border-line p-4 sm:grid-cols-2 2xl:grid-cols-[minmax(200px,1.1fr)_minmax(220px,1.25fr)_minmax(240px,1.35fr)_minmax(130px,0.65fr)_minmax(140px,0.7fr)_auto] 2xl:items-end xl:px-5 xl:py-4">
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">搜索文章</span><Input name="q" defaultValue={d.q} placeholder="标题、正文关键词" /></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">新规则分类</span><Select name="filter" defaultValue={d.filter}><option value="calibration-all">全部新规则样本</option><option value="priority">重点复核（高分、低分关键词命中、UNKNOWN）</option><option value="high-keyword">高业务分 + 关键词命中</option><option value="high-no-keyword">高业务分 + 无关键词命中</option><option value="low-keyword">低业务分 + 关键词命中</option><option value="low-no-keyword">低业务分 + 无关键词命中（排除 UNKNOWN，每日抽查 5 篇）</option></Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">采集批次（日期 / 时段）</span><Select name="runSlot" defaultValue={d.runSlot}><option value="">不限定批次</option>{d.collectionBatches.map((batch) => <option key={batch.slot} value={batch.slot}>{batch.slot.replace("T", " ")}:00 · 新增 {batch.newCount} / 抓取 {batch.foundCount} · {batch.sourceCount} 个信源{batch.failedCount ? ` · 失败 ${batch.failedCount}` : ""}</option>)}</Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">采集范围</span><Select name="days" defaultValue={String(d.days)}><option value="1">近 1 天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option><option value="0">全部历史</option></Select></label>
          <label className="block"><span className="mb-1 block text-[12.5px] text-ink-3">人工标记状态</span><Select name="humanStatus" defaultValue={d.humanStatus}><option value="unmarked">未标记</option><option value="marked">已标记</option><option value="all">全部</option></Select></label>
          <input type="hidden" name="page" value="1" />
          <Button type="submit" tone="primary">筛选队列</Button>
        </Form>
        {d.selectedCollectionBatch && <div className="review-selected-batch">批次 {d.selectedCollectionBatch.slot.replace("T", " ")}:00 · 新入库 {d.selectedCollectionBatch.newCount.toLocaleString()} · PASS {d.selectedCollectionBatch.passCount} / UNKNOWN {d.selectedCollectionBatch.unknownCount} · 应复核 {d.selectedCollectionBatch.manualReviewRequired ?? 0} = 已标 {d.selectedCollectionBatch.manualMarked ?? 0} + 待标 {d.selectedCollectionBatch.manualPending ?? 0}</div>}
        {!d.rows.length ? <Empty>当前条件下没有文章。可切换“全部新规则样本”查看本批分类范围。</Empty> : (
          <div className="review-single-document p-3 xl:p-4">
            {d.rows.map((row) => {
              const status = aiStatus(row);
              const positiveTerms = uniqueHits(row.positiveHits);
              const negativeTerms = uniqueHits(row.negativeHits);
              const summary = row.summary_zh?.trim() || row.excerpt?.trim() || "当前文章没有可展示的摘要。";
              const summaryLabel = row.summary_zh?.trim() ? "AI 摘要" : row.excerpt?.trim() ? "网页摘要" : "摘要内容";
              const category = row.category || "未识别";
              const facts = row.procurementFacts;
              const scoreToneValue = scoreTone(row.score, row.analysis_output?.threshold ?? null);
              const businessScore = row.analysis_output?.businessScore?.total ?? row.analysis_output?.businessMatch?.businessScore?.total ?? row.analysis_output?.scoreBreakdown?.business ?? -1;
              const noKeywordHit = positiveTerms.length === 0 && negativeTerms.length === 0;
              const highScoreWithoutKeyword = noKeywordHit && businessScore >= d.rules.reviewHighFloor;
              const deadlineStatus = row.analysis_output?.deadlineStatus;
              const deadlineLabel = deadlineStatus === "passed" ? "已截止 / 已开标" : deadlineStatus === "due_soon" ? `临近开标 · ${row.analysis_output?.dueSoonDays ?? d.rules.dueSoonDays} 天内` : deadlineStatus === "open" ? "有效期内" : "时限未确认";
              const recommended = Boolean(row.manual_selected || row.published_selected || row.selected);
              return <article key={row.article_id} className="review-document-card">
                <header className="review-document-header">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/admin/content/${row.article_id}`} className="break-words text-[16px] font-semibold leading-6 text-ink hover:text-accent">{row.title}</Link>
                      <span className={`review-decision-tag review-decision-${row.human_label ?? "pending"}`}>{row.human_label ? LABELS[row.human_label] ?? row.human_label : "待人工判读"}</span>
                      <span className={`review-recommend-tag${recommended ? " is-recommended" : ""}`}>{recommended ? "已推荐" : "未推荐"}</span>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-3">{row.source_name} · {row.source_tier || "未分级"} · 采集 {bj(row.discovered_at, true)} · 正文 {row.body_status}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2"><Badge tone={status.tone}>{status.text}</Badge><Badge tone="info">业务 {businessScore >= 0 ? businessScore : "—"}</Badge><Badge tone={scoreToneValue}>{row.score === null ? "未评分" : `总分 ${row.score}`}</Badge></div>
                </header>
                <div className="review-document-content">
                  <div className="review-document-layout">
                    <div className="review-document-main">
                      <section className="review-project-facts">
                        <h3>项目基本信息</h3>
                        <div className="review-project-facts-grid">
                          <KeyFact label="公告类别" value={row.analysis_output?.itemType ? ITEM_TYPE_LABELS[row.analysis_output.itemType] ?? row.analysis_output.itemType : null} />
                          <KeyFact label="所属行业" value={category} />
                          <KeyFact label="采购人" value={facts.buyer} />
                          <KeyFact label="预算 / 最高限价" value={facts.budget} />
                          <KeyFact label="项目地点" value={facts.location} />
                          <KeyFact label="投标截止 / 开标时间" value={facts.deadline} />
                          <KeyFact label="采购方式" value={facts.method} />
                          <KeyFact label="发布时间" value={row.published_at ? bj(row.published_at, true) : null} />
                          <KeyFact label="AI 截止状态" value={deadlineLabel} />
                          <KeyFact label="AI 项目名称" value={row.title_zh && row.title_zh !== row.title ? row.title_zh : null} />
                        </div>
                      </section>
                      <ScoreEvidence row={row} />
                      <section className="review-keyword-hits">
                        <div className="flex flex-wrap items-center gap-2"><h3>关键词命中</h3><Badge tone="ok">正向 {positiveTerms.length} 个</Badge><Badge tone={negativeTerms.length ? "bad" : "muted"}>负向 {negativeTerms.length} 个</Badge></div>
                        <div className="review-term-tags">{positiveTerms.map((hit) => <Badge key={hit} tone="ok">+ {hit}</Badge>)}{negativeTerms.map((hit) => <Badge key={`negative-${hit}`} tone="bad">− {hit}</Badge>)}{!positiveTerms.length && !negativeTerms.length && <span>未命中现行词表，AI 仍可能通过语义识别</span>}</div>
                      </section>
                      <AiKeywordCandidates candidates={row.ai_keyword_candidates ?? []} />
                      {highScoreWithoutKeyword && <AiKeywordExtraction row={row} businessScore={businessScore} threshold={d.rules.reviewHighFloor} />}
                      {row.prefilter_402_failed && <p className="review-402-note">相关性预筛曾收到 HTTP 402；当前展示的是已保存的后续判读结果。</p>}
                      <ReviewActions row={row} capabilities={d.rules.capabilities} run={run} pending={pending} />
                    </div>
                    <div className="review-document-side">
                      <section className="review-document-summary review-ai-summary">
                        <b>{summaryLabel}{summaryLabel === "AI 摘要" ? " · 招标内容概览（采购什么）" : ""}</b><p>{summary}</p>
                      </section>
                      {row.body_preview && <section className="review-document-summary review-source-preview"><b>采集到的网页正文片段</b><p>{row.body_preview}</p></section>}
                      <AiEvidence row={row} />
                      <QualificationRequirements row={row} />
                    </div>
                  </div>
                </div>
              </article>;
            })}
          </div>
        )}
      </Card>
    </AdminPage>
  );
}
