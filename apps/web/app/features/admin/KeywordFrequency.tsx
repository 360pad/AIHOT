import { useState } from "react";
import { Form, Link } from "react-router";
import { num } from "./format";
import { Badge, Button, Card, Empty, Input, Select, Stat } from "./ui";

type Row = Record<string, any>;

const ROLES: Record<string, string> = { serviceAction: "服务动作", method: "方法技术", deliverable: "交付成果", negative: "负向词" };

export function KeywordFrequency({ frequency, q, kind }: { frequency: Row; q: string; kind: string }) {
  const summary = frequency.summary ?? {};
  const terms = frequency.terms ?? [];
  const [search, setSearch] = useState(q);
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-accent/15 bg-accent-soft/15 px-4 py-3"><div><b className="text-[13px] text-ink">正式关键词命中统计</b><p className="mt-1 text-[10.5px] text-ink-3">当前正式词库版本 {frequency.profileVersionId ?? "—"} · 每篇文章对同一词条只计一次</p></div><div className="flex gap-2"><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to="/admin/keyword-corrections">正式词纠错</Link><Link className="rounded-control border border-line bg-surface px-3 py-2 text-[10.5px] text-ink-2" to="/admin/business">返回业务关键词</Link></div></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="统计文章" value={num(summary.articleCount ?? 0)} hint="标题、摘要和正文" /><Stat label="人工相关文章" value={num(summary.reviewedRelevantCount ?? 0)} tone="ok" /><Stat label="人工不相关文章" value={num(summary.reviewedIrrelevantCount ?? 0)} tone="bad" /><Stat label="已精选文章" value={num(summary.selectedCount ?? 0)} /></div>
    <Card title="正式词条命中频次" right={<Badge tone="info">{terms.length} 个词条</Badge>} pad={false}>
      <Form method="get" className="flex flex-wrap gap-2 border-b border-line p-3"><input type="hidden" name="view" value="frequency" /><Input name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索正式词或业务能力" /><Select name="kind" defaultValue={kind}><option value="all">全部极性</option><option value="positive">正向词</option><option value="negative">反向词</option></Select><Button type="submit">筛选</Button></Form>
      <div className="border-b border-line bg-surface-2/40 px-4 py-2 text-[10px] leading-5 text-ink-4">按正式词逐项统计文章命中数，并拆分人工相关、人工不相关和已精选命中。高频词可作为业务关注信号；冲突情况可进入“正式词纠错”复核词条范围。</div>
      {!terms.length ? <Empty>没有符合条件的正式词条。</Empty> : <div className="max-h-[720px] overflow-auto"><table className="w-full min-w-[880px] text-left text-[11px]"><thead className="sticky top-0 bg-surface-2 text-[10px] text-ink-3"><tr><th className="px-3 py-3">正式词条</th><th className="px-3 py-3">极性 / 角色</th><th className="px-3 py-3">业务能力</th><th className="px-3 py-3 text-right">全部命中</th><th className="px-3 py-3 text-right">人工相关</th><th className="px-3 py-3 text-right">人工不相关</th><th className="px-3 py-3 text-right">已精选</th><th className="px-3 py-3">样本</th></tr></thead><tbody>{terms.map((item: Row, index: number) => <tr key={item.kind + item.normalizedTerm} className={"border-t border-line " + (index % 2 ? "bg-surface" : "bg-surface-2/15")}><td className="px-3 py-3 font-semibold text-ink">{item.term}</td><td className="px-3 py-3"><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正向" : "反向"} · {(item.roles ?? [item.role]).map((role: string) => ROLES[role] ?? role).join("、")}</Badge></td><td className="px-3 py-3 text-ink-3">{item.capabilityName}</td><td className="px-3 py-3 text-right font-semibold">{num(item.hitArticleCount)}</td><td className="px-3 py-3 text-right text-ok">{num(item.relevantHitCount)}</td><td className="px-3 py-3 text-right text-hot">{num(item.irrelevantHitCount)}</td><td className="px-3 py-3 text-right text-accent">{num(item.selectedHitCount)}</td><td className="px-3 py-3"><Link className="text-accent hover:underline" to={"/admin/keywords?step=samples&q=" + encodeURIComponent(item.term)}>查看</Link></td></tr>)}</tbody></table></div>}
    </Card>
  </>;
}
