import { SITE } from "@aihot/industry/site";
import { useMemo, useState, type ReactNode } from "react";
import type { Route } from "./+types/business";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Field, Input, ReasonDialog, Select, Textarea } from "../../features/admin/ui";

type Priority = "重点" | "常规" | "观察";
type Capability = {
  id: string;
  name: string;
  enabled: boolean;
  priority: Priority;
  description: string;
  serviceTerms: string[];
  methodTerms: string[];
  deliverableTerms: string[];
  contextTerms: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  boundaries: string[];
};
type Profile = { schemaVersion: string; capabilities: Capability[]; contexts: Array<{ id: string; name: string; description: string }>; notes: string };
type ProfileVersion = { id: string; content_hash: string; profile: Profile; status: string; created_by: string; created_at: string; published_at: string | null };
type Test = { id: string; profile_version_id: string; title: string; source_url: string | null; status: string; result: unknown; error: string | null; created_at: string; updated_at: string };
type Data = { current: { versionId: string; revision: number } | null; draft: { versionId: string; revision: number } | null; currentProfile: ProfileVersion | null; draftProfile: ProfileVersion | null; history: ProfileVersion[]; tests: Test[] };

export async function loader({ request }: Route.LoaderArgs) {
  const [profile, tests] = await Promise.all([
    adminGet<Omit<Data, "tests">>(request, "/api/admin/business/profile"),
    adminGet<{ tests: Test[] }>(request, "/api/admin/business/tests"),
  ]);
  return { ...profile, tests: tests.tests };
}

export const meta: Route.MetaFunction = () => [{ title: `业务匹配 · ${SITE.name} 后台` }];

const EMPTY: Profile = { schemaVersion: "1", capabilities: [], contexts: [], notes: "" };

