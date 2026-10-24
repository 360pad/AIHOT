import { useState } from "react";
import { Link } from "react-router";
import { useAdminAction } from "./action";
import { Badge, Button, Card, Empty, Input, ReasonDialog } from "./ui";

type Row = Record<string, any>;

const LABELS: Record<string, string> = { relevant: "相关", irrelevant: "不相关", unknown: "不确定" };
const ROLES: Record<string, string> = { serviceAction: "服务动作", method: "方法技术", deliverable: "交付成果", negative: "负向词" };

export function OfficialKeywordConflicts({ terms }: { terms: Row[] }) {
  const { run, pending } = useAdminAction();
  const [target, setTarget] = useState<Row | null>(null);
  const [action, setAction] = useState<"keep" | "deactivate" | "replace">("deactivate");
  const [replacementTerm, setReplacementTerm] = useState("");
  const propose = async (reason: string) => {
    if (!target || (action === "replace" && (!replacementTerm.trim() || replacementTerm.trim() === target.term))) return false;
    return !!(await run("POST", "/api/admin/keywords/official-changes", {
      kind: target.kind,
      term: target.term,
      capabilityId: target.capabilityId,
      role: target.role,
      action,
      ...(action === "replace" ? { replacementTerm: replacementTerm.trim() } : {}),
      reason,
    }, {
      label: "keyword-official-change-" + target.capabilityId + "-" + target.normalizedTerm,
      success: action === "keep" ? "已记录正式词保留结论" : "正式词调整已进入草稿候选",
    }));
  };

  return <>
    <Card title="正式词命中争议" right={<div className="flex items-center gap-2"><Badge tone="bad">{terms.length} 个词条</Badge><Link className="text-[10.5px] text-accent hover:underline" to="/admin/business?view=frequency">查看正式词命中统计 →</Link></div>}>
      <p className="mb-3 text-[10.5px] leading-5 text-ink-3">以下正式词曾命中人工判为不相关的文章。按词汇聚查看命中次数和原文证据，再决定保留、修改或停用；单篇冲突不会自动停用词条。修改或停用建议进入草稿，经历史样本回放和发布后才影响正式词库。</p>
      {!terms.length ? <Empty>目前没有待处理的正式词命中争议。新的人工判读样本汇聚后，会按正式词条在这里显示。</Empty> : <div className="max-h-[760px] divide-y divide-line overflow-auto">{terms.map((item: Row) => <article key={item.kind + item.capabilityId + item.normalizedTerm} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-[190px] flex-1"><div className="flex flex-wrap items-center gap-2"><b className="text-[12px] text-ink">{item.term}</b><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正式正向词" : "正式反向词"}</Badge><span className="text-[10px] text-ink-4">{item.capabilityName} · {ROLES[item.role] ?? item.role}</span></div><div className="mt-1 text-[10px] text-ink-3">已判读命中 {item.hitArticleCount} 篇 · 人工相关 {item.relevantHitCount} · 人工不相关 {item.irrelevantHitCount} · 冲突 {item.conflictCount}</div><div className="mt-1 flex flex-col gap-1">{(item.examples ?? []).map((example: Row) => <div key={example.articleId} className="flex flex-wrap items-center gap-x-2"><Link className="max-w-[420px] truncate text-[10px] text-accent hover:underline" to={"/admin/keywords?step=samples&feedbackId=" + example.feedbackId}>{example.title}</Link><span className="text-[9.5px] text-ink-4">AI {example.aiRelevance?.toUpperCase() ?? "—"} · 业务分 {example.aiScore ?? "—"} · 人工{LABELS[example.label] ?? "未标记"}</span></div>)}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setTarget(item); setAction("keep"); setReplacementTerm(""); }}>确认保留</Button><Button size="sm" tone="danger" onClick={() => { setTarget(item); setAction("deactivate"); setReplacementTerm(""); }}>提出停用</Button><Button size="sm" onClick={() => { setTarget(item); setAction("replace"); setReplacementTerm(item.term); }}>修改词条</Button></div></article>)}</div>}
    </Card>
    <ReasonDialog open={!!target} title={action === "keep" ? "确认保留正式词" : action === "deactivate" ? "提出停用正式词" : "修改正式词"} description={target ? action === "keep" ? `确认“${target.term}”仍然有效？本次冲突会记入复核记录；之后出现的新冲突样本仍会再次提示。` : `正式词“${target.term}”已有 ${target.conflictCount} 篇人工冲突样本。此操作只进入草稿候选，不会立即改变运行词库。` : ""} confirmLabel={action === "keep" ? "记录保留结论" : "加入调整候选"} busy={target ? pending === "keyword-official-change-" + target.capabilityId + "-" + target.normalizedTerm : false} danger={action === "deactivate"} onClose={() => setTarget(null)} onSubmit={propose}>
      {action === "replace" && <label><span className="mb-1 block text-[10.5px] text-ink-3">替换后的正式词</span><Input value={replacementTerm} maxLength={80} onChange={(event) => setReplacementTerm(event.target.value)} />{replacementTerm.trim() === target?.term && <small className="mt-1 block text-hot">请输入与原词不同的内容。</small>}</label>}
    </ReasonDialog>
  </>;
}
