import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Route } from "./+types/keyword-corrections";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { OfficialKeywordConflicts } from "../../features/admin/OfficialKeywordConflicts";
import { AdminPage, Badge, Button, Card, Empty, Json, ReasonDialog, Stat } from "../../features/admin/ui";

type Row = Record<string, any>;

export async function loader({ request }: Route.LoaderArgs) {
  const view = new URL(request.url).searchParams.get("view") ?? "conflicts";
  const [conflicts, proposals, publishedChanges, profile] = await Promise.all([
    adminGet<{ terms: Row[] }>(request, "/api/admin/keywords/official-conflicts"),
    adminGet<{ changes: Row[] }>(request, "/api/admin/keywords/official-changes?status=candidate"),
    adminGet<{ changes: Row[] }>(request, "/api/admin/keywords/official-changes?status=published"),
    adminGet<Row>(request, "/api/admin/keywords/draft"),
  ]);
  const stagedTerms = view === "draft"
    ? (await adminGet<{ terms: Row[] }>(request, "/api/admin/keywords/terms?status=staged")).terms.filter((term) => term.profileVersionId === profile.draft?.versionId)
    : [];
  return { terms: conflicts.terms, proposals: proposals.changes, publishedChanges: publishedChanges.changes, profile, stagedTerms, view };
}

export const meta: Route.MetaFunction = () => [{ title: `正式词纠错 · ${SITE.name} 后台` }];

