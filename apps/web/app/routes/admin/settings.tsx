import { SITE } from "@aihot/industry/site";
import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/settings";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj, num } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, DataTable, Input, ReasonDialog } from "../../features/admin/ui";
import { toast } from "../../features/admin/toast";

interface Settings {
  contact: { wechatQr: string; feishuQr: string };
  targets: Array<{ key: string; purpose: string; kind: string; enabled: boolean; enabled_at: string | null; config_ref: string | null; note: string | null; deliveries_7d: number; last_sent_at: string | null }>;
  budgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number; note: string | null; updated_at: string; used_day: number; used_hour: number }>;
  collectionSchedule: { times: string[]; timezone: string };
  collectionStatus: {
    checkedAt: string;
    fetch: { runs: number; ok: number; failed: number; found: number; created: number };
    processing: { pending: number; failed: number; analyzed: number; published: number; errors: Array<{ error: string; count: number }> };
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<Settings>(request, "/api/admin/settings");
}

export const meta: Route.MetaFunction = () => [{ title: `设置 · ${SITE.name} 后台` }];

function QrSlot({ slot, label, src }: { slot: "wechatQr" | "feishuQr"; label: string; src: string }) {
  const { run, pending } = useAdminAction();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-4">
      <img src={src} alt={label} className="size-28 rounded-card bg-white object-contain p-1.5 ring-1 ring-line" />
      <div>
        <div className="text-[14px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink-4">{src}</div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) return toast("图片最大 2MB", "error");
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await run("POST", "/api/admin/settings/contact-qr", { slot, image }, { label: `qr-${slot}`, success: `${label}已更换，关于页 5 分钟内更新` });
          }}
        />
        <Button className="mt-2" size="sm" busy={pending === `qr-${slot}`} onClick={() => input.current?.click()}>更换图片</Button>
      </div>
    </div>
  );
}

function BudgetRow({ b }: { b: Settings["budgets"][number] }) {
  const { run, pending } = useAdminAction();
  const [v, setV] = useState({ perMinute: b.per_minute, perHour: b.per_hour, perDay: b.per_day });
  const [open, setOpen] = useState(false);
  const changed = v.perMinute !== b.per_minute || v.perHour !== b.per_hour || v.perDay !== b.per_day;
  return (
    <tr className="border-b border-line/70 last:border-0">
      <td className="px-3 py-2 font-mono text-[12.5px]">{b.service}</td>
      {(["perMinute", "perHour", "perDay"] as const).map((k) => (
        <td key={k} className="px-3 py-2">
          <Input type="number" min={0} className="!w-24 !py-1 text-right" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        </td>
      ))}
      <td className="num px-3 py-2 text-right text-ink-3">{num(b.used_hour)} / {num(b.used_day)}</td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" tone="primary" disabled={!changed} onClick={() => setOpen(true)}>保存</Button>
        <ReasonDialog
          open={open}
          title={`调整 ${b.service} 的请求上限`}
          description="上限是付费请求的熔断：超过后请求暂停并按窗口重试。填 0 表示立即停用这个服务。"
          confirmLabel="保存"
          busy={pending === "budget"}
          onClose={() => setOpen(false)}
          onSubmit={async (reason) => (await run("PUT", `/api/admin/budgets/${encodeURIComponent(b.service)}`, { ...v, reason }, { label: "budget", success: "上限已更新" })) !== null}
        />
      </td>
    </tr>
  );
}

function TargetToggle({ t }: { t: Settings["targets"][number] }) {
  const { run, pending } = useAdminAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" tone={t.enabled ? "danger" : "primary"} onClick={() => setOpen(true)}>{t.enabled ? "停用" : "启用"}</Button>
      <ReasonDialog
        open={open}
        title={`${t.enabled ? "停用" : "启用"}：${t.note ?? t.key}`}
        description={t.enabled ? "停用后新的推送不再发往这个群。" : "启用时间会被记录：启用之前的内容不会补推。开发与彩排环境即使启用也不会真的发出。"}
        danger={t.enabled}
        confirmLabel={t.enabled ? "停用" : "启用"}
        busy={pending === "target"}
        onClose={() => setOpen(false)}
        onSubmit={async (reason) => (await run("POST", `/api/admin/notify-targets/${encodeURIComponent(t.key)}`, { enabled: !t.enabled, reason }, { label: "target", success: "已更新" })) !== null}
      />
    </>
  );
}

