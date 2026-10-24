import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/qualifications";
import { SITE } from "@aihot/industry/site";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Badge, Button, Card, Empty, Input } from "../../features/admin/ui";

type Category = "company" | "personnel";
type Qualification = { id: number; category: Category; name: string; createdAt: string; updatedAt: string };

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const category: Category = url.searchParams.get("tab") === "personnel" ? "personnel" : "company";
  const data = await adminGet<{ rows: Qualification[] }>(request, `/api/admin/qualifications?category=${category}`);
  return { ...data, category };
}

export const meta: Route.MetaFunction = () => [{ title: `资质库 · ${SITE.name} 后台` }];

export default function QualificationsAdmin({ loaderData: d }: Route.ComponentProps) {
  const { run, pending } = useAdminAction();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const title = d.category === "company" ? "公司资质维护" : "人员资质维护";

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const result = await run("POST", "/api/admin/qualifications", { category: d.category, name }, {
      label: `qualification-create-${d.category}`, success: `已添加${d.category === "company" ? "公司资质" : "人员资质"}`,
    });
    if (result) { setNewName(""); setAdding(false); }
  };

  const save = async (item: Qualification) => {
    const name = editName.trim();
    if (!name || name === item.name) { setEditingId(null); return; }
    const result = await run("PATCH", `/api/admin/qualifications/${item.id}`, { name }, {
      label: `qualification-update-${item.id}`, success: "资质名称已更新",
    });
    if (result) setEditingId(null);
  };

  const remove = (item: Qualification) => {
    if (!window.confirm(`确定从当前资质清单移除“${item.name}”吗？`)) return;
    void run("DELETE", `/api/admin/qualifications/${item.id}`, undefined, {
      label: `qualification-delete-${item.id}`, success: "已从当前资质清单移除",
    });
  };

  return <AdminPage title="资质库" subtitle="维护公司资质和人员证书类型。AI 会从招标材料提取明确要求，并提示当前清单是否登记；最终仍由人工核对招标文件。" wide>
    <Card className="mb-4" pad={false}>
      <div className="flex flex-wrap gap-1 border-b border-line px-4 pt-3">
        <Link to="?tab=company" className={`rounded-t-control px-4 py-2 text-[13px] font-medium ${d.category === "company" ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-bg-sunk"}`}>公司资质</Link>
        <Link to="?tab=personnel" className={`rounded-t-control px-4 py-2 text-[13px] font-medium ${d.category === "personnel" ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-bg-sunk"}`}>人员资质</Link>
      </div>
      <div className="p-4 xl:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 className="text-[16px] font-semibold text-ink">{title}</h2><Badge tone="info">{d.rows.length} 项</Badge></div>
            <p className="mt-1 max-w-4xl text-[12.5px] leading-6 text-ink-3">{d.category === "company" ? "按招标文件常见写法录入公司证书或资质名称，例如“测绘资质（乙级）”。同一资质不要重复添加。" : "只录人员证书类型，例如“一级建造师”“注册测绘师”；无需维护持证人员姓名、有效期等信息。"}</p>
          </div>
          {!adding && <Button tone="primary" onClick={() => setAdding(true)}>新增{d.category === "company" ? "公司资质" : "人员资质"}</Button>}
        </div>

        {adding && <form onSubmit={(event) => void add(event)} className="mt-4 flex flex-col gap-2 rounded-panel bg-bg-sunk/45 p-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1"><span className="mb-1 block text-[12px] font-medium text-ink-3">资质名称</span><Input autoFocus value={newName} maxLength={160} placeholder={d.category === "company" ? "例如：测绘资质（乙级）" : "例如：一级建造师"} onChange={(event) => setNewName(event.target.value)} /></label>
          <Button type="submit" tone="primary" disabled={!newName.trim()} busy={pending === `qualification-create-${d.category}`}>保存</Button>
          <Button onClick={() => { setAdding(false); setNewName(""); }}>取消</Button>
        </form>}

        <div className="mt-4 overflow-hidden rounded-panel ring-1 ring-line">
          {!d.rows.length ? <Empty>尚未维护{d.category === "company" ? "公司资质" : "人员资质"}。添加后，相关招标信息会自动对照并提示。</Empty> : <ul className="divide-y divide-line">{d.rows.map((item) => <li key={item.id} className="flex flex-col gap-3 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            {editingId === item.id ? <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center"><Input autoFocus value={editName} maxLength={160} onChange={(event) => setEditName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(item); } }} /><Button size="sm" tone="primary" disabled={!editName.trim()} busy={pending === `qualification-update-${item.id}`} onClick={() => void save(item)}>保存</Button><Button size="sm" onClick={() => setEditingId(null)}>取消</Button></div>
              : <><div className="min-w-0"><div className="break-words text-[13.5px] font-medium text-ink">{item.name}</div><div className="mt-1 text-[11.5px] text-ink-4">{d.category === "company" ? "公司资质" : "人员证书"}</div></div><div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => { setEditingId(item.id); setEditName(item.name); }}>修改</Button><Button size="sm" tone="danger" busy={pending === `qualification-delete-${item.id}`} onClick={() => remove(item)}>删除</Button></div></>}
          </li>)}</ul>}
        </div>
      </div>
    </Card>
  </AdminPage>;
}
