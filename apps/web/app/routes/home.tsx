import { SITE, withSubject } from "@aihot/industry/site";
import { data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey, isStageKey, STAGE_LABELS, CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { IndustryNav, SearchField, SearchIconLink, StageNav } from "../features/feed/Filters";
import { IconChevronDown } from "../components/icons";
import { beijingDate, beijingWeekday } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const stageParam = url.searchParams.get("stage") ?? "tender";
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const stage = isStageKey(stageParam) ? stageParam : "tender";
  const tag = url.searchParams.get("tag")?.trim() || null;
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(`/api/site/timeline${queryString({ channel: channel === "all" ? null : channel, category, stage, tag })}`, { responseHeaders: upstream, signal: request.signal });
  return withHeaders({ data, filters: { channel, category, stage, tag, topic: null } }, { headers: releaseBoundCache(data.refreshAt, 60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const path = listPath("/", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, stage: f?.stage, tag: f?.tag });
  return pageMeta({ path, jsonLd: path === "/" ? organizationLd() : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

export default function Home() {
  const { data, filters } = useLoaderData<typeof loader>();
  const stage = filters.stage ?? "tender";
  const title = filters.tag ? `#${filters.tag}` : STAGE_LABELS[stage];
  const industry = filters.category ? CATEGORY_LABELS[filters.category] : "全部行业";
  return (
    <div className="radar-home-page pb-6">
      {/* Phones: brand bar, today's hot topics, then the feed under "最新精选". */}
      <div className="flex h-14 items-center justify-between lg:hidden">
        <Wordmark size={20} className="text-ink" />
        <TodayLabel />
      </div>
      <div className="mt-3 lg:hidden">
        <StageNav stage={stage} className="-mx-1 px-1" />
        <div className="mt-2 flex items-center gap-2">
          <IndustryNav category={filters.category} mobile className="min-w-0 flex-1" />
          <SearchIconLink />
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <IndustryNav category={filters.category} />
        <section className="radar-home-main min-w-0">
          <div className="hidden lg:block">
            <div className="radar-home-heading">
              <div>
                <h1 className="radar-home-title">{title} · {industry}</h1>
                <p className="radar-home-subtitle">发现与业务相关的在招项目</p>
              </div>
              <div className="radar-refresh-copy">
                <span>每日 08:00、17:00 更新</span>
                <span>最近更新：10月12日 17:00</span>
              </div>
            </div>
            <div className="radar-toolbar">
              <SearchField variant="track" keep={{ category: filters.category, stage }} placeholder="搜索项目名称、采购单位或关键词" />
              <button type="button" className="radar-filter-button">采购方式 <IconChevronDown size={15} /></button>
              <button type="button" className="radar-filter-button">发布日期 <IconChevronDown size={15} /></button>
            </div>
          </div>

          {data.hot && <HotTopics entries={data.hot} />}

          <h2 className="mt-6 text-[20px] font-bold text-ink lg:hidden">{filters.tag ? title : `${STAGE_LABELS[stage]} · ${industry}`}</h2>
          <Timeline initial={data} filters={data.filters} variant="radar" />
        </section>
      </div>
    </div>
  );
}
