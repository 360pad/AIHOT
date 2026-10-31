import { area, curveMonotoneX, line } from "d3-shape";
import { motion } from "motion/react";
import { Form, Link } from "react-router";
import { IconBookmark, IconChart, IconDoc, IconMinus, IconTrendDown, IconTrendUp } from "../../components/icons";
import { num, pct } from "./format";
import { Badge, Button, Card, Empty, Input, Select } from "./ui";

type Row = Record<string, any>;

const PERIODS = [
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
  { id: "all", label: "全部" },
];

const CATEGORY_TAB_LABELS: Record<string, string> = {
  "smart-water": "智慧水利",
  "digital-government": "城市治理",
  "digital-mining": "数字矿山",
  "digital-construction": "数字建筑",
  geospatial: "GIS测绘",
  general: "综合商机",
  unclassified: "未分类",
};

function frequencyUrl({ period, category, q, kind }: { period: string; category: string; q: string; kind: string }) {
  const params = new URLSearchParams({ period, category, q, kind });
  return `/admin/keyword-trends?${params}`;
}

function termCounts(item: Row) {
  const hits = Number(item.hitArticleCount) || 0;
  const selected = Number(item.selectedHitCount) || 0;
  return { hits, selected, unselected: Math.max(0, hits - selected) };
}

function aggregateTermRows(terms: Row[]): Row[] {
  const grouped = new Map<string, Row>();
  for (const item of terms) {
    const key = `${item.kind}:${item.normalizedTerm}`;
    const counts = termCounts(item);
    const current = grouped.get(key) ?? {
      ...item,
      hitArticleCount: 0,
      selectedHitCount: 0,
      categoryKeys: new Set<string>(),
      capabilityNames: new Set<string>(),
    };
    current.hitArticleCount += counts.hits;
    current.selectedHitCount += counts.selected;
    current.categoryKeys.add(item.category);
    for (const name of String(item.capabilityName ?? "").split("、").filter(Boolean)) current.capabilityNames.add(name);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((item): Row => ({ ...item, categoryKeys: [...item.categoryKeys], capabilityName: [...item.capabilityNames].join("、") }))
    .sort((a, b) => b.hitArticleCount - a.hitArticleCount || a.term.localeCompare(b.term, "zh-CN"));
}

type TrendPoint = { x: number; y: number; value: number | null };

function Sparkline({ values, color, label, percent = false }: { values: Array<number | null>; color: string; label: string; percent?: boolean }) {
  const width = 300;
  const height = 52;
  const active = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (active.length < 2 || !active.some((value) => value > 0)) return <div className="h-[52px]" aria-hidden="true" />;
  const maximum = percent ? 100 : Math.max(...active, 1);
  const points: TrendPoint[] = values.map((value, index) => ({
    x: values.length < 2 ? 0 : (index / (values.length - 1)) * width,
    y: value === null ? height : height - 5 - (Math.max(0, value) / maximum) * (height - 10),
    value,
  }));
  const linePath = line<TrendPoint>().defined((point) => point.value !== null).curve(curveMonotoneX).x((point) => point.x).y((point) => point.y)(points);
  const areaPath = area<TrendPoint>().defined((point) => point.value !== null).curve(curveMonotoneX).x((point) => point.x).y0(height).y1((point) => point.y)(points);
  if (!linePath || !areaPath) return <div className="h-[52px]" aria-hidden="true" />;
  return <svg className="h-[52px] w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <path d={areaPath} fill={color} fillOpacity="0.10" />
    <motion.path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.85, ease: "easeOut" }} />
  </svg>;
}