function cloneProfile(profile: Profile): Profile {
  return JSON.parse(JSON.stringify(profile)) as Profile;
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function nextCustomCapabilityId(capabilities: Capability[]) {
  let number = 1;
  while (capabilities.some((capability) => capability.id === `custom-capability-${number}`)) number += 1;
  return `custom-capability-${number}`;
}

function nextCustomContextId(contexts: Profile["contexts"]) {
  let number = 1;
  while (contexts.some((context) => context.id === `custom-context-${number}`)) number += 1;
  return `custom-context-${number}`;
}

export default function BusinessAdmin({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const initial = useMemo(() => d.draftProfile?.profile ?? d.currentProfile?.profile ?? EMPTY, [d.currentProfile, d.draftProfile]);
  const [profile, setProfile] = useState(() => cloneProfile(initial));
  const [testTitle, setTestTitle] = useState("");
  const [testBody, setTestBody] = useState("");
  const [draftDialog, setDraftDialog] = useState(false);
  const [rollback, setRollback] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(() => initial.capabilities[0]?.id ?? "contexts");
  const [copied, setCopied] = useState(false);
  const revision = d.draft?.revision ?? 0;
  const profileVersionId = d.draft?.versionId ?? d.current?.versionId ?? "";
  const json = JSON.stringify(profile, null, 2);

  function updateCapability(index: number, patch: Partial<Capability>) {
    setProfile((current) => ({ ...current, capabilities: current.capabilities.map((capability, i) => i === index ? { ...capability, ...patch } : capability) }));
  }

  function updateContext(index: number, patch: Partial<Profile["contexts"][number]>) {
    setProfile((current) => ({ ...current, contexts: current.contexts.map((context, i) => i === index ? { ...context, ...patch } : context) }));
  }

  function addCapability() {
    const id = nextCustomCapabilityId(profile.capabilities);
    const capability: Capability = { id, name: "新业务能力", enabled: false, priority: "常规", description: "请填写这项业务能力的服务范围、交付成果和排除边界。", serviceTerms: [], methodTerms: [], deliverableTerms: [], contextTerms: [], positiveExamples: [], negativeExamples: [], boundaries: [] };
    setProfile((current) => ({ ...current, capabilities: [...current.capabilities, capability] }));
    setActiveTab(id);
  }

  function addContext() {
    const id = nextCustomContextId(profile.contexts);
    const context = { id, name: "新应用场景", description: "请填写该场景的采购方、项目对象或业务环境说明。" };
    setProfile((current) => ({ ...current, contexts: [...current.contexts, context] }));
    setActiveTab("contexts");
  }

  async function saveDraft(reason: string) {
    return (await run("PUT", "/api/admin/business/profile/draft", { profile, expectedRevision: revision, reason }, { label: "business-draft", success: "业务配置草稿已保存" })) !== null;
  }

  async function copyJson() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <AdminPage className="max-w-[1680px]" title="业务匹配" subtitle="用表单维护企业能力、测试语义判断并留下人工标注。草稿发布后才会成为新分析任务的配置。">
      <Card title="怎么使用" className="mb-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Step number="1" title="编辑能力" text="每行填写一个词或一个例子。行业只是背景，服务动作和交付成果才是主要判断依据。" />
          <Step number="2" title="保存草稿" text="先保存，系统会生成一个可回退的版本，不会立即改变正在运行的配置。" />
          <Step number="3" title="提交测试" text="用真实招标标题和正文测试刚保存的草稿，查看模型是否 PASS、BLOCK 或待确认。" />
          <Step number="4" title="测试通过后发布" text="测试结果符合预期后，再发布当前草稿；有问题就继续修改、保存和测试。" />
        </div>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-[224px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-6" title="业务配置" pad={false}>
          <nav aria-label="业务配置二级导航" className="p-2">
            <SubnavSection title="业务能力" hint="公司能提供什么服务">
              {profile.capabilities.map((capability) => <SubnavItem key={capability.id} active={activeTab === capability.id} onClick={() => setActiveTab(capability.id)}>{capability.name || "未命名能力"}</SubnavItem>)}
              <SubnavAction onClick={addCapability}>＋ 新建业务能力</SubnavAction>
            </SubnavSection>
            <SubnavSection title="应用场景" hint="项目发生在哪里、服务谁">
              <SubnavItem active={activeTab === "contexts"} onClick={() => setActiveTab("contexts")}>场景配置</SubnavItem>
              <SubnavAction onClick={addContext}>＋ 新建应用场景</SubnavAction>
            </SubnavSection>
            <SubnavSection title="查看与验证" hint="核对配置和测试材料">
              <SubnavItem active={activeTab === "json"} onClick={() => setActiveTab("json")}>JSON 预览</SubnavItem>
            </SubnavSection>
          </nav>
        </Card>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="企业能力配置" right={<span>草稿修订 {revision} · 当前 {d.current?.versionId ?? "未发布"}</span>}>
          <p className="mb-4 text-[13px] leading-relaxed text-ink-3">从左侧选择要维护的业务能力或应用场景，右侧只显示当前编辑内容。业务能力回答“公司能做什么”，应用场景补充“项目发生在哪里、服务谁”。</p>

          {activeTab === "json" ? <div className="rounded-card border border-line bg-bg-sunk p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[14px] font-semibold text-ink">当前表单生成的 JSON</h3><p className="mt-1 text-[12px] text-ink-4">只读预览，保存草稿时提交的就是这份内容。</p></div><Button size="sm" onClick={() => { void copyJson(); }}>{copied ? "已复制" : "复制 JSON"}</Button></div><pre className="max-h-[620px] overflow-auto rounded-control bg-surface p-3 text-[11.5px] leading-relaxed text-ink-2">{json}</pre></div> : activeTab === "contexts" ? <div className="space-y-4"><div><h3 className="text-[14px] font-semibold text-ink">应用场景配置</h3><p className="mt-1 text-[12px] text-ink-4">场景只提供上下文，不是公司的服务能力；例如“水利”和“矿山”都可以使用“测绘”能力。</p></div><div className="space-y-3">{profile.contexts.map((context, index) => <div key={context.id} className="rounded-card border border-line bg-bg-sunk p-3"><div className="grid gap-3 sm:grid-cols-[180px_1fr]"><Field label="场景名称"><Input value={context.name} onChange={(e) => updateContext(index, { name: e.target.value })} /></Field><Field label="场景说明"><Input value={context.description} onChange={(e) => updateContext(index, { description: e.target.value })} /></Field></div><div className="mt-2 font-mono text-[11px] text-ink-4">场景 ID：{context.id}</div></div>)}</div><Field label="给模型的总体说明" hint="补充企业边界、优先关注的公告类型或需要人工复核的情况。"><Textarea className="min-h-[100px]" value={profile.notes} onChange={(e) => setProfile((current) => ({ ...current, notes: e.target.value }))} placeholder="例如：优先关注采购意向、招标公告、方案公示和中标信息；只出现硬件采购时通常不相关。" /></Field></div> : profile.capabilities.map((capability, index) => capability.id === activeTab && <CapabilityEditor key={capability.id} capability={capability} onChange={(patch) => updateCapability(index, patch)} />)}
          <div className="mt-3 flex flex-wrap gap-2">
            <ReasonDialog open={draftDialog} title="保存业务配置草稿" description="保存会生成不可变版本，但不会立即改变正在运行的业务分析。" confirmLabel="保存草稿" busy={pending === "business-draft"} onClose={() => setDraftDialog(false)} onSubmit={saveDraft} />
            <Button tone="primary" onClick={() => setDraftDialog(true)}>保存草稿</Button>
          </div>
        </Card>

        <Card className="xl:sticky xl:top-6" title="版本历史" pad={false}>
          {d.history.length ? <div className="divide-y divide-line">{d.history.map((v) => (
            <div key={v.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13px]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] text-ink-3">{v.id}</span><Badge tone={v.id === d.current?.versionId ? "ok" : v.status === "draft" ? "warn" : "muted"}>{v.id === d.current?.versionId ? "当前" : v.status === "draft" ? "草稿" : "历史"}</Badge></div><div className="mt-1 text-[11.5px] text-ink-4">{bj(v.created_at, true)} · {v.content_hash.slice(0, 12)}</div></div>{v.id !== d.current?.versionId && <Button size="sm" onClick={() => setRollback(v.id)}>回退</Button>}</div>
          ))}</div> : <Empty>还没有业务配置版本</Empty>}
        </Card>
        </div>
      </div>

      <Card className="mt-5" title="材料测试" right={<span>测试调用与正式分析使用同一业务结果契约</span>}>
        <p className="mb-3 text-[13px] text-ink-3">把人工收集到的真实招标标题和采购范围粘贴进来，用当前已发布版本测试模型是否识别为相关商机。</p>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]"><Field label="公告标题"><Input value={testTitle} onChange={(e) => setTestTitle(e.target.value)} placeholder="例如：某水库库底高程测量服务" /></Field><Field label="使用配置版本"><Select value={profileVersionId} disabled><option value={profileVersionId}>{profileVersionId || "请先保存业务配置"}</option></Select></Field></div>
        <Field label="采购范围或正文"><Textarea className="mt-3 min-h-[160px]" value={testBody} onChange={(e) => setTestBody(e.target.value)} placeholder="粘贴采购需求、服务范围、成果要求等原文" /></Field>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Button tone="primary" disabled={!profileVersionId || !testTitle.trim()} busy={pending === "business-test"} onClick={() => run("POST", "/api/admin/business/tests", { profileVersionId, title: testTitle, body: testBody }, { label: "business-test", success: "测试已提交，等待分析任务处理" })}>提交测试</Button>{d.draft && <Button busy={pending === "business-publish"} onClick={() => run("POST", "/api/admin/business/profile/publish", { versionId: d.draft!.versionId, expectedRevision: revision, reason: "管理员发布业务能力配置（已完成材料测试）" }, { label: "business-publish", success: "业务配置已发布" })}>测试通过后发布草稿</Button>}</div>
        <p className="mt-2 text-[12px] text-ink-4">建议先提交测试并确认结果，再点击发布；测试不符合预期时不要发布，回到上方继续修改草稿。</p>
      </Card>

      <Card className="mt-5" title="测试结果与人工标注" pad={false}>
        {d.tests.length ? <div className="divide-y divide-line">{d.tests.map((t) => <TestRow key={t.id} test={t} run={run} pending={pending} />)}</div> : <Empty>还没有测试记录</Empty>}
      </Card>

      <ReasonDialog open={!!rollback} title="回退业务配置" description="回退只切换当前版本指针，历史版本和已经产生的分析结果不会被覆盖。" confirmLabel="确认回退" busy={pending === "business-rollback"} onClose={() => setRollback(null)} onSubmit={async (reason) => (await run("POST", "/api/admin/business/profile/rollback", { versionId: rollback, reason }, { label: "business-rollback", success: "已回退业务配置" })) !== null} />
    </AdminPage>
  );
}

