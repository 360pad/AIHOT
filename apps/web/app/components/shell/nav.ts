// Site navigation, one place for the desktop sidebar, the mobile tab bar and the mobile "更多" page.
import { withSubject } from "@aihot/industry/site";
import { FEATURES } from "@aihot/industry/features";
import type { ReactNode } from "react";
import {
  IconApps, IconBolt, IconBookmark, IconChart, IconCheck, IconClock, IconDoc, IconFlame, IconGrid, IconHistory, IconList, IconMessage,
} from "../icons";
import type { StageKey } from "@aihot/contracts/taxonomy";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

export const HOME_STAGE_NAV: Array<{ key: StageKey; label: string; icon: NavItem["icon"] }> = [
  { key: "tender", label: "招标采购", icon: IconList },
  { key: "preBid", label: "标前信息", icon: IconClock },
  { key: "award", label: "中标信息", icon: IconCheck },
];

export const SIDEBAR: Array<{ title: string; items: NavItem[]; featuredStages?: boolean }> = [
  {
    title: "商机",
    featuredStages: true,
    items: [
      { to: "/", label: "精选", icon: IconBolt, end: true },
      { to: "/all", label: `全部${withSubject("动态")}`, icon: IconList },
      { to: "/daily", label: withSubject("日报"), icon: IconDoc },
      { to: "/starred", label: "收藏", icon: IconBookmark },
    ],
  },
  {
    title: "行业资讯",
    items: [
      { to: "/industry", label: "行业动态", icon: IconBolt },
      { to: "/hot", label: "热点榜", icon: IconFlame },
    ],
  },
  {
    title: "专题",
    items: [{ to: "/topics", label: "主题", icon: IconGrid }],
  },
  // The optional AI-only modules (industry/features.ts).
  ...(FEATURES.leaderboard || FEATURES.codexResetMonitor
    ? [
        {
          title: "模型",
          items: [
            ...(FEATURES.leaderboard ? [{ to: "/leaderboard", label: "模型榜", icon: IconChart }] : []),
            ...(FEATURES.codexResetMonitor ? [{ to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory }] : []),
          ],
        },
      ]
    : []),
  {
    title: "更多",
    items: [{ to: "/feedback", label: "反馈", icon: IconMessage }],
  },
];

export const TABBAR: NavItem[] = [
  { to: "/", label: "精选", icon: IconBolt, end: true },
  { to: "/all", label: "全部", icon: IconList },
  { to: "/daily", label: "日报", icon: IconDoc },
  { to: "/more", label: "更多", icon: IconApps, changelog: true },
];

/** Pages reached from the mobile "更多" tab keep that tab highlighted. */
export const MORE_PATHS = ["/more", "/hot", "/topics", "/starred", "/industry", "/leaderboard", "/codex-reset", "/feedback", "/terms", "/privacy"];

export function tabIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/more") return MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