function changeFor(current: number | null, previous: number | null, percentagePoint = false) {
  if (previous === null || current === null) return { text: "累计", direction: "flat" as const };
  if (percentagePoint) {
    const delta = (current - previous) * 100;
    return { text: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`, direction: delta > 0.05 ? "up" as const : delta < -0.05 ? "down" as const : "flat" as const };
  }
  if (!previous) return { text: current ? "新增" : "持平", direction: current ? "up" as const : "flat" as const };
  const delta = ((current - previous) / previous) * 100;
  return { text: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`, direction: delta > 0.05 ? "up" as const : delta < -0.05 ? "down" as const : "flat" as const };
}

export function KeywordFrequency({ frequency, q, kind, period, category }: { frequency: Row; q: string; kind: string; period: string; category: string }) {
  const terms: Row[] = frequency.terms ?? [];
  const categories: Array<{ key: string; label: string }> = frequency.categories ?? [];
  const selectedCategory = category === "all" || categories.some((item) => item.key === category) ? category : "all";
  const hitTerms = terms.filter((item) => termCounts(item).hits > 0);
  const categoryTerms: Row[] = selectedCategory === "all" ? aggregateTermRows(hitTerms) : hitTerms.filter((item) => item.category === selectedCategory);
  const totalHits = categoryTerms.reduce((sum, item) => sum + termCounts(item).hits, 0);
  const selectedHits = categoryTerms.reduce((sum, item) => sum + termCounts(item).selected, 0);
  const unselectedHits = totalHits - selectedHits;
  const selectedShare = totalHits ? selectedHits / totalHits : null;
  const activePeriod = PERIODS.some((item) => item.id === period) ? period : "30d";
  const trend = frequency.trend ?? { dates: [], summary: [], daily: [] };
  const inCategory = (item: Row) => selectedCategory === "all" || item.category === selectedCategory;
  const trendSummary = (trend.summary as Row[]).filter(inCategory).reduce((total, item) => ({
    hits: total.hits + (Number(item.currentHitCount) || 0),
    previousHits: total.previousHits + (Number(item.previousHitCount) || 0),
    selected: total.selected + (Number(item.currentSelectedHitCount) || 0),
    previousSelected: total.previousSelected + (Number(item.previousSelectedHitCount) || 0),
  }), { hits: 0, previousHits: 0, selected: 0, previousSelected: 0 });
  const dailyTrend = (trend.daily as Row[]).filter(inCategory);
  const dailyByDate = new Map<string, { hits: number; selected: number }>();
  for (const item of dailyTrend) {
    const current = dailyByDate.get(item.date) ?? { hits: 0, selected: 0 };
    current.hits += Number(item.currentHitCount) || 0;
    current.selected += Number(item.currentSelectedHitCount) || 0;
    dailyByDate.set(item.date, current);
  }
  const trendValues = (metric: "hits" | "selected" | "unselected" | "share") => (trend.dates as string[]).map((date) => {
    const counts = dailyByDate.get(date) ?? { hits: 0, selected: 0 };
    return metric === "hits" ? counts.hits
      : metric === "selected" ? counts.selected
        : metric === "unselected" ? Math.max(0, counts.hits - counts.selected)
          : counts.hits ? (counts.selected / counts.hits) * 100 : null;
  });
  const compareLabel = activePeriod === "7d" ? "较前 7 天" : "较前 30 天";
  const periodLabel = activePeriod === "7d" ? "近 7 天" : "近 30 天";
  const trendCards = [
    {
      label: "命中文章词次", value: num(totalHits), metric: "hits" as const, current: activePeriod === "all" ? null : trendSummary.hits, previous: activePeriod === "all" ? null : trendSummary.previousHits,
      hint: activePeriod === "all" ? "正式词命中总量" : compareLabel, tone: "text-[#172b57]", color: "#4388ff", icon: <IconDoc size={21} />, iconTone: "bg-[#edf4ff] text-[#3980f6]",
    },
    {
      label: "精选命中", value: num(selectedHits), metric: "selected" as const, current: activePeriod === "all" ? null : trendSummary.selected, previous: activePeriod === "all" ? null : trendSummary.previousSelected,
      hint: activePeriod === "all" ? "命中后已精选的词次" : compareLabel, tone: "text-[#172b57]", color: "#24b58a", icon: <IconBookmark size={21} />, iconTone: "bg-[#eaf8f3] text-[#23a880]",
    },
    {
      label: "命中后精选占比", value: pct(selectedShare), metric: "share" as const, current: activePeriod === "all" ? null : trendSummary.hits ? trendSummary.selected / trendSummary.hits : 0, previous: activePeriod === "all" ? null : trendSummary.previousHits ? trendSummary.previousSelected / trendSummary.previousHits : 0,
      hint: activePeriod === "all" ? "精选命中 ÷ 全部命中" : compareLabel, tone: "text-[#172b57]", color: "#4388ff", icon: <IconChart size={21} />, iconTone: "bg-[#edf4ff] text-[#3980f6]",
    },
    {
      label: "未精选命中", value: num(unselectedHits), metric: "unselected" as const, current: activePeriod === "all" ? null : Math.max(0, trendSummary.hits - trendSummary.selected), previous: activePeriod === "all" ? null : Math.max(0, trendSummary.previousHits - trendSummary.previousSelected),
      hint: activePeriod === "all" ? "命中后当前未精选的词次" : compareLabel, tone: "text-[#172b57]", color: "#f5ad36", icon: <IconMinus size={21} />, iconTone: "bg-[#fff5e7] text-[#e9a32e]",
    },
  ];
  const categoryHitCount = (id: string) => hitTerms
    .filter((item) => id === "all" || item.category === id)
    .reduce((sum, item) => sum + termCounts(item).hits, 0);

  return <>
    <div className="mb-5 flex flex-col gap-3 rounded-panel bg-surface px-4 py-3 ring-1 ring-line xl:flex-row xl:items-center xl:gap-4">
      <div className="flex shrink-0 items-center gap-1 rounded-control bg-bg-sunk p-1" aria-label="统计时间范围">
        {PERIODS.map((item) => <Link key={item.id} to={frequencyUrl({ period: item.id, category: selectedCategory, q, kind })} aria-current={activePeriod === item.id ? "page" : undefined} className={`rounded-control px-3.5 py-2 text-[12px] font-medium transition-colors ${activePeriod === item.id ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-3 hover:bg-surface hover:text-ink"}`}>{item.label}</Link>)}
      </div>
      <div className="hidden h-8 w-px bg-line xl:block" />
      <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1" aria-label="行业分类" style={{ scrollbarWidth: "none" }}>
        <Link to={frequencyUrl({ period: activePeriod, category: "all", q, kind })} aria-current={selectedCategory === "all" ? "page" : undefined} className={`shrink-0 rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors ${selectedCategory === "all" ? "bg-accent-soft text-accent ring-1 ring-accent/20" : "text-ink-3 hover:bg-bg-sunk"}`}>全部行业 <span className="ml-1 opacity-70">{num(categoryHitCount("all"))} 次</span></Link>
        {categories.map((item) => <Link key={item.key} title={item.label} to={frequencyUrl({ period: activePeriod, category: item.key, q, kind })} aria-current={selectedCategory === item.key ? "page" : undefined} className={`shrink-0 rounded-full px-3.5 py-2 text-[12px] font-medium transition-colors ${selectedCategory === item.key ? "bg-accent-soft text-accent ring-1 ring-accent/20" : "text-ink-3 hover:bg-bg-sunk"}`}>{CATEGORY_TAB_LABELS[item.key] ?? item.label} <span className="ml-1 opacity-70">{num(categoryHitCount(item.key))} 次</span></Link>)}
      </nav>
    </div>

    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
      {trendCards.map((stat, index) => {
        const change = changeFor(stat.current, stat.previous, stat.metric === "share");
        const ChangeIcon = change.direction === "up" ? IconTrendUp : change.direction === "down" ? IconTrendDown : IconMinus;
        return <motion.section key={`${selectedCategory}-${activePeriod}-${stat.label}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, delay: index * 0.055 }} className="min-w-0 rounded-[20px] bg-surface px-5 pb-4 pt-4 shadow-[0_8px_28px_rgba(31,75,145,0.055)] ring-1 ring-line/80 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-3">
            <span className={`grid size-11 shrink-0 place-items-center rounded-[14px] ${stat.iconTone}`}>{stat.icon}</span>
            <h2 className="min-w-0 text-[13px] font-medium text-ink-3 sm:text-[14px]">{stat.label}</h2>
          </div>
          <div className="mt-3 flex min-h-[48px] items-center justify-between gap-3">
            <strong className={`num truncate text-[30px] font-semibold leading-none tracking-tight sm:text-[34px] ${stat.tone}`}>{stat.value}</strong>
            <div className="flex shrink-0 items-center gap-1.5 text-right">
              <ChangeIcon size={17} className={change.direction === "down" ? "text-[#f06c4e]" : change.direction === "up" ? "text-[#18a77e]" : "text-ink-4"} />
              <div>
                <div className={`num text-[13px] font-semibold ${change.direction === "down" ? "text-[#f06c4e]" : change.direction === "up" ? "text-[#18a77e]" : "text-ink-3"}`}>{change.text}</div>
                <div className="whitespace-nowrap text-[10px] text-ink-4">{stat.hint}</div>
              </div>
            </div>
          </div>
          <div className="mt-2 border-t border-line/60 pt-2">
            <Sparkline values={trendValues(stat.metric)} color={stat.color} label={`${stat.label}，${periodLabel}每日趋势`} percent={stat.metric === "share"} />
          </div>
        </motion.section>;
      })}
    </div>

    <Card title="全部命中正式词" right={<Badge tone="info">{num(categoryTerms.length)} 个命中词条 · 按频次排序</Badge>} className="overflow-hidden" pad={false}>
      <Form method="get" action="/admin/keyword-trends" className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3 sm:flex-nowrap sm:px-5">
        <input type="hidden" name="period" value={activePeriod} />
        <input type="hidden" name="category" value={selectedCategory} />
        <Input name="q" defaultValue={q} className="!h-10 !w-auto min-w-[180px] flex-1 !py-2 !text-[13px]" placeholder="筛选当前命中词" aria-label="筛选当前命中词" />
        <Select name="kind" defaultValue={kind} aria-label="关键词极性" className="!h-10 !w-[132px] shrink-0 !py-2 !text-[13px]"><option value="all">全部极性</option><option value="positive">正向词</option><option value="negative">反向词</option></Select>
        <Button type="submit" size="sm">筛选</Button>
      </Form>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface-2/40 px-5 py-3 text-[12px] text-ink-4">
        <span>“未精选”表示该文章当前没有入选；同一篇文章可命中多个不同词条。</span>
        <span className="flex items-center gap-3"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-ok" />精选</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-amber" />未精选</span></span>
      </div>
      {!categoryTerms.length ? <Empty>{terms.length ? "当前行业在所选时间范围内没有命中词条。" : "没有符合条件的正式词条。"}</Empty> : <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="bg-surface-2 text-[12px] text-ink-3"><tr>
            <th className="w-[34%] px-5 py-3">关键词 / 行业分类</th>
            <th className="w-[12%] px-3 py-3 text-right">总命中</th>
            <th className="w-[12%] px-3 py-3 text-right">精选命中</th>
            <th className="w-[12%] px-3 py-3 text-right">未精选</th>
            <th className="px-5 py-3">命中后精选占比</th>
          </tr></thead>
          <tbody>{categoryTerms.map((item, index) => {
            const counts = termCounts(item);
            const share = counts.hits ? counts.selected / counts.hits : 0;
            const itemCategoryKeys: string[] = item.categoryKeys ?? [item.category];
            const itemCategoryLabels = itemCategoryKeys.map((key) => categories.find((value) => value.key === key)?.label ?? "未分类");
            return <tr key={`${item.kind}-${item.normalizedTerm}-${item.category ?? "all"}`} className={`border-t border-line transition-colors hover:bg-accent-soft/10 ${index % 2 ? "bg-surface" : "bg-surface-2/15"}`}>
              <td className="px-5 py-2.5"><div className="flex flex-wrap items-center gap-2"><span title={item.capabilityName} className="font-semibold text-ink">{item.term}</span><Badge tone={item.kind === "positive" ? "ok" : "bad"}>{item.kind === "positive" ? "正向" : "反向"}</Badge>{itemCategoryLabels.slice(0, 2).map((label) => <Badge key={label} tone="info">{label}</Badge>)}{itemCategoryLabels.length > 2 && <span className="text-[11px] text-ink-4">等 {itemCategoryLabels.length} 类</span>}</div></td>
              <td className="num px-3 py-2.5 text-right font-semibold text-ink">{num(counts.hits)}</td>
              <td className="num px-3 py-2.5 text-right font-semibold text-ok">{num(counts.selected)}</td>
              <td className="num px-3 py-2.5 text-right font-semibold text-amber">{num(counts.unselected)}</td>
              <td className="px-5 py-2.5"><div className="flex items-center gap-2.5"><div className="flex h-2 min-w-[100px] flex-1 overflow-hidden rounded-full bg-bg-sunk" role="img" aria-label={`精选命中 ${counts.selected} 次，未精选命中 ${counts.unselected} 次`}><div className="h-full bg-ok transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${share * 100}%` }} /><div className="h-full bg-amber transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${(1 - share) * 100}%` }} /></div><span className="num w-12 text-right text-[11px] text-ink-3">{counts.hits ? pct(share) : "—"}</span><Link className="shrink-0 text-accent hover:underline" to={`/admin/keywords?step=samples&q=${encodeURIComponent(item.term)}`}>样本</Link></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </Card>
  </>;
}