function SubnavSection({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <div className="mb-4 last:mb-0"><div className="px-2 pb-1.5"><div className="text-[12.5px] font-semibold text-ink">{title}</div><div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-4">{hint}</div></div><div className="space-y-0.5">{children}</div></div>;
}

function SubnavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className={`flex min-h-9 w-full items-center rounded-control px-2.5 text-left text-[13px] transition-colors ${active ? "bg-ink text-bg font-medium" : "text-ink-2 hover:bg-bg-sunk hover:text-ink"}`}><span className="min-w-0 truncate">{children}</span></button>;
}

function SubnavAction({ onClick, children }: { onClick: () => void; children: string }) {
  return <button type="button" onClick={onClick} className="flex min-h-8 w-full items-center rounded-control px-2.5 text-left text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft">{children}</button>;
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-card border border-line bg-bg-sunk p-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-hot text-[12px] font-semibold text-white">{number}</span><span className="font-medium text-ink">{title}</span></div><p className="mt-2 text-[12px] leading-relaxed text-ink-3">{text}</p></div>;
}

function CapabilityEditor({ capability, onChange }: { capability: Capability; onChange: (patch: Partial<Capability>) => void }) {
  return <div className="rounded-card border border-line bg-bg-sunk p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-[15px] font-semibold text-ink">{capability.name || "未命名能力"}</h3><Badge tone="muted">{capability.id}</Badge></div><p className="mt-1 text-[12px] text-ink-4">{capability.description || "请填写这项能力的业务边界"}</p></div><label className="flex items-center gap-2 text-[12px] text-ink-2"><input type="checkbox" checked={capability.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />启用</label></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_150px]"><Field label="能力名称"><Input value={capability.name} onChange={(e) => onChange({ name: e.target.value })} /></Field><Field label="优先级"><Select value={capability.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })}><option value="重点">重点</option><option value="常规">常规</option><option value="观察">观察</option></Select></Field></div>
    <div className="mt-3"><Field label="能力说明"><Textarea value={capability.description} onChange={(e) => onChange({ description: e.target.value })} /></Field></div>
    <div className="mt-3 grid gap-3 lg:grid-cols-2"><ListEditor label="服务动作" hint="例如：测量、整理、数字化、监测、系统建设" values={capability.serviceTerms} onChange={(serviceTerms) => onChange({ serviceTerms })} /><ListEditor label="方法与技术" hint="例如：无人机、多波束、GIS、数据治理" values={capability.methodTerms} onChange={(methodTerms) => onChange({ methodTerms })} /><ListEditor label="交付成果" hint="例如：测量成果、档案数字化成果、平台软件" values={capability.deliverableTerms} onChange={(deliverableTerms) => onChange({ deliverableTerms })} /><ListEditor label="对象与场景" hint="例如：水库、矿山、机关档案、政务平台" values={capability.contextTerms} onChange={(contextTerms) => onChange({ contextTerms })} /><ListEditor label="相关正例" hint="粘贴或概括应当命中的真实项目标题" values={capability.positiveExamples} onChange={(positiveExamples) => onChange({ positiveExamples })} /><ListEditor label="无关反例" hint="明确哪些相似项目应排除" values={capability.negativeExamples} onChange={(negativeExamples) => onChange({ negativeExamples })} /></div>
    <ListEditor className="mt-3" label="边界与排除规则" hint="例如：只有设备供货、耗材采购且没有服务交付时排除" values={capability.boundaries} onChange={(boundaries) => onChange({ boundaries })} />
  </div>;
}

