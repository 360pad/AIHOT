// One report in a feed. Desktop (≥ 961px): a white card beside the time rail. Mobile: a compact row
// with a divider, the reason in a grey box. One markup, two presentations, as on the original site.
import { memo } from "react";
import { Link } from "react-router";
import { IntentLink } from "../../components/ui/IntentLink";
import type { GroupInfo, FeedItemSummary, TimelineFilters } from "@aihot/contracts/site";
import { CATEGORY_LABELS, STAGE_LABELS } from "@aihot/contracts/taxonomy";
import { IconChevronRight, IconDoc, IconGrid } from "../../components/icons";
import { SelectedBadge } from "../../components/ui/Badge";
import { ScoreLabel } from "../../components/ui/Score";
import { MediaThumbs, SourceLine, StarButton } from "./parts";
import { GroupDevelopments, GroupSources, LatestDevelopment } from "./ReadingGroup";
import { QuotedLine } from "../item/QuotedPost";

export interface FeedItemProps {
  item: FeedItemSummary;
  group?: GroupInfo | null;
  filters?: TimelineFilters;
  read?: boolean;
  onOpen?: (id: string) => void;
  /** Show category and tags under the text (全部动态, topics, search). */
  showTags?: boolean;
  variant?: "default" | "radar";
}

export const FeedItem = memo(function FeedItem({ item, group, filters, read = false, onOpen, showTags = false, variant = "default" }: FeedItemProps) {
  const isX = item.channel === "x" && !!item.x;
  const open = () => onOpen?.(item.id);
  const showSources = !!group && (group.additionalSourceCount > 0 || (group.developmentCount <= 1 && group.reportCount > 1));
  const showDevelopments = !!group?.story && group.developmentCount > 1;
  const tags = showTags ? item.tags.slice(0, 3) : [];

  if (variant === "radar") {
    return <RadarFeedItem item={item} filters={filters} read={read} onOpen={onOpen} />;
  }

  return (
    <article className="relative min-w-0 lg:card lg:card-hover lg:px-[18px] lg:pb-[14px] lg:pt-[15px]" data-item-id={item.id}>
      <header className="flex min-h-[18px] items-center gap-2 text-[12.5px] leading-[18px] text-ink-4">
        <SourceLine item={item} className="text-ink-4" />
        {item.selected && (
          <span className="hidden lg:inline-flex">
            <SelectedBadge />
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <span className="hidden lg:inline-flex">
            <ScoreLabel score={item.score} />
          </span>
          <span className="lg:hidden">
            <ScoreLabel score={item.score} compact />
          </span>
          <span className="-my-1 hidden lg:inline-flex">
            <StarButton item={item} />
          </span>
        </span>
      </header>

      {isX ? (
        <p className={`mt-2 whitespace-pre-line text-[15px] leading-[1.75] line-clamp-5 lg:line-clamp-4 ${read ? "text-ink-4" : "text-ink"}`}>
          <IntentLink to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
            {item.summary ?? item.title}
          </IntentLink>
        </p>
      ) : (
        <>
          <h3 className={`mt-2 line-clamp-2 text-[17px] font-bold leading-[1.55] lg:line-clamp-none lg:font-[650] ${read ? "text-ink-4" : "text-ink"}`}>
            <IntentLink to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
              {item.title}
            </IntentLink>
          </h3>
          {item.summary && <p className="mt-1.5 line-clamp-2 text-[14.5px] leading-[1.75] text-ink-3 lg:mt-2 lg:line-clamp-3 lg:text-[15px]">{item.summary}</p>}
        </>
      )}

      {isX && item.x!.media.length > 0 && <MediaThumbs media={item.x!.media} className="mt-2.5" />}
      {isX && item.x!.quoted?.text && <QuotedLine quoted={item.x!.quoted} />}

      {(tags.length > 0 || (showTags && item.category)) && (
        <div className="relative z-10 mt-2 hidden flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-4 lg:flex">
          {showTags && item.category && (
            <Link to={`/all?category=${item.category}`} className="hover:text-accent">
              {CATEGORY_LABELS[item.category]}
            </Link>
          )}
          {tags.map((t) => (
            <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} className="hover:text-accent">
              #{t}
            </Link>
          ))}
        </div>
      )}

      {group && <LatestDevelopment group={group} />}
      {(showSources || showDevelopments) && (
        <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
          {showSources && <GroupSources group={group!} filters={filters} parentId={item.id} />}
          {showDevelopments && <GroupDevelopments group={{ ...group!, story: group!.story! }} filters={filters} parentId={item.id} />}
        </div>
      )}

      {item.reason && (
        <div className="mt-2.5 rounded-control bg-bg-sunk px-3 py-2 dark:bg-bg-muted/60 lg:mt-3 lg:rounded-none lg:border-t lg:border-line-soft lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-3 lg:dark:bg-transparent">
          <p className="line-clamp-2 text-[13px] leading-[1.65] text-ink-3 lg:line-clamp-none lg:leading-[1.75] lg:text-note">推荐理由：{item.reason}</p>
        </div>
      )}
    </article>
  );
});

function budgetOf(item: FeedItemSummary) {
  const text = `${item.title} ${item.summary ?? ""}`;
  const match = text.match(/(?:预算(?:金额)?|最高投标限价|最高限价|投资)[：:]?\s*(?:人民币)?\s*([\d,.]+)\s*(万元|亿元|元)/);
  if (!match) return "待核实";
  const raw = Number((match[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(raw)) return "待核实";
  if (match[2] === "元" && raw >= 100000) {
    return `${raw / 10000 >= 1000 ? (raw / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : (raw / 10000).toFixed(2)}万元`;
  }
  const formatted = raw.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return `${formatted}${match[2]}`;
}

function deadlineOf(item: FeedItemSummary) {
  const text = `${item.title} ${item.summary ?? ""}`;
  const match = text.match(/(?:截止|开标|响应文件提交)[^，。；;]{0,18}?((?:20\d{2}年)?\d{1,2}月\d{1,2}日(?:[\d:：点时分]{0,12})?)/);
  return match?.[1]?.replace(/：/g, ":") ?? "待核实";
}

function RadarFeedItem({ item, filters, read, onOpen }: Pick<FeedItemProps, "item" | "filters" | "read" | "onOpen">) {
  const open = () => onOpen?.(item.id);
  const category = item.category ? CATEGORY_LABELS[item.category] : "综合商机";
  const stage = filters?.stage === "tender" || !filters?.stage ? "公开招标" : STAGE_LABELS[filters.stage];
  const scope = item.reason?.replace(/^推荐理由：?\s*/, "") || item.summary || "项目范围与采购要求待核实。";
  return (
    <article className="radar-feed-card" data-item-id={item.id}>
      <div className="radar-item-main">
        <div className="radar-item-title-row">
          <h3 className={`radar-item-title ${read ? "is-read" : ""}`}>
            <IntentLink to={`/items/${item.id}`} onClick={open}>{item.title}</IntentLink>
          </h3>
          <ScoreLabel score={item.score} />
        </div>
        <div className="radar-item-meta">
          <span><IconDoc size={15} />{item.source.name}</span>
          <i />
          <span><IconGrid size={15} />{category}</span>
          <i />
          <span><IconChevronRight size={15} />{stage}</span>
        </div>
        <p className="radar-item-summary">项目范围：{scope}</p>
      </div>
      <div className="radar-item-metric">
        <span>预算金额</span>
        <strong>{budgetOf(item)}</strong>
      </div>
      <div className="radar-item-metric">
        <span>截止时间</span>
        <strong>{deadlineOf(item)}</strong>
      </div>
    </article>
  );
}
