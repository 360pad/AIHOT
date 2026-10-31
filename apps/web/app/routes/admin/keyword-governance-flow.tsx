import { SITE } from "@aihot/industry/site";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Form, Link } from "react-router";
import type { Route } from "./+types/keyword-governance-flow";
import { AdminPage } from "../../features/admin/ui";
import { adminGet } from "../../lib/admin.server";

export const meta: Route.MetaFunction = () => [{ title: `关键词治理流程 · ${SITE.name} 后台` }];

type FlowBatch = {
  slot: string;
  sourceCount: number;
  foundCount: number;
  newCount: number;
  failedCount: number;
  runningCount: number;
  collection: Record<string, any>;
  outcomes: Record<string, any>;
  flow: Record<string, number>;
  drilldown?: Drilldown | null;
  historyNote: string;
};

type FlowData = {
  slots: Array<{ slot: string; sourceCount: number; foundCount: number; newCount: number }>;
  selectedSlot: string | null;
  latestLabeledSlot: string | null;
  autoSelectedLabeledBatch: boolean;
  batch: FlowBatch | null;
  recentBulkReview: { createdAt: string; days: number; markedCount: number; databaseCount: number; labels: { relevant: number; irrelevant: number }; batches: Array<{ slot: string; count: number }> } | null;
};

type DrillMetric = "samples" | "relevant" | "irrelevant" | "formalHit" | "conflict" | "consistent" | "noFormalHit" | "formalAndCandidate" | "formalOnly" | "candidateOnly" | "neither" | "candidateSamples" | "noCandidateSamples" | "negativeCandidateSamples" | "irrelevantWithoutCandidate" | "lowScoreIrrelevant";
type Drilldown = { metric: DrillMetric; page: number; pageSize: number; total: number; rows: Array<{ articleId: string; title: string; openingTime: string | null; amount: string | null }> };

const DRILL_TITLES: Record<DrillMetric, string> = {
  samples: "已标注样本",
  relevant: "人工判定相关",
  irrelevant: "人工判定不相关",
  formalHit: "正式词命中文档",
  conflict: "正式词冲突文档",
  consistent: "正式词一致文档",
  noFormalHit: "未命中正式词文档",
  formalAndCandidate: "正式词与 AI 候选均命中文档",
  formalOnly: "仅命中正式词文档",
  candidateOnly: "仅有 AI 候选词文档",
  neither: "没有关键词变化的样本",
  candidateSamples: "AI 候选词来源文档",
  noCandidateSamples: "未形成 AI 候选词文档",
  negativeCandidateSamples: "负向候选来源文档",
  irrelevantWithoutCandidate: "未形成负向候选的不相关文档",
  lowScoreIrrelevant: "低分批量标记不相关文档",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  const slot = url.searchParams.get("slot");
  const drill = url.searchParams.get("drill");
  const page = url.searchParams.get("page");
  if (slot) params.set("slot", slot);
  if (drill) params.set("drill", drill);
  if (page) params.set("page", page);
  const data = await adminGet<FlowData>(request, `/api/admin/keywords/flow?${params}`);
  return data;
}

const fmt = (value: number | null | undefined) => new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));

function BatchMetric({ label, value, tone = "blue", note }: { label: string; value: number; tone?: string; note?: string }) {
  return <div className={`kg-batch-metric kg-batch-metric-${tone}`}><span>{label}</span><strong>{fmt(value)}</strong>{note && <small>{note}</small>}</div>;
}

function AnimatedCount({ value }: { value: number; paused?: boolean }) {
  return <span>{fmt(value)}</span>;
}

const FlowDrillContext = createContext<{ href: (metric: DrillMetric) => string } | null>(null);

function FlowCount({ value, unit, paused = false, drill }: { value: number; unit: string; paused?: boolean; drill?: DrillMetric }) {
  const context = useContext(FlowDrillContext);
  const content = <><b><AnimatedCount value={value} paused={paused} /></b>{unit}</>;
  return drill && context
    ? <Link className="kg-flow-count kg-flow-count-link" to={context.href(drill)} aria-label={`查看${fmt(value)}${unit}对应文章`}>{content}</Link>
    : <span className="kg-flow-count">{content}</span>;
}