function CollectionScheduleCard({ schedule, status }: { schedule: Settings["collectionSchedule"]; status: Settings["collectionStatus"] }) {
  const { run, pending } = useAdminAction();
  const revalidator = useRevalidator();
  const [times, setTimes] = useState(() => schedule.times.length ? schedule.times : ["08:00", "17:00"]);
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const changed = JSON.stringify(times) !== JSON.stringify(schedule.times);
  useEffect(() => {
    if (!watching) return;
    let left = 10;
    const timer = window.setInterval(() => {
      if (left-- <= 0) {
        window.clearInterval(timer);
        setWatching(false);
      } else if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [revalidator, watching]);
  const startFetch = async () => {
    const result = await run<{ enqueued: number }>("POST", "/api/admin/sources/fetch-scheduled", {}, { label: "fetch-scheduled", success: "已加入采集队列，正在执行" });
    if (result) {
      setNotice(`已加入 ${result.enqueued} 个招投标信源，正在等待采集和处理结果。`);
      setWatching(true);
    }
  };
  return (
    <Card title="招投标采集计划" right={<Badge tone="info">北京时间</Badge>}>
      <div className="text-[13px] text-ink-2">系统每天只在设定时段采集招投标信源；每分钟检查任务不会额外发起抓取。</div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {times.map((time, index) => (
          <label key={`${index}-${time}`} className="flex flex-col gap-1 text-[12px] text-ink-3">
            第 {index + 1} 次
            <Input type="time" value={time} onChange={(e) => setTimes(times.map((v, i) => i === index ? e.target.value : v))} className="!w-32" />
          </label>
        ))}
        {times.length < 4 && <Button size="sm" tone="ghost" onClick={() => setTimes([...times, "12:00"])}>增加时段</Button>}
        {times.length > 1 && <Button size="sm" tone="ghost" onClick={() => setTimes(times.slice(0, -1))}>减少时段</Button>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button tone="primary" disabled={!changed} onClick={() => setOpen(true)}>保存采集计划</Button>
        <Button busy={pending === "fetch-scheduled"} onClick={startFetch}>立即抓取一轮</Button>
        <Link className="text-[12px] text-accent hover:underline" to="/admin/runs">查看运行与错误</Link>
        <span className="text-[12px] text-ink-4">手动抓取与定时抓取使用同一条采集链路，仍受请求上限保护。</span>
      </div>
      {notice && <div className="mt-3 rounded-control bg-accent-softer px-3 py-2 text-[12.5px] text-ink-2">{notice}</div>}
      <div className="mt-4 rounded-card bg-bg-sunk/60 px-3.5 py-3 text-[12.5px] text-ink-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-ink">最近 2 小时执行状态</span>
          <span className="text-ink-4">采集任务 {status.fetch.runs} 次 · 成功 {status.fetch.ok} · 失败 {status.fetch.failed}</span>
        </div>
        <div className="mt-1">发现 {num(status.fetch.found)} 条，新增 {num(status.fetch.created)} 条，已发布 {num(status.processing.published)} 条；待处理 {num(status.processing.pending)} 条，处理失败 {num(status.processing.failed)} 条。</div>
        {status.processing.errors.length > 0 && (
          <div className="mt-2 space-y-1 text-hot">
            {status.processing.errors.map((item) => <div key={item.error} className="break-words">{item.count} 条：{item.error}</div>)}
          </div>
        )}
        {status.processing.failed > 0 && <div className="mt-2 text-ink-3">采集成功不代表 AI 处理成功；DeepSeek 余额不足或正文提取服务未配置时，条目会暂不进入首页精选，具体错误可在“运行”中查看。</div>}
      </div>
      <ReasonDialog
        open={open}
        title="保存招投标采集计划"
        description={`每天将在 ${times.join("、")}（北京时间）执行采集。`}
        confirmLabel="保存"
        busy={pending === "schedule"}
        onClose={() => setOpen(false)}
        onSubmit={async (reason) => (await run("PUT", "/api/admin/collection-schedule", { times, reason }, { label: "schedule", success: "采集计划已更新" })) !== null}
      />
    </Card>
  );
}

export default function SettingsAdmin({ loaderData: s }: Route.ComponentProps) {
  return (
    <AdminPage wide title="设置" subtitle="不改代码即可替换的运营设置。每次修改都写入审计记录。">
      <CollectionScheduleCard schedule={s.collectionSchedule} status={s.collectionStatus} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="关于页二维码">
          <div className="space-y-5">
            <QrSlot slot="wechatQr" label="微信公众号二维码" src={s.contact.wechatQr} />
            <QrSlot slot="feishuQr" label="飞书群二维码" src={s.contact.feishuQr} />
          </div>
        </Card>
        <Card title="通知目的地" pad={false}>
          <DataTable
            rows={s.targets}
            rowKey={(t) => t.key}
            columns={[
              { key: "k", label: "目的地", render: (t) => <div><div className="font-medium text-ink">{t.note ?? t.key}</div><div className="font-mono text-[11.5px] text-ink-4">{t.key} · {t.config_ref}</div></div> },
              { key: "e", label: "状态", render: (t) => (t.enabled ? <Badge tone="ok">启用于 {bj(t.enabled_at)}</Badge> : <Badge>停用</Badge>) },
              { key: "d", label: "7 天投递", align: "right", render: (t) => num(t.deliveries_7d) },
              { key: "a", label: "", align: "right", render: (t) => <TargetToggle t={t} /> },
            ]}
          />
        </Card>
      </div>
      <Card className="mt-5" title="付费请求上限" right={<span>已用：近 1 小时 / 近 24 小时</span>} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-3">
                <th className="px-3 py-2 font-medium">服务</th>
                <th className="px-3 py-2 font-medium">每分钟</th>
                <th className="px-3 py-2 font-medium">每小时</th>
                <th className="px-3 py-2 font-medium">每天</th>
                <th className="px-3 py-2 text-right font-medium">已用</th>
                <th />
              </tr>
            </thead>
            <tbody>{s.budgets.map((b) => <BudgetRow key={`${b.service}-${b.updated_at}`} b={b} />)}</tbody>
          </table>
        </div>
      </Card>
    </AdminPage>
  );
}