export default function OfficialKeywordCorrections({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number[]>([]);
  const [ack, setAck] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const profile = d.profile;
  const meta = profile.governanceDraft;
  const correctionIds = meta?.official_change_ids ?? [];
  const newTermIds = meta?.term_ids ?? [];
  const unrelatedDraft = !meta && profile.draft?.versionId && profile.draft.versionId !== profile.current?.versionId;
  const activeNewTermDraft = meta && newTermIds.length > 0 && correctionIds.length === 0 && meta.status !== "published";
  const activeCorrectionDraft = meta && correctionIds.length > 0 && meta.status !== "published";
  const createCorrectionDraft = async () => {
    const result = await run("POST", "/api/admin/keywords/draft", {
      name: "正式词纠错草稿",
      termIds: [],
      officialChangeIds: selected,
      contextId: null,
      expectedRevision: profile.draft?.revision ?? 0,
    }, { label: "official-keyword-correction-draft", success: "正式词纠错草稿已创建，正式词库尚未改变" });
    if (result) navigate("/admin/keyword-corrections?view=draft");
  };

  if (d.view === "draft") return <AdminPage wide title="正式词纠错" subtitle="独立复核正式词调整，通过历史样本回放后再发布。">
    {!correctionIds.length ? <Card title="当前没有正式词纠错草稿"><p className="text-[11px] leading-5 text-ink-3">先从正式词纠错列表中提出停用或修改建议，再选择候选词条生成纠错草稿。</p><Link className="mt-3 inline-flex h-9 items-center rounded-control bg-accent px-4 text-[11px] text-accent-contrast" to="/admin/keyword-corrections">返回正式词纠错 →</Link></Card>
    : <CorrectionDraft profile={profile} meta={meta} stagedTerms={d.stagedTerms} ack={ack} setAck={setAck} publishOpen={publishOpen} setPublishOpen={setPublishOpen} run={run} pending={pending} onPublished={() => navigate("/admin/keyword-corrections")} />}
  </AdminPage>;

  return <AdminPage wide title="正式词纠错" subtitle="按正式词汇总人工判读冲突，确认保留、提出修改或停用；正式库只在回放验证并发布后变更。">
    {(activeCorrectionDraft || activeNewTermDraft) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-amber/25 bg-amber/5 px-4 py-3"><div><b className="text-[12px] text-ink">当前有一份待完成的关键词草稿</b><p className="mt-1 text-[10px] text-ink-3">{activeCorrectionDraft ? "正式词纠错草稿尚未发布。先完成回放和发布，再开始下一份变更。" : "新关键词筛选草稿尚未发布，正式词纠错暂不能另起草稿。"}</p></div><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to={activeCorrectionDraft ? "/admin/keyword-corrections?view=draft" : "/admin/keywords?step=draft"}>{activeCorrectionDraft ? "继续正式词纠错" : "继续新关键词筛选"} →</Link></div>}
    {unrelatedDraft && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-amber/25 bg-amber/5 px-4 py-3"><div><b className="text-[12px] text-ink">已有业务关键词配置草稿，将继续保留</b><p className="mt-1 text-[10px] text-ink-3">本次纠错从当前生效版本生成；发布后，停用项也会同步到这份待发布草稿，避免以后发布时恢复旧词。</p></div><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to="/admin/business">查看业务关键词草稿 →</Link></div>}
    <OfficialKeywordConflicts terms={d.terms} />
    <Card className="mt-4" title="待发布的正式词调整" right={<Badge tone={d.proposals.length ? "warn" : "muted"}>{d.proposals.length} 项候选</Badge>} pad={false}>
      <p className="border-b border-line bg-surface-2/40 px-4 py-2 text-[10px] leading-5 text-ink-4">候选以正式词为单位汇总，不与新词候选混列。每项保留原词、调整动作和人工依据；本页不会直接改变运行词库。</p>
      {!d.proposals.length ? <Empty>暂无待发布调整。可在上方正式词冲突中提出停用或修改建议。</Empty> : <div className="divide-y divide-line">{d.proposals.map((item: Row) => <label key={item.id} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-bg-sunk/35"><input className="mt-1 accent-accent" type="checkbox" checked={selected.includes(Number(item.id))} onChange={(event) => setSelected((value) => event.target.checked ? [...new Set([...value, Number(item.id)])] : value.filter((id) => id !== Number(item.id)))} /><span className="min-w-0 flex-1"><b className="text-[12px] text-ink">{item.term}</b><span className="ml-2"><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正式正向词" : "正式反向词"}</Badge></span><small className="ml-2 text-[10px] text-ink-4">{item.capabilityId} · {item.role}</small><small className="mt-1 block text-[10px] text-ink-3">调整：{item.action === "deactivate" ? "停用" : "替换为“" + item.replacementTerm + "”"}</small><small className="mt-1 block text-[10px] text-ink-4">判读依据：{item.reviewNote}</small></span><Badge tone="warn">待回放</Badge></label>)}</div>}
      <div className="flex items-center justify-between border-t border-line px-4 py-3"><span className="text-[10.5px] text-ink-3">已选 {selected.length} 项 · 单篇冲突不会自动停用正式词</span><Button tone="primary" busy={pending === "official-keyword-correction-draft"} disabled={!selected.length || !!activeCorrectionDraft || !!activeNewTermDraft} onClick={() => void createCorrectionDraft()}>生成正式词纠错草稿 →</Button></div>
    </Card>
    <Card className="mt-4" title="最近已发布纠错" right={<Badge tone={d.publishedChanges.length ? "ok" : "muted"}>{d.publishedChanges.length} 条记录</Badge>} pad={false}>
      <p className="border-b border-line bg-surface-2/40 px-4 py-2 text-[10px] leading-5 text-ink-4">已发布词条保留在版本记录中，不再出现在待处理队列；这里显示变更动作和关联版本，便于追溯。</p>
      {!d.publishedChanges.length ? <Empty>暂无已发布的正式词纠错记录。</Empty> : <div className="divide-y divide-line">{d.publishedChanges.map((item: Row) => <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"><b className="text-[12px] text-ink">{item.term}</b><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正式正向词" : "正式反向词"}</Badge><span className="text-[10.5px] text-ink-3">{item.action === "deactivate" ? "已停用" : "已替换为“" + item.replacementTerm + "”"} · {item.capabilityId} · {item.role}</span><span className="ml-auto text-[10px] text-ink-4">版本 {item.profileVersionId} · {bj(item.updatedAt, true)}</span></div>)}</div>}
    </Card>
  </AdminPage>;
}

function CorrectionDraft({ profile, meta, stagedTerms, ack, setAck, publishOpen, setPublishOpen, run, pending, onPublished }: { profile: Row; meta: Row; stagedTerms: Row[]; ack: boolean; setAck: (value: boolean) => void; publishOpen: boolean; setPublishOpen: (value: boolean) => void; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null; onPublished: () => void }) {
  const changes: Row[] = profile.officialChanges ?? [];
  const replay = meta.replay_result;
  const versionId = profile.draft?.versionId;
  const published = meta.status === "published";
  const replayNow = () => run("POST", "/api/admin/keywords/draft/replay", {}, { label: "keyword-governance-replay", success: "历史人工判读样本回放完成" });
  const publish = async (reason: string) => {
    const result = await run("POST", "/api/admin/keywords/draft/publish", { expectedRevision: profile.draft?.revision ?? 0, reason }, { label: "keyword-governance-publish", success: "正式词纠错已发布并生效" });
    if (result) onPublished();
    return !!result;
  };
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3"><div><div className="flex items-center gap-2"><b className="text-[14px] text-ink">{meta.name}</b><Badge tone={published ? "ok" : "warn"}>{published ? "已发布" : "待回放 / 发布"}</Badge></div><p className="mt-1 text-[10.5px] text-ink-3">配置版本 {versionId} · {changes.length} 项正式词调整{stagedTerms.length ? " · 含 " + stagedTerms.length + " 个存量新词簇" : " · 不包含新词"}</p></div><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to="/admin/keyword-corrections">返回纠错列表</Link></div>
    {meta.preserved_profile_draft_pointer && <div className="mb-4 rounded-panel border border-amber/25 bg-amber/5 px-4 py-3 text-[10.5px] leading-5 text-ink-3">业务关键词配置草稿 {meta.preserved_profile_draft_pointer.versionId} 会保留为待发布版本；确认发布后，系统会把停用项同步到该草稿。</div>}
    {stagedTerms.length > 0 && <Card className="mb-4" title="存量合并草稿中的新词簇"><p className="mb-2 text-[10px] leading-5 text-ink-4">这是历史上同时包含正式词调整和新词的草稿。为避免丢弃已暂存内容，以下词簇会随本次草稿一起回放与发布；后续两类草稿已分开。</p><div className="flex flex-wrap gap-2">{stagedTerms.map((item: Row) => <Badge key={item.id} tone={item.kind === "positive" ? "ok" : "bad"}>{item.term}</Badge>)}</div><Link className="mt-3 inline-flex text-[10.5px] text-accent" to="/admin/keywords?step=draft">打开新关键词筛选 →</Link></Card>}
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="调整词条" value={changes.length} /><Stat label="历史样本" value={num(replay?.sampleCount ?? 0)} /><Stat label="命中变化样本" value={num(replay?.changedCount ?? 0)} /><Stat label="相关样本负向冲突" value={num(replay?.relatedNegativeConflictAfter ?? 0)} tone={replay?.relatedNegativeConflictAfter ? "bad" : "ok"} /></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.2fr)]"><Card title="正式词调整明细" right={<Badge tone="info">回放后发布</Badge>}><div className="divide-y divide-line">{changes.map((item: Row) => <div key={item.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-center gap-2"><b className="text-[12px]">{item.term}</b><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正式正向词" : "正式反向词"}</Badge></div><p className="mt-1 text-[10.5px] text-ink-3">{item.action === "deactivate" ? "提出停用" : "修改为：" + item.replacementTerm}</p><p className="mt-1 text-[10px] text-ink-4">依据：{item.reviewNote}</p></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><Button tone="primary" disabled={published} busy={pending === "keyword-governance-replay"} onClick={() => void replayNow()}>{replay ? "重新运行历史样本回放" : "运行历史样本回放"}</Button><Link to="/admin/keyword-trends" className="inline-flex h-9 items-center rounded-control px-3 text-[10.5px] text-accent ring-1 ring-line">查看关键词趋势</Link></div><div className="mt-4"><Json value={profile.jsonPreview} label="调整后的业务配置 JSON 预览" /></div></Card>
      <Card title="回放验证" right={<span className="text-[10px] text-ink-4">只模拟词表命中，不重跑 AI，不修改历史标签</span>}>{!replay ? <div className="rounded-panel border border-dashed border-line-strong p-9 text-center"><b className="text-[13px]">尚未完成回放</b><p className="mx-auto mt-2 max-w-lg text-[11px] leading-5 text-ink-3">比较当前正式词库与调整后词库在已标注样本上的命中变化。</p><Button className="mt-4" tone="primary" busy={pending === "keyword-governance-replay"} onClick={() => void replayNow()}>开始回放</Button></div> : <>
        <div className="mb-3 rounded-control bg-accent-soft/20 px-3 py-2 text-[10.5px] text-ink-3">样本 {num(replay.sampleCount)} 篇：相关 {num(replay.relatedCount)} · 不相关 {num(replay.unrelatedCount)} · 命中变化 {num(replay.changedCount)}</div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"><div className="rounded-panel border p-3"><small>相关样本正向命中</small><b className="mt-1 block text-[14px]">{rate(replay.relatedPositiveHitBefore)} → {rate(replay.relatedPositiveHitAfter)}</b></div><div className="rounded-panel border p-3"><small>不相关样本负向命中</small><b className="mt-1 block text-[14px]">{rate(replay.unrelatedNegativeHitBefore)} → {rate(replay.unrelatedNegativeHitAfter)}</b></div><div className="rounded-panel border p-3"><small>回放完成</small><b className="mt-1 block text-[11px]">{bj(meta.replayed_at, true)}</b></div></div>
        <div className="mt-3 max-h-[330px] overflow-auto rounded-control border"><table className="w-full min-w-[550px] text-left text-[10.5px]"><thead className="bg-surface-2"><tr><th className="px-3 py-2">变化文章</th><th className="px-3 py-2">人工标签</th><th className="px-3 py-2">现行词库</th><th className="px-3 py-2">纠错草稿</th></tr></thead><tbody>{(replay.examples ?? []).map((item: Row) => <tr key={item.articleId} className="border-t border-line"><td className="max-w-[240px] px-3 py-2"><Link className="line-clamp-2 text-accent" to={"/admin/content/" + item.articleId}>{item.title}</Link></td><td className="px-3 py-2">{item.label === "relevant" ? "相关" : "不相关"}</td><td className="px-3 py-2 text-ink-3">正 {item.before.positive.join("、") || "—"}<br />负 {item.before.negative.join("、") || "—"}</td><td className="px-3 py-2">正 {item.after.positive.join("、") || "—"}<br />负 {item.after.negative.join("、") || "—"}</td></tr>)}</tbody></table></div>
        {!published && <><label className="mt-4 flex items-start gap-2 rounded-control bg-ok/5 p-3 text-[11px]"><input className="mt-1 accent-accent" type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /><span>我已核对回放指标和变化样例，确认后发布；历史标签不会被修改。</span></label><div className="mt-3 flex justify-end"><Button tone="primary" disabled={!ack || !meta.replayed_at} onClick={() => setPublishOpen(true)}>确认发布正式词纠错</Button></div></>}
      </>}</Card>
    </div>
    <ReasonDialog open={publishOpen} title="发布正式词纠错" description="发布后，新采集和新分析会使用该词库版本；历史文章及人工标签不变。" confirmLabel="确认发布" busy={pending === "keyword-governance-publish"} onClose={() => setPublishOpen(false)} onSubmit={publish}><p className="rounded-control bg-amber/10 p-3 text-[11px] text-amber">发布原因会写入审计记录。</p></ReasonDialog>
  </>;
}

function rate(value: number | null | undefined) { return typeof value === "number" ? Math.round(value * 100) + "%" : "暂无"; }
