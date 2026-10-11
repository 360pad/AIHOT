import { SITE } from "@aihot/industry/site";
import { useMemo, useState } from "react";
import type { Route } from "./+types/business";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { bj } from "../../features/admin/format";
import { AdminPage, Badge, Button, Card, Empty, Field, Input, ReasonDialog, Select, Textarea } from "../../features/admin/ui";
import { toast } from "../../features/admin/toast";

type ProfileVersion = { id: string; content_hash: string; profile: Profile; status: string; created_by: string; created_at: string; published_at: string | null };
type Profile = { schemaVersion: string; capabilities: Array<{ id: string; name: string; enabled: boolean; priority: string; description: string; serviceTerms: string[]; methodTerms: string[]; deliverableTerms: string[]; contextTerms: string[]; positiveExamples: string[]; negativeExamples: string[]; boundaries: string[] }>; contexts: Array<{ id: string; name: string; description: string }>; notes: string };
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

export default function BusinessAdmin({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const initial = useMemo(() => d.draftProfile?.profile ?? d.currentProfile?.profile ?? EMPTY, [d.currentProfile, d.draftProfile]);
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [testTitle, setTestTitle] = useState("");
  const [testBody, setTestBody] = useState("");
  const [draftDialog, setDraftDialog] = useState(false);
  const [rollback, setRollback] = useState<string | null>(null);
  const revision = d.draft?.revision ?? 0;
  const profileVersionId = d.draft?.versionId ?? d.current?.versionId ?? "";

  async function saveDraft(reason: string) {
    let profile: unknown;
    try { profile = JSON.parse(json); } catch { toast("配置必须是合法 JSON", "error"); return false; }
    return (await run("PUT", "/api/admin/business/profile/draft", { profile, expectedRevision: revision, reason }, { label: "business-draft", success: "业务配置草稿已保存" })) !== null;
  }

  return (
    <AdminPage title="业务匹配" subtitle="维护企业能力、测试语义判断并留下人工标注。草稿发布后才会成为新分析任务的配置。">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <Card title="企业能力配置" right={<span>草稿修订 {revision} · 当前 {d.current?.versionId ?? "未发布"}</span>}>
          <Field label="配置 JSON" hint="只保存能力、场景、词语与正反例；不支持脚本或任意表达式。">
            <Textarea className="min-h-[520px] font-mono text-[12px]" value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <ReasonDialog
              open={draftDialog}
              title="保存业务配置草稿"
              description="保存会生成不可变版本，但不会立即改变正在运行的业务分析。"
              confirmLabel="保存草稿"
              busy={pending === "business-draft"}
              onClose={() => setDraftDialog(false)}
              onSubmit={saveDraft}
            />
            <Button tone="primary" onClick={() => setDraftDialog(true)}>保存草稿</Button>
            {d.draft && <Button busy={pending === "business-publish"} onClick={() => run("POST", "/api/admin/business/profile/publish", { versionId: d.draft!.versionId, expectedRevision: revision, reason: "管理员发布业务能力配置" }, { label: "business-publish", success: "业务配置已发布" })}>发布当前草稿</Button>}
          </div>
        </Card>

        <Card title="版本历史" pad={false}>
          {d.history.length ? <div className="divide-y divide-line">{d.history.map((v) => (
            <div key={v.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13px]">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] text-ink-3">{v.id}</span><Badge tone={v.id === d.current?.versionId ? "ok" : v.status === "draft" ? "warn" : "muted"}>{v.id === d.current?.versionId ? "当前" : v.status === "draft" ? "草稿" : "历史"}</Badge></div><div className="mt-1 text-[11.5px] text-ink-4">{bj(v.created_at, true)} · {v.content_hash.slice(0, 12)}</div></div>
              {v.id !== d.current?.versionId && <Button size="sm" onClick={() => setRollback(v.id)}>回退</Button>}
            </div>
          ))}</div> : <Empty>还没有业务配置版本</Empty>}
        </Card>
      </div>

      <Card className="mt-5" title="材料测试" right={<span>测试调用与正式分析使用同一业务结果契约</span>}>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
          <Field label="公告标题"><Input value={testTitle} onChange={(e) => setTestTitle(e.target.value)} placeholder="例如：某水库库底高程测量服务" /></Field>
          <Field label="使用配置版本"><Select value={profileVersionId} disabled><option value={profileVersionId}>{profileVersionId || "请先保存业务配置"}</option></Select></Field>
        </div>
        <Field label="采购范围或正文"><Textarea className="mt-3 min-h-[160px]" value={testBody} onChange={(e) => setTestBody(e.target.value)} placeholder="粘贴采购需求、服务范围、成果要求等原文" /></Field>
        <Button className="mt-3" tone="primary" disabled={!profileVersionId || !testTitle.trim()} busy={pending === "business-test"} onClick={() => run("POST", "/api/admin/business/tests", { profileVersionId, title: testTitle, body: testBody }, { label: "business-test", success: "测试已提交，等待分析任务处理" })}>提交测试</Button>
      </Card>

      <Card className="mt-5" title="测试结果与人工标注" pad={false}>
        {d.tests.length ? <div className="divide-y divide-line">{d.tests.map((t) => <TestRow key={t.id} test={t} run={run} pending={pending} />)}</div> : <Empty>还没有测试记录</Empty>}
      </Card>

      <ReasonDialog open={!!rollback} title="回退业务配置" description="回退只切换当前版本指针，历史版本和已经产生的分析结果不会被覆盖。" confirmLabel="确认回退" busy={pending === "business-rollback"} onClose={() => setRollback(null)} onSubmit={async (reason) => (await run("POST", "/api/admin/business/profile/rollback", { versionId: rollback, reason }, { label: "business-rollback", success: "已回退业务配置" })) !== null} />
    </AdminPage>
  );
}

function TestRow({ test, run, pending }: { test: Test; run: ReturnType<typeof useAdminAction>["run"]; pending: string | null }) {
  const result = test.result === null || test.result === undefined ? null : JSON.stringify(test.result, null, 2);
  return <div className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium text-ink">{test.title}</div><div className="mt-0.5 font-mono text-[11px] text-ink-4">{test.id} · {bj(test.created_at, true)}</div></div><Badge tone={test.status === "succeeded" ? "ok" : test.status === "failed" ? "bad" : "warn"}>{test.status === "queued" ? "排队中" : test.status === "running" ? "分析中" : test.status === "succeeded" ? "已完成" : "失败"}</Badge></div>{test.error ? <div className="mt-2 text-[12.5px] text-hot">{test.error}</div> : null}{result ? <pre className="mt-2 max-h-52 overflow-auto rounded-control bg-bg-sunk p-3 text-[11.5px] leading-relaxed text-ink-2">{result}</pre> : null}<div className="mt-2 flex gap-2"><Button size="sm" disabled={test.status !== "succeeded"} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "relevant", capabilityIds: [], participation: "unknown", evidenceQuality: "limited", note: "人工确认相关" }, { label: `business-feedback-${test.id}`, success: "已标记为相关" })}>标记相关</Button><Button size="sm" disabled={test.status !== "succeeded"} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "irrelevant", capabilityIds: [], participation: "unknown", evidenceQuality: "insufficient", note: "人工确认无关" }, { label: `business-feedback-${test.id}`, success: "已标记为无关" })}>标记无关</Button><Button size="sm" disabled={pending === `business-feedback-${test.id}`} onClick={() => run("POST", "/api/admin/business/feedback", { testId: test.id, label: "unknown", capabilityIds: [], participation: "unknown", evidenceQuality: "insufficient", note: "人工标记待确认" }, { label: `business-feedback-${test.id}`, success: "已标记待确认" })}>待确认</Button></div></div>;
}
