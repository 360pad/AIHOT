import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/scoring";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Input, ReasonDialog } from "../../features/admin/ui";

type DimensionKey = "taskFit" | "delivery" | "importance";
type SelectionPolicy = {
  weights: { fit: number; region: number; deadline: number };
  dimensions: Record<DimensionKey, { max: number; guide: string }>;
  featuredThreshold: number;
  reviewFloor: number;
  reviewHighFloor: number;
  dueSoonDays: number;
  updatedAt: string | null;
};
type RegionalRule = { enabled: boolean; updatedAt: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  const [selectionPolicy, maanshanRule] = await Promise.all([
    adminGet<SelectionPolicy>(request, "/api/admin/business-selection-policy"),
    adminGet<RegionalRule>(request, "/api/admin/maanshan-rule"),
  ]);
  return { selectionPolicy, maanshanRule };
}

export const meta: Route.MetaFunction = () => [{ title: `精选规则配置 · ${SITE.name} 后台` }];

const DIMENSIONS: Array<{ key: DimensionKey; label: string; help: string }> = [
  { key: "taskFit", label: "采购任务与企业能力匹配", help: "判断公告中实际采购的任务是否与公司能做的业务直接或部分相符。关键词可辅助理解，同义表达由 AI 结合语境判断。" },
  { key: "delivery", label: "交付内容吻合", help: "判断公告写明的服务动作、采购范围和交付成果与公司实际交付能力的吻合程度。" },
  { key: "importance", label: "相关任务在项目中的重要性", help: "相关内容是主要采购任务、独立标包还是背景提及、附带义务。背景和顺带要求不应拿高分。" },
];

const copyPolicy = (policy: SelectionPolicy): SelectionPolicy => ({
  ...policy,
  weights: { ...policy.weights },
  dimensions: Object.fromEntries(Object.entries(policy.dimensions).map(([key, value]) => [key, { ...value }])) as SelectionPolicy["dimensions"],
});

function rebalanceDimensions(dimensions: SelectionPolicy["dimensions"], target: number): SelectionPolicy["dimensions"] {
  const keys: DimensionKey[] = ["taskFit", "delivery", "importance"];
  const total = keys.reduce((sum, key) => sum + dimensions[key].max, 0);
  const portions = keys.map((key) => {
    const share = total > 0 ? dimensions[key].max / total : key === "taskFit" ? 0.5 : key === "delivery" ? 1 / 3 : 1 / 6;
    const raw = share * target;
    return { key, floor: Math.floor(raw), remainder: raw - Math.floor(raw) };
  });
  let remaining = target - portions.reduce((sum, item) => sum + item.floor, 0);
  portions.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) portions[i % portions.length]!.floor++;
  return Object.fromEntries(portions.map(({ key, floor }) => [key, { ...dimensions[key], max: floor }])) as SelectionPolicy["dimensions"];
}