function ListEditor({ label, hint, values, onChange, className = "" }: { label: string; hint: string; values: string[]; onChange: (values: string[]) => void; className?: string }) {
  return <div className={className}><Field label={label} hint={`${hint}；每行一条`}><Textarea className="min-h-[84px]" value={values.join("\n")} onChange={(e) => onChange(lines(e.target.value))} /></Field></div>;
}

function TestRow({ test, run, pending }: { test: Test; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const result = test.result === null || test.result === undefined ? null : JSON.stringify(test.result, null, 2);
  return <div className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium text-ink">{test.title}</div><div className="mt-0.5 font-mono text-[11px] text-ink-4">{test.id} · {bj(test.created_at, true)}</div></div><Badge tone={test.status === "succeeded" ? "ok" : test.status === "failed" ? "bad" : "warn"}>{test.status === "queued" ? "排队中" : test.status === "running" ? "分析中" : test.status === "succeeded" ? "已完成" : "失败"}</Badge></div>{test.error ? <div className="mt-2 text-[12.5px] text-hot">{test.error}</div> : null}{result ? <pre className="mt-2 max-h-52 overflow-auto rounded-control bg-bg-sunk p-3 text-[11.5px] leading-relaxed text-ink-2">{result}</pre> : null}<div className="mt-2 flex gap-2"><Button size="sm" disabled={test.status !== "succeeded"} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "relevant", capabilityIds: [], participation: "unknown", evidenceQuality: "limited", note: "人工确认相关" }, { label: `business-feedback-${test.id}`, success: "已标记为相关" })}>标记相关</Button><Button size="sm" disabled={test.status !== "succeeded"} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "irrelevant", capabilityIds: [], participation: "unknown", evidenceQuality: "insufficient", note: "人工确认无关" }, { label: `business-feedback-${test.id}`, success: "已标记为无关" })}>标记无关</Button><Button size="sm" disabled={pending === `business-feedback-${test.id}`} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "unknown", capabilityIds: [], participation: "unknown", evidenceQuality: "insufficient", note: "人工标记待确认" }, { label: `business-feedback-${test.id}`, success: "已标记待确认" })}>待确认</Button></div></div>;
}
