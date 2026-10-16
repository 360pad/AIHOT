import { SITE } from "@aihot/industry/site";
import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/scoring";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Input } from "../../features/admin/ui";

type Policy = { weights: { fit: number; region: number; deadline: number }; dueSoonDays: number; updatedAt: string | null };

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<Policy>(request, "/api/admin/scoring-policy");
}

export const meta: Route.MetaFunction = () => [{ title: `评分规则 · ${SITE.name} 后台` }];

export default function ScoringAdmin({ loaderData }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const [weights, setWeights] = useState(loaderData.weights);
  const [days, setDays] = useState(loaderData.dueSoonDays);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const total = weights.fit + weights.region + weights.deadline;

  async function save() {
    setError("");
    if (total !== 100) { setError("三项权重相加必须等于 100%。"); return; }
    if (!reason.trim()) { setError("请填写调整原因，方便追溯规则变更。"); return; }
    const saved = await run("PUT", "/api/admin/scoring-policy", { weights, dueSoonDays: days, reason }, { label: "scoring-policy", success: "评分规则已保存，新分析将使用新权重" });
    if (saved) setReason("");
  }

  return (
    <AdminPage wide title="评分规则" subtitle="业务匹配为主，地域作为辅助，开标时效用于降低临近项目优先级。">
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <Card title="业务匹配" right={<Badge tone="ok">主权重</Badge>}><p className="text-[13px] leading-6 text-ink-3">衡量公告写明的采购任务、服务动作、技术方法和交付成果与公司业务的对应程度。</p></Card>
        <Card title="地域匹配" right={<Badge tone="info">辅助权重</Badge>}><p className="text-[13px] leading-6 text-ink-3">地域影响项目优先级，不覆盖明确的业务匹配结果。</p></Card>
        <Card title="开标时效" right={<Badge tone="warn">约束因素</Badge>}><p className="text-[13px] leading-6 text-ink-3">已截止/已开标的项目不进入精选；临近开标的项目降低优先级。</p></Card>
      </div>

      <Card title="权重设置" right={<span>配置总和：{total}%</span>}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.7fr)] xl:items-end">
          <div className="grid gap-4 sm:grid-cols-3">
            {([["fit", "业务匹配"], ["region", "地域匹配"], ["deadline", "开标时效"]] as const).map(([key, label]) => (
              <label key={key} className="block"><span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}权重（%）</span><Input aria-label={`${label}权重`} type="number" min={0} max={100} step={1} value={weights[key]} onChange={(event) => setWeights({ ...weights, [key]: Number(event.target.value) })} /></label>
            ))}
          </div>
          <label className="block"><span className="mb-1 block text-[12.5px] font-medium text-ink-2">临近开标天数（1–30）</span><Input aria-label="临近开标天数" type="number" min={1} max={30} step={1} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <label className="block"><span className="mb-1 block text-[12.5px] font-medium text-ink-2">调整原因</span><Input aria-label="调整评分规则原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：根据人工复核样本调整地域权重" /></label>
          <Button tone="primary" busy={pending === "scoring-policy"} disabled={pending === "scoring-policy" || total !== 100 || days < 1 || days > 30 || !reason.trim()} onClick={() => void save()}>保存评分规则</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-[12.5px] text-hot">{error}</p>}
        <p className="mt-3 text-[12px] leading-6 text-ink-4">默认业务 60%、地域 25%、时效 15%，权重总和必须为 100%。修改会留下审计记录，仅影响新发起的评分，历史判读保留原权重。</p>
        <p className="mt-2 text-[12px] text-ink-4">当前配置更新时间：{loaderData.updatedAt ? bj(loaderData.updatedAt, true) : "使用系统默认值，尚未单独保存"}</p>
      </Card>

      <div className="mt-5 flex flex-wrap gap-3 text-[13px]">
        <Link className="font-medium text-accent hover:underline" to="/admin/review">返回 AI 人工复核 →</Link>
        <Link className="font-medium text-accent hover:underline" to="/admin/business">编辑业务匹配规则 →</Link>
      </div>
    </AdminPage>
  );
}