export default function ScoringAdmin({ loaderData }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const [policy, setPolicy] = useState(() => copyPolicy(loaderData.selectionPolicy));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [ruleDialog, setRuleDialog] = useState(false);
  const total = DIMENSIONS.reduce((sum, item) => sum + policy.dimensions[item.key].max, 0);
  const weightTotal = policy.weights.fit + policy.weights.region + policy.weights.deadline;
  const valid = total === policy.weights.fit && weightTotal === 100 && policy.featuredThreshold >= 1 && policy.featuredThreshold <= 100
    && policy.reviewFloor >= 0 && policy.reviewFloor < policy.featuredThreshold
    && policy.reviewHighFloor >= 0 && policy.reviewHighFloor <= policy.weights.fit
    && policy.dueSoonDays >= 1 && policy.dueSoonDays <= 30;

  function updateDimension(key: DimensionKey, patch: Partial<SelectionPolicy["dimensions"][DimensionKey]>) {
    setPolicy((current) => ({ ...current, dimensions: { ...current.dimensions, [key]: { ...current.dimensions[key], ...patch } } }));
  }

  function updateWeight(key: keyof SelectionPolicy["weights"], value: number) {
    setPolicy((current) => ({
      ...current,
      weights: { ...current.weights, [key]: value },
      ...(key === "fit" ? { reviewHighFloor: current.weights.fit > 0 ? Math.min(value, Math.round(current.reviewHighFloor / current.weights.fit * value)) : Math.min(value, current.reviewHighFloor) } : {}),
      ...(key === "fit" ? { dimensions: rebalanceDimensions(current.dimensions, value) } : {}),
    }));
  }

  async function save() {
    setError("");
    if (!valid) { setError("业务、地域和时效分值必须合计 100；业务分项之和必须等于业务分值，复核线低于精选线，且人工复核高分线不超过业务满分。"); return; }
    if (!reason.trim()) { setError("请填写调整原因，方便追溯规则变更。"); return; }
    const { updatedAt: _updatedAt, ...value } = policy;
    const saved = await run("PUT", "/api/admin/business-selection-policy", { policy: value, reason }, { label: "business-selection-policy", success: "精选规则配置已保存，仅影响后续分析" });
    if (saved) setReason("");
  }

  return (
    <AdminPage wide title="精选规则配置" subtitle="配置 100 分的业务、地域和时效权重；业务判读与评分在同一次 AI 输出中完成。">
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Card title="业务判读与评分" right={<Badge tone="ok">同一次 AI 输出</Badge>}><p className="text-[13px] leading-6 text-ink-3">业务满分 {policy.weights.fit} 分，并拆成任务匹配、交付吻合和任务重要性。关键词用于理解业务，不是必须命中的硬门槛。</p></Card>
        <Card title="精选门槛" right={<Badge tone="info">总分 100</Badge>}><p className="text-[13px] leading-6 text-ink-3">有效、PASS 且综合总分达到门槛才自动进入精选。临近开标不自动精选；UNKNOWN 按综合复核线进入人工复核。</p></Card>
        <Card title="已过截止时间" right={<Badge tone="warn">总分为 0</Badge>}><p className="text-[13px] leading-6 text-ink-3">先判定投标截止或开标状态。已过期项目直接归零并剔除，不继续评分、精选或进入人工复核。</p></Card>
      </div>

      <Card title="综合评分构成" right={<Badge tone={weightTotal === 100 ? "ok" : "bad"}>合计 {weightTotal} / 100 分</Badge>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">业务匹配分值</span><Input aria-label="业务匹配总分值" type="number" min={0} max={100} value={policy.weights.fit} onChange={(event) => updateWeight("fit", Number(event.target.value))} /><span className="mt-1 block text-[11.5px] text-ink-4">调整时会按当前比例重算下面三项业务分值。</span></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">地域匹配分值</span><Input aria-label="地域匹配分值" type="number" min={0} max={100} value={policy.weights.region} onChange={(event) => updateWeight("region", Number(event.target.value))} /><span className="mt-1 block text-[11.5px] text-ink-4">江苏、安徽、江西、河北得满分；其他明确地域低分，未知地域一半分。</span></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">开标时效分值</span><Input aria-label="开标时效分值" type="number" min={0} max={100} value={policy.weights.deadline} onChange={(event) => updateWeight("deadline", Number(event.target.value))} /><span className="mt-1 block text-[11.5px] text-ink-4">有效期充足得满分，临近或未知时限得一半；过期总分直接为 0。</span></label>
        </div>
      </Card>

      <Card className="mt-5" title="业务分项与评分说明" right={<Badge tone={total === policy.weights.fit ? "ok" : "bad"}>分值合计 {total} / {policy.weights.fit}</Badge>}>
        <div className="grid gap-4 xl:grid-cols-3">
          {DIMENSIONS.map(({ key, label, help }) => (
            <section key={key} className="min-w-0 rounded-panel border border-line bg-bg-sunk/35 p-4">
              <div className="flex items-end justify-between gap-3">
                <div className="text-[13.5px] font-semibold text-ink">{label}</div>
                <label className="w-24 shrink-0"><span className="mb-1 block text-[11.5px] text-ink-4">分值上限</span><Input aria-label={`${label}分值上限`} type="number" min={0} max={policy.weights.fit} step={1} value={policy.dimensions[key].max} onChange={(event) => updateDimension(key, { max: Number(event.target.value) })} /></label>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-4">{help}</p>
              <label className="mt-3 block"><span className="mb-1 block text-[11.5px] font-medium text-ink-3">AI 评分依据</span><textarea aria-label={`${label}评分依据`} className="min-h-[104px] w-full resize-y rounded-control border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-5 text-ink outline-none focus:border-accent" maxLength={500} value={policy.dimensions[key].guide} onChange={(event) => updateDimension(key, { guide: event.target.value })} /></label>
            </section>
          ))}
        </div>
        <div className="mt-5 grid gap-4 border-t border-line pt-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">进入精选的最低综合分</span><Input aria-label="进入精选的最低综合分" type="number" min={1} max={100} value={policy.featuredThreshold} onChange={(event) => setPolicy({ ...policy, featuredThreshold: Number(event.target.value) })} /><span className="mt-1 block text-[11.5px] text-ink-4">PASS、未过期且达到此综合分才自动进入精选。</span></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">人工复核综合分起始线</span><Input aria-label="人工复核综合分起始线" type="number" min={0} max={99} value={policy.reviewFloor} onChange={(event) => setPolicy({ ...policy, reviewFloor: Number(event.target.value) })} /><span className="mt-1 block text-[11.5px] text-ink-4">此分至精选门槛之间进入队列；UNKNOWN 始终进入。</span></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">人工复核业务高分线</span><Input aria-label="人工复核业务高分线" type="number" min={0} max={policy.weights.fit} value={policy.reviewHighFloor} onChange={(event) => setPolicy({ ...policy, reviewHighFloor: Number(event.target.value) })} /><span className="mt-1 block text-[11.5px] text-ink-4">只划分复核队列；不改变 AI 判读、精选门槛或综合总分。低于此分归入低分组。</span></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">临近开标天数</span><Input aria-label="临近开标天数" type="number" min={1} max={30} value={policy.dueSoonDays} onChange={(event) => setPolicy({ ...policy, dueSoonDays: Number(event.target.value) })} /><span className="mt-1 block text-[11.5px] text-ink-4">剩余该天数内时效分减半，并转人工复核、不自动精选。</span></label>
        </div>
        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">调整原因</span><Input aria-label="调整精选规则原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：根据人工复核样本调整业务分项" /></label>
          <div className="flex gap-2"><Button onClick={() => { setPolicy(copyPolicy(loaderData.selectionPolicy)); setReason(""); setError(""); }}>取消修改</Button><Button tone="primary" busy={pending === "business-selection-policy"} disabled={pending === "business-selection-policy" || !valid || !reason.trim()} onClick={() => void save()}>保存规则</Button></div>
        </div>
        {error && <p role="alert" className="mt-3 text-[12.5px] text-hot">{error}</p>}
        <p className="mt-3 text-[12px] leading-5 text-ink-4">评分权重与 AI 门槛仅影响新发起的分析，历史评分保留原值；人工复核业务高分线保存后立即调整历史和新样本的队列分组，不触发重新判读。当前配置更新时间：{loaderData.selectionPolicy.updatedAt ? bj(loaderData.selectionPolicy.updatedAt, true) : "使用系统默认值，尚未单独保存"}</p>
      </Card>

      <Card className="mt-5" title="独立 AI 二次评分" right={<Badge tone="muted">P1 · 暂不参与精选</Badge>}>
        <p className="text-[13px] leading-6 text-ink-3">当前 100 分由同一次任务判读给出业务分与地域分，时效分按截止状态计算。不会再发起另一轮 AI 评分来否定本次业务判读。</p>
      </Card>

      <Card className="mt-5" title="马鞍山软件运维精选特例" right={<Badge tone={loaderData.maanshanRule.enabled ? "ok" : "muted"}>{loaderData.maanshanRule.enabled ? "已启用" : "已停用"}</Badge>}>
        <p className="text-[13px] leading-6 text-ink-3">仅在 AI 业务判定为 PASS、明确命中“软件系统运维”且有同一采购任务的已核验证据、公告明确属于马鞍山、没有负向词、开标状态为“未开标”时，额外纳入精选。采购意向、招标计划、标前公示和招标公告适用；中标结果、信息不全或来源排除项不适用。</p>
        <p className="mt-2 text-[12px] leading-5 text-ink-4">此特例不修改 AI 业务分，只在精选纳入时提供例外。关闭时会重新计算并撤下仅由此特例纳入的记录，AI 原本已选中的项目不受影响。</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button tone={loaderData.maanshanRule.enabled ? "danger" : "primary"} onClick={() => setRuleDialog(true)}>{loaderData.maanshanRule.enabled ? "停用特例" : "启用特例"}</Button>
          <span className="text-[12px] text-ink-4">{loaderData.maanshanRule.updatedAt ? `最近调整：${bj(loaderData.maanshanRule.updatedAt, true)}` : "尚未单独调整，默认启用"}</span>
        </div>
        <MaanshanRuleDialog enabled={loaderData.maanshanRule.enabled} open={ruleDialog} onClose={() => setRuleDialog(false)} />
      </Card>

      <div className="mt-5 flex flex-wrap gap-3 text-[13px]">
        <Link className="font-medium text-accent hover:underline" to="/admin/review">打开 AI 人工复核 →</Link>
        <Link className="font-medium text-accent hover:underline" to="/admin/business">编辑业务能力和排除词 →</Link>
      </div>
    </AdminPage>
  );
}

function MaanshanRuleDialog({ enabled, open, onClose }: { enabled: boolean; open: boolean; onClose: () => void }) {
  const { run, pending } = useAdminAction();
  return (
    <ReasonDialog
      open={open}
      title={`${enabled ? "停用" : "启用"}马鞍山软件运维精选特例`}
      description={enabled ? "停用后会重新计算仅由该特例纳入精选的内容。" : "启用后仅新处理或重新发布的符合条件内容适用；不会批量回算历史内容。"}
      danger={enabled}
      confirmLabel={enabled ? "停用特例" : "启用特例"}
      busy={pending === "maanshan-rule"}
      onClose={onClose}
      onSubmit={async (reason) => (await run("PUT", "/api/admin/maanshan-rule", { enabled: !enabled, reason }, { label: "maanshan-rule", success: "马鞍山特例设置已更新" })) !== null}
    />
  );
}
