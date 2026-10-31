import { SITE } from "@aihot/industry/site";
import type { Route } from "./+types/keyword-trends";
import { KeywordFrequency } from "../../features/admin/KeywordFrequency";
import { AdminPage } from "../../features/admin/ui";
import { adminGet } from "../../lib/admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const kind = url.searchParams.get("kind") ?? "all";
  const period = url.searchParams.get("period") ?? "30d";
  const category = url.searchParams.get("category") ?? "all";
  const frequency = await adminGet<Record<string, any>>(request, "/api/admin/keywords/frequency?" + new URLSearchParams({ q, kind, period }));
  return { frequency, q, kind, period: frequency.period ?? period, category };
}

export const meta: Route.MetaFunction = () => [{ title: `关键词趋势 · ${SITE.name} 后台` }];

export default function KeywordTrends({ loaderData }: Route.ComponentProps) {
  const { frequency, q, kind, period, category } = loaderData;
  return <AdminPage wide title="关键词趋势" subtitle="按行业查看正式词近期命中与精选情况；按文章发布时间统计，缺失时采用采集时间，同篇文章中的同一词条只计一次。">
    <KeywordFrequency frequency={frequency} q={q} kind={kind} period={period} category={category} />
  </AdminPage>;
}