function PipelineStage({ title, value, detail, tone = "blue" }: { title: string; value: string; detail: string; tone?: string }) {
  return <div className={`kg-batch-stage kg-batch-stage-${tone}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function BatchFlowPanel({ data }: { data: FlowData }) {
  const batch = data.batch;
  if (!batch) return <section className="kg-batch-panel"><h2>采集批次数据</h2><p>近 45 天没有可展示的采集批次。</p></section>;
  const { outcomes: o, collection: c } = batch;
  const physicallyRemoved = Number(o.physicallyRemoved ?? Number(o.block ?? 0) + Number(o.expired ?? 0) + Number(o.awardResultDiscarded ?? 0));
  const marked = Number(o.manualMarked ?? 0);
  const markedOutsideReview = Number(o.manualMarkedOutsideReview ?? 0);
  const markedOutsideRelevant = Number(o.manualMarkedOutsideRelevant ?? 0);
  const markedOutsideIrrelevant = Number(o.manualMarkedOutsideIrrelevant ?? 0);
  const reviewRequired = Number(o.manualReviewRequired ?? 0);
  const upstreamUninserted = Math.max(0, batch.foundCount - batch.newCount);
  const trackedFilter = Number(c.rejectedUrlPolicy ?? 0) + Number(c.rejectedNoise ?? 0) + Number(c.rejectedAge ?? 0) + Number(c.rejectedRunLimit ?? 0);

  return <section className="kg-batch-panel" aria-labelledby="kg-batch-title">
    <header className="kg-batch-heading">
      <div><h2 id="kg-batch-title">采集批次数据</h2><p>{batch.historyNote}</p></div>
      <Form method="get" className="kg-batch-select">
        <label htmlFor="kg-batch-slot">日期 / 班次</label>
        <select id="kg-batch-slot" name="slot" value={data.selectedSlot ?? ""} onChange={(event) => event.currentTarget.form?.requestSubmit()}>
          {data.slots.map((slot) => <option key={slot.slot} value={slot.slot}>{slot.slot.replace("T", " ")}:00 · {fmt(slot.newCount)} 条入库</option>)}
        </select>
      </Form>
    </header>

    <div className="kg-batch-meta"><span>{batch.sourceCount} 个信源</span><span>列表发现 {fmt(batch.foundCount)} 条</span><span>新入库 {fmt(batch.newCount)} 条</span><span>采集失败 {fmt(batch.failedCount)} 个</span></div>

    <div className="kg-batch-metrics">
      <BatchMetric label="新入库文章" value={batch.newCount} note="本批次首次入库" />
      <BatchMetric label="AI 精选文章（去重）" value={o.aiSelected} tone="green" note="按当前规则筛选，同篇文章只计一次" />
      <BatchMetric label="PASS" value={o.pass} note="AI 判为业务相关" />
      <BatchMetric label="UNKNOWN" value={o.unknown} tone="amber" note="保留待判读" />
      <BatchMetric label="BLOCK" value={o.block} tone="red" note="AI 判定不相关" />
      <BatchMetric label="入库后物理剔除" value={physicallyRemoved} tone="red" note={`BLOCK ${fmt(o.block)} · 过期 ${fmt(o.expired)} · 结果公告 ${fmt(o.awardResultDiscarded)}`} />
      <BatchMetric label="应人工标定" value={reviewRequired} tone="violet" note={`队列内已标 ${fmt(marked)} · 待标 ${fmt(o.manualPending)} · 队列外另有标签 ${fmt(markedOutsideReview)}（相关 ${fmt(markedOutsideRelevant)} · 不相关 ${fmt(markedOutsideIrrelevant)}）`} />
    </div>
    {data.recentBulkReview && <div className="kg-batch-bulk-summary">
      <div className="kg-batch-bulk-summary-heading"><b>最近一次低分批量标注</b><span>近 {data.recentBulkReview.days} 天 · {new Date(data.recentBulkReview.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span></div>
      <strong>已标 {fmt(data.recentBulkReview.markedCount)} 篇</strong>
      <span>相关 {fmt(data.recentBulkReview.labels.relevant)} · 不相关 {fmt(data.recentBulkReview.labels.irrelevant)}</span>
      <p>{data.recentBulkReview.batches.map(({ slot, count }) => `${slot.replace("T", " ")}:00 ${fmt(count)} 篇`).join(" · ") || "未关联采集批次"}。这是跨批次操作总量；当前所选班次流程图统计 {fmt(marked)} 篇。{data.recentBulkReview.databaseCount !== data.recentBulkReview.markedCount ? `审计记录与文章标注差异 ${fmt(data.recentBulkReview.markedCount - data.recentBulkReview.databaseCount)} 篇。` : ""}</p>
    </div>}
    <p className="kg-batch-footnote">首页“招标 / 标前 / 中标”栏目按互斥分类展示，同一篇文章只出现在一个栏目；栏目合计与 AI 精选去重总数一致。</p>

    <div className="kg-batch-flow" aria-label="本批次数据流向">
      <PipelineStage title="信源列表" value={`${fmt(batch.foundCount)} 条`} detail="采集器发现的候选项" />
      <span className="kg-batch-flow-arrow" aria-hidden="true">→</span>
      <PipelineStage title="采集前过滤 / 去重" value={c.available ? `${fmt(trackedFilter)} 条过滤` : `${fmt(upstreamUninserted)} 条未新入库`} detail={c.available ? `URL ${fmt(c.rejectedUrlPolicy)} · 噪声 ${fmt(c.rejectedNoise)} · 时效 ${fmt(c.rejectedAge)} · 单次限额 ${fmt(c.rejectedRunLimit)} · 已存/重复 ${fmt(Number(c.alreadyStored ?? 0) + Number(c.repeatedInRun ?? 0))}` : "未新入库也包括已存在、重复和限额项，不能直接算作丢弃"} tone="amber" />
      <span className="kg-batch-flow-arrow" aria-hidden="true">→</span>
      <PipelineStage title="新增入库" value={`${fmt(batch.newCount)} 篇`} detail="进入文章处理队列" />
      <span className="kg-batch-flow-arrow" aria-hidden="true">→</span>
      <PipelineStage title="判读结果" value={`PASS ${fmt(o.pass)} · UNKNOWN ${fmt(o.unknown)}`} detail={`BLOCK ${fmt(o.block)} · 过期 ${fmt(o.expired)} · 结果公告剔除 ${fmt(o.awardResultDiscarded)} · 规则保留 ${fmt(o.reference)} · 处理中 ${fmt(o.queued)} · 失败 ${fmt(o.failed)}`} tone="blue" />
      <span className="kg-batch-flow-arrow" aria-hidden="true">→</span>
      <PipelineStage title="人工标定" value={`${fmt(marked)} / ${fmt(reviewRequired)} 已标`} detail={`队列内相关 ${fmt(o.humanRelevant)} · 不相关 ${fmt(o.humanIrrelevant)} · 待标 ${fmt(o.manualPending)} · 队列外标签 ${fmt(markedOutsideReview)}（相关 ${fmt(markedOutsideRelevant)} · 不相关 ${fmt(markedOutsideIrrelevant)}）`} tone="violet" />
    </div>

    {!c.available && <p className="kg-batch-footnote">本批次采集前过滤原因没有留存明细；“列表发现 − 新入库”只是未形成新文章的数量，不代表被删除或人工判为不相关。</p>}
  </section>;
}

function JudgementFlowPanel({ data, paused }: { data: FlowData; paused: boolean }) {
  const batch = data.batch;
  if (!batch) return null;
  const o = batch.outcomes;
  const pass = Number(o.pass ?? 0);
  const aiSelected = Number(o.aiSelected ?? 0);
  const selected = Number(o.selected ?? 0);
  const passManualReview = Number(o.passManualReviewRequired ?? 0);
  const unknown = Number(o.unknown ?? 0);
  const block = Number(o.block ?? 0);
  const expired = Number(o.expired ?? 0);
  const awardResultDiscarded = Number(o.awardResultDiscarded ?? 0);
  const reference = Number(o.reference ?? 0);
  const skipped = Number(o.skipped ?? 0);
  const reviewRequired = Number(o.manualReviewRequired ?? 0);
  const reviewMarked = Number(o.manualMarked ?? 0);
  const reviewMarkedOutside = Number(o.manualMarkedOutsideReview ?? 0);
  const reviewOutsideRelevant = Number(o.manualMarkedOutsideRelevant ?? 0);
  const reviewOutsideIrrelevant = Number(o.manualMarkedOutsideIrrelevant ?? 0);
  const reviewPending = Number(o.manualPending ?? Math.max(0, reviewRequired - reviewMarked));
  const reviewKnown = unknown + passManualReview;
  const reviewOther = reviewRequired - reviewKnown;
  const decisionTotal = pass + unknown + block + expired + awardResultDiscarded + reference + skipped + Number(o.queued ?? 0) + Number(o.failed ?? 0);
  const decisionDelta = decisionTotal - batch.newCount;
  const selectedDelta = aiSelected - selected;
  const physicallyRemoved = block + expired + awardResultDiscarded;

  return <section className="kg-batch-panel kg-judgement-panel" aria-labelledby="kg-judgement-title">
    <header className="kg-batch-heading">
      <div>
        <h2 id="kg-judgement-title">入库后判读与精选分流</h2>
        <p>按上方所选日期 / 班次显示。AI 判为 UNKNOWN 的 {fmt(unknown)} 篇与符合复核条件的 PASS {fmt(passManualReview)} 篇构成应人工标定 {fmt(reviewRequired)} 篇。</p>
      </div>
      <span className="kg-judgement-scope">当前批次</span>
    </header>

    <div className="kg-judgement-flow" aria-label="新入库文章经 AI 判读后分流至精选、人工队列或剔除">
      <div className="kg-judgement-input">
        <span>新入库文章</span>
        <strong><AnimatedCount value={batch.newCount} paused={paused} /></strong>
        <small>进入判读流程</small>
      </div>
      <span className="kg-judgement-arrow" aria-hidden="true">→</span>

      <section className="kg-judgement-results" aria-label="AI 判读和规则结果">
        <div className="kg-judgement-results-heading">
          <b>AI 判读与规则处理</b>
          <span>分项合计 <AnimatedCount value={decisionTotal} paused={paused} /> 条</span>
        </div>
        <div className="kg-judgement-cards">
          <article className="kg-judgement-card kg-judgement-card-pass">
            <div className="kg-judgement-card-heading"><b>PASS</b><FlowCount value={pass} unit="篇" paused={paused} /></div>
            <small>AI 判为业务相关</small>
            <div className="kg-judgement-pass-counts">
              <span>AI 精选 <strong><AnimatedCount value={aiSelected} paused={paused} /></strong></span>
              <span>PASS 待人工 <strong><AnimatedCount value={passManualReview} paused={paused} /></strong></span>
            </div>
            {selectedDelta !== 0 && <small className="kg-judgement-inline-warning">AI 精选与当前精选相差 {fmt(Math.abs(selectedDelta))} 篇，分开显示待核对。</small>}
          </article>

          <article className="kg-judgement-card kg-judgement-card-amber">
            <div className="kg-judgement-card-heading"><b>UNKNOWN</b><FlowCount value={unknown} unit="篇" paused={paused} /></div>
            <small>材料不足或需要进一步判读</small>
          </article>
          <article className="kg-judgement-card kg-judgement-card-red">
            <div className="kg-judgement-card-heading"><b>BLOCK</b><FlowCount value={block} unit="篇" paused={paused} /></div>
            <small>AI 判定不相关并剔除</small>
          </article>
          <article className="kg-judgement-card kg-judgement-card-red">
            <div className="kg-judgement-card-heading"><b>过期</b><FlowCount value={expired} unit="篇" paused={paused} /></div>
            <small>超过有效时限后剔除</small>
          </article>
          <article className="kg-judgement-card kg-judgement-card-red">
            <div className="kg-judgement-card-heading"><b>结果公告剔除</b><FlowCount value={awardResultDiscarded} unit="篇" paused={paused} /></div>
            <small>命中结果类规则后剔除</small>
          </article>
          <article className="kg-judgement-card kg-judgement-card-muted">
            <div className="kg-judgement-card-heading"><b>规则保留</b><FlowCount value={reference} unit="篇" paused={paused} /></div>
            <small>保留进入后续流程</small>
          </article>
          {skipped > 0 && <article className="kg-judgement-card kg-judgement-card-muted">
            <div className="kg-judgement-card-heading"><b>跳过判读</b><FlowCount value={skipped} unit="篇" paused={paused} /></div>
            <small>未进入 AI 业务判读（如非编辑信源）</small>
          </article>}
        </div>
        <div className="kg-judgement-results-foot">
          <span>入库后物理剔除 <b><AnimatedCount value={physicallyRemoved} paused={paused} /></b> 篇</span>
          <span>处理中 <b><AnimatedCount value={Number(o.queued ?? 0)} paused={paused} /></b> · 失败 <b><AnimatedCount value={Number(o.failed ?? 0)} paused={paused} /></b></span>
        </div>
      </section>

      <span className="kg-judgement-arrow" aria-hidden="true">→</span>
      <div className="kg-judgement-manual">
        <span>应人工标定</span>
        <strong><AnimatedCount value={reviewRequired} paused={paused} /></strong>
        <div className="kg-judgement-manual-breakdown">
          <span>AI UNKNOWN <b><AnimatedCount value={unknown} paused={paused} /></b></span>
            <span>PASS 待人工 <b><AnimatedCount value={passManualReview} paused={paused} /></b></span>
          {reviewOther !== 0 && <span>其他 / 差额 <b><AnimatedCount value={reviewOther} paused={paused} /></b></span>}
        </div>
        <small>队列内已标 <AnimatedCount value={reviewMarked} paused={paused} /> · 待标 <AnimatedCount value={reviewPending} paused={paused} />{reviewMarkedOutside > 0 && <> · 队列外另有标签 <AnimatedCount value={reviewMarkedOutside} paused={paused} />（相关 <AnimatedCount value={reviewOutsideRelevant} paused={paused} /> · 不相关 <AnimatedCount value={reviewOutsideIrrelevant} paused={paused} />）</>}</small>
        {reviewOther === 0
          ? <small className="kg-judgement-manual-equation"><AnimatedCount value={reviewMarked} paused={paused} /> 已标 + <AnimatedCount value={reviewPending} paused={paused} /> 待标 = <AnimatedCount value={reviewRequired} paused={paused} /></small>
          : <small className="kg-judgement-inline-warning">待人工总数与已展示分支尚未完全对上。</small>}
      </div>
    </div>

    {decisionDelta !== 0 && <p className="kg-judgement-reconciliation">判读分项合计 {fmt(decisionTotal)} 条，与新入库 {fmt(batch.newCount)} 条相差 {decisionDelta > 0 ? "多 " : "少 "}{fmt(Math.abs(decisionDelta))} 条{Boolean(o.legacy) ? "（旧任务历史统计）" : ""}，暂待核对。</p>}
    <p className="kg-judgement-handoff">下方关键词治理流程接收 {fmt(Number(batch.flow.traceableSamples ?? 0))} 篇已有人工标签的样本：应标队列内 {fmt(reviewMarked)} 篇 + 队列外另有标签 {fmt(reviewMarkedOutside)} 篇；队列外样本保留进入汇聚，不计入应标队列</p>
  </section>;
}

function FlowNode({ kind, children }: { kind: string; children: ReactNode }) {
  return <div className={`kg-node kg-node-${kind}`}>{children}</div>;
}

function Arrow({ label }: { label?: string }) {
  return <div className="kg-arrow" aria-hidden="true">{label && <span>{label}</span>}</div>;
}

function ChoiceFork({ count }: { count: 2 | 3 }) {
  return <div className={`kg-choice-fork kg-choice-fork-${count}`} aria-hidden="true"><i /><i /><i /><i /><i /></div>;
}

function Outcome({ kind, title, children }: { kind: "positive" | "negative" | "neutral"; title: string; children?: ReactNode }) {
  return <div className={`kg-outcome kg-outcome-${kind}`}><b>{title}</b>{children && <span>{children}</span>}</div>;
}

function QueueLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="kg-queue-link" to={to}>{children}<span aria-hidden="true"> →</span></Link>;
}

function FlowDrilldownDialog({ slot, data }: { slot: string; data: Drilldown }) {
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const href = (page: number) => `?${new URLSearchParams({ slot, drill: data.metric, page: String(page) })}`;
  return <div className="kg-drill-backdrop" role="presentation">
    <section className="kg-drill-dialog" role="dialog" aria-modal="true" aria-labelledby="kg-drill-title">
      <header><h2 id="kg-drill-title">{DRILL_TITLES[data.metric]}</h2><Link to={`?slot=${encodeURIComponent(slot)}`} aria-label="关闭文档列表">×</Link></header>
      <div className="kg-drill-table-wrap">
        <table>
          <thead><tr><th>序号</th><th>标题</th><th>开标时间</th><th>金额</th></tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={row.articleId}>
            <td>{(data.page - 1) * data.pageSize + index + 1}</td>
            <td><Link className="text-accent hover:underline" to={`/admin/review?articleId=${encodeURIComponent(row.articleId)}`}>{row.title}</Link></td>
            <td>{row.openingTime ?? "未识别"}</td>
            <td>{row.amount ?? "未识别"}</td>
          </tr>)}</tbody>
        </table>
        {!data.rows.length && <p className="kg-drill-empty">暂无文档</p>}
      </div>
      {pageCount > 1 && <footer><span>第 {data.page} / {pageCount} 页</span><nav>
        <Link aria-disabled={data.page <= 1} to={href(Math.max(1, data.page - 1))}>上一页</Link>
        <Link aria-disabled={data.page >= pageCount} to={href(Math.min(pageCount, data.page + 1))}>下一页</Link>
      </nav></footer>}
    </section>
  </div>;
}

export default function KeywordGovernanceFlow({ loaderData }: Route.ComponentProps) {
  const [paused, setPaused] = useState(false);
  const batch = loaderData.batch;
  const outcomes = batch?.outcomes ?? {};
  const flow = batch?.flow ?? {};
  const marked = Number(flow.traceableSamples ?? 0);
  const drilldown = batch?.drilldown ?? null;
  const queueMarked = Number(outcomes.manualMarked ?? 0);
  const queueOutsideMarked = Number(outcomes.manualMarkedOutsideReview ?? 0);
  const positiveCandidates = Number(flow.positiveCandidateCount ?? 0);
  const negativeCandidates = Number(flow.negativeCandidateCount ?? 0);
  const humanRelevant = Number(flow.labeledRelevant ?? 0);
  const humanIrrelevant = Number(flow.labeledIrrelevant ?? 0);
  const lowScoreIrrelevant = Math.min(humanIrrelevant, Number(flow.lowScoreIrrelevantSamples ?? 0));
  const negativeCandidateSamples = Math.min(humanIrrelevant, Number(flow.negativeCandidateSamples ?? 0));
  const irrelevantWithoutCandidate = Math.max(0, humanIrrelevant - negativeCandidateSamples);
  const allCandidates = positiveCandidates + negativeCandidates;
  const candidateSamples = Number(flow.candidateSamples ?? 0);
  const noCandidateSamples = Math.max(0, marked - candidateSamples);
  const formalAndCandidateSamples = Number(flow.formalAndCandidateSamples ?? 0);
  const formalOnlySamples = Number(flow.formalOnlySamples ?? 0);
  const candidateOnlySamples = Number(flow.candidateOnlySamples ?? 0);
  const neitherSamples = Number(flow.neitherSamples ?? 0);

  return <AdminPage wide className="kg-governance-page" title="关键词治理流程">
    <BatchFlowPanel data={loaderData} />
    <JudgementFlowPanel data={loaderData} paused={paused} />
    <div className="kg-flow-toolbar">
      <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "播放流动线" : "暂停流动线"}</button>
    </div>
    {loaderData.autoSelectedLabeledBatch && loaderData.latestLabeledSlot && loaderData.batch && <div className="kg-flow-notice" role="status">
      最新采集班次 {loaderData.slots[0]?.slot.replace("T", " ")}:00 尚无人工标签，当前默认展示最近已标注班次 {loaderData.batch.slot.replace("T", " ")}:00。可用上方日期 / 班次切换查看最新采集数据。
    </div>}
    {batch && marked === 0 && <div className="kg-flow-empty" role="status">
      <b>当前班次还没有人工标注，关键词治理流程暂无可统计样本</b>
      <span>本页只汇总当前班次中已有人工标签的文章；本批新入库 {fmt(batch.newCount)} 篇，尚未标注时，正式词命中和 AI 候选词都会显示为 0。</span>
      {loaderData.latestLabeledSlot && loaderData.latestLabeledSlot !== batch.slot && <Link to={`?slot=${encodeURIComponent(loaderData.latestLabeledSlot)}`}>查看最近已标注班次 {loaderData.latestLabeledSlot.replace("T", " ")}:00 →</Link>}
    </div>}

    <FlowDrillContext.Provider value={batch ? { href: (metric) => `?slot=${encodeURIComponent(batch.slot)}&drill=${metric}` } : null}>
    <div className={`kg-flow-map${paused ? " is-paused" : ""}`} role="group" aria-label="人工标注样本经正式词纠错和新词筛选，审定后进入配置草稿、历史回放与正式发布">
      <FlowNode kind="start">
        <b className="kg-start-title">人工标注进度</b>
        <div className="kg-start-metrics">
          <div><span>应复核</span><strong><AnimatedCount value={Number(outcomes.manualReviewRequired ?? 0)} paused={paused} /> 篇</strong><small>已标 {fmt(queueMarked)} + 待标 {fmt(Number(outcomes.manualPending ?? 0))}</small></div>
          <div><span>治理样本</span><strong><AnimatedCount value={marked} paused={paused} /> 篇</strong><small>队列内 {fmt(queueMarked)} + 队列外 {fmt(queueOutsideMarked)}</small></div>
        </div>
      </FlowNode>
      <Arrow />
      <FlowNode kind="aggregate">
        <b>样本汇聚 <FlowCount value={Number(flow.traceableSamples ?? 0)} unit="篇可核验" paused={paused} drill="samples" /></b>
        <div className="kg-flow-label-counts">
          <FlowCount value={humanRelevant} unit="篇相关" paused={paused} drill="relevant" />
          <FlowCount value={humanIrrelevant} unit="篇不相关" paused={paused} drill="irrelevant" />
        </div>
        <small>已标 {fmt(queueMarked)} + 队列外 {fmt(queueOutsideMarked)} = {fmt(marked)} 篇治理样本</small>
        <div className="kg-evidence-list"><span>人工标签</span><span>AI 结论与分数</span><span>正式词命中</span><span>AI 提取词与原文证据</span></div>
        <div className="kg-sample-closure">
          <b>样本标签合计 <small>按文章计</small></b>
          <div className="kg-label-equation">
            <FlowCount value={humanRelevant} unit="相关" paused={paused} drill="relevant" /><span>+</span>
            <FlowCount value={humanIrrelevant} unit="不相关" paused={paused} drill="irrelevant" /><span>+</span>
            <span>=</span>
            <FlowCount value={marked} unit="样本" paused={paused} drill="samples" />
          </div>
          <b>关键词去向 <small>按文章计 · 四类互斥</small></b>
          <div>
            <span>正式词 + AI 候选 <FlowCount value={formalAndCandidateSamples} unit="篇" paused={paused} drill="formalAndCandidate" /></span>
            <span>仅正式词 <FlowCount value={formalOnlySamples} unit="篇" paused={paused} drill="formalOnly" /></span>
            <span>仅 AI 候选 <FlowCount value={candidateOnlySamples} unit="篇" paused={paused} drill="candidateOnly" /></span>
            <span>两者都无 <FlowCount value={neitherSamples} unit="篇" paused={paused} drill="neither" /></span>
          </div>
          <small>四项相加 = {fmt(formalAndCandidateSamples + formalOnlySamples + candidateOnlySamples + neitherSamples)} 篇</small>
          <div className="kg-no-change-summary">
            <b>无词库变更 <FlowCount value={neitherSamples} unit="篇" paused={paused} drill="neither" /></b>
            <span>正式词未命中且 AI 未形成候选；样本留存，不进入关键词草稿。</span>
          </div>
        </div>
      </FlowNode>
      <div className="kg-fork" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="kg-branches">
        <section className="kg-branch kg-existing-branch" aria-labelledby="kg-existing-title">
          <h2 id="kg-existing-title">正式词命中 <FlowCount value={Number(flow.formalHitSamples ?? 0)} unit="篇" paused={paused} drill="formalHit" /></h2>
          <FlowNode kind="decision">正式词极性与人工标签是否冲突？<small>冲突 <FlowCount value={Number(flow.conflictSamples ?? 0)} unit="篇" paused={paused} drill="conflict" /> · 一致 <FlowCount value={Number(flow.consistentSamples ?? 0)} unit="篇" paused={paused} drill="consistent" /> · 未命中 <FlowCount value={Number(flow.noFormalHitSamples ?? 0)} unit="篇" paused={paused} drill="noFormalHit" /></small></FlowNode>
          <ChoiceFork count={2} />
          <div className="kg-existing-outcomes">
            <div className="kg-path-card kg-path-conflict">
              <span className="kg-path-label kg-label-alert">冲突 <FlowCount value={Number(flow.conflictSamples ?? 0)} unit="篇" paused={paused} drill="conflict" /></span>
              <Arrow />
              <FlowNode kind="queue">正式词纠错队列<small>本批冲突样本 <FlowCount value={Number(flow.conflictSamples ?? 0)} unit="篇" paused={paused} drill="conflict" /></small><small>按词汇聚冲突样本、命中频次及证据</small></FlowNode>
              <Arrow />
              <QueueLink to="/admin/keyword-corrections">正式词纠错审定</QueueLink>
            </div>
            <div className="kg-path-card kg-path-support">
              <span className="kg-path-label kg-label-ok">一致 <FlowCount value={Number(flow.consistentSamples ?? 0)} unit="篇" paused={paused} drill="consistent" /></span>
              <Arrow />
              <Outcome kind="positive" title="累计该词支持证据与命中频次"><FlowCount value={Number(flow.consistentSamples ?? 0)} unit="篇" paused={paused} drill="consistent" /></Outcome>
            </div>
          </div>
        </section>

        <section className="kg-branch kg-ai-branch" aria-labelledby="kg-ai-title">
          <h2 id="kg-ai-title">AI 候选词条 <FlowCount value={allCandidates} unit="个去重词条" paused={paused} /></h2>
          <FlowNode kind="process">核验 AI 提取词<small>去重词条 {fmt(allCandidates)} 个（正向 {fmt(positiveCandidates)} · 负向 {fmt(negativeCandidates)}）</small><small>来源文章 <FlowCount value={candidateSamples} unit="篇" paused={paused} drill="candidateSamples" /> · 无候选文章 <FlowCount value={noCandidateSamples} unit="篇" paused={paused} drill="noCandidateSamples" /></small></FlowNode>
          <Arrow />
          <FlowNode kind="decision">出现未被正式词覆盖的新表达？</FlowNode>
          <ChoiceFork count={3} />
          <div className="kg-ai-outcomes">
            <div className="kg-path-card">
              <span className="kg-path-label kg-label-ok">有，且人工判为相关</span>
              <Arrow />
              <Outcome kind="positive" title="正向新词候选"><small>本批 <AnimatedCount value={positiveCandidates} paused={paused} /> 个词条 · 按词合并统计</small></Outcome>
            </div>
            <div className="kg-path-card">
              <span className="kg-path-label kg-label-muted">未形成可核验 AI 候选 <FlowCount value={noCandidateSamples} unit="篇" paused={paused} drill="noCandidateSamples" /></span>
              <Arrow />
              <Outcome kind="neutral" title="保留样本并说明未形成候选的原因" />
            </div>
            <div className="kg-path-card kg-path-irrelevant">
              <div className="kg-ai-rail-tail-mask" aria-hidden="true" />
              <span className="kg-path-label kg-label-alert">人工不相关 <FlowCount value={humanIrrelevant} unit="篇" paused={paused} drill="irrelevant" /></span>
              <Arrow />
              <FlowNode kind="decision-small">AI 高分且有可解释的误报词？</FlowNode>
              <ChoiceFork count={2} />
              <div className="kg-negative-outcomes">
                <div><span className="kg-path-label kg-label-alert">已形成负向候选 · <FlowCount value={negativeCandidateSamples} unit="篇" paused={paused} drill="negativeCandidateSamples" /> / {fmt(negativeCandidates)} 个词条</span><Outcome kind="negative" title="负向候选线索"><small>按词累计，达到复核条件后入队</small></Outcome></div>
                <div><span className="kg-path-label kg-label-muted">未形成负向候选 · <FlowCount value={irrelevantWithoutCandidate} unit="篇" paused={paused} drill="irrelevantWithoutCandidate" /></span><Outcome kind="neutral" title="保留样本，不产生词库变更"><small>低分批量标记 <FlowCount value={lowScoreIrrelevant} unit="篇" paused={paused} drill="lowScoreIrrelevant" />：总分低于 25</small></Outcome></div>
              </div>
            </div>
          </div>
          <div className="kg-candidate-merge">
            <div className="kg-candidate-sources">
              <div className="kg-candidate-source kg-source-positive">正向新词候选 <AnimatedCount value={positiveCandidates} paused={paused} /> 个</div>
              <div className="kg-candidate-source kg-source-negative">负向候选线索 <AnimatedCount value={negativeCandidates} paused={paused} /> 个</div>
            </div>
            <svg className="kg-candidate-wires" viewBox="0 0 1000 48" preserveAspectRatio="none" aria-hidden="true">
              <path d="M 250 0 V 14 C 250 23 500 23 500 32" />
              <path d="M 750 0 V 14 C 750 23 500 23 500 32" />
              <path d="M 500 32 V 42" />
              <path className="kg-candidate-arrowhead" d="M 494 38 L 500 48 L 506 38 Z" />
            </svg>
            <QueueLink to="/admin/keywords?step=clusters">新关键词候选审定</QueueLink>
          </div>
        </section>
      </div>

      <svg className="kg-downstream-merge" viewBox="0 0 1000 56" preserveAspectRatio="none" aria-hidden="true">
        <path className="kg-merge-input" d="M 117 0 V 14 C 117 25 310 28 500 28" />
        <path className="kg-merge-input" d="M 733 0 V 14 C 733 25 650 28 500 28" />
        <path className="kg-merge-output kg-merge-output-desktop" d="M 500 28 V 49" />
        <path className="kg-merge-output kg-merge-output-mobile" d="M 500 0 V 49" />
        <path className="kg-merge-arrowhead" d="M 494 43 L 500 49 L 506 43" />
      </svg>
      <FlowNode kind="draft">配置草稿与历史样本回放</FlowNode>
      <Arrow />
      <FlowNode kind="publish">发布正式关键词 JSON</FlowNode>
    </div>
    </FlowDrillContext.Provider>
    {batch && drilldown && <FlowDrilldownDialog slot={batch.slot} data={drilldown} />}
  </AdminPage>;
}
