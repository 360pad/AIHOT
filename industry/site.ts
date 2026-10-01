// Tender Radar industry identity configuration
export const SITE = {
  name: "Tender Radar",
  subject: "招投标",
  homeTitle: "Tender Radar — 招投标情报雷达 · 每日商机精选",
  description: "自动追踪招标公告、采购需求、中标信息与行业动态，通过 AI 聚合分析，帮助企业发现项目机会与竞争情报。",
  tagline: "发现值得跟进的项目机会",
  locale: "zh-CN",
  defaultUrl: "http://localhost:3000",
  mcpPrefix: "tender_radar",
  contactEmail: null as string | null,
  footerNote: "由 AIHOT 开源框架驱动",
  icp: null as string | null,
  organization: {
    name: "Tender Radar",
    founder: null as null | { name: string; url?: string; description?: string },
  },
  crawlerName: "TenderRadarBot",
} as const;

export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  headline: ["每天都有新的项目机会，", "值得关注的只有关键几条。"] as [string, string],
  lead: `${SITE.name} 自动追踪招投标信息：抓取、归并、分析、评分，每天生成企业关注的项目情报。`,
  steps: {
    collect: "采集公开招标、采购公告、中标公告及行业信息源。",
    store: "将同一项目的多来源信息聚合，形成完整项目画像。",
    select: "模型分析项目价值、匹配程度、时间窗口与竞争情况。",
    publish: "生成每日商机日报，帮助企业快速发现重点机会。",
  },
  maker: null as null,
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。`,
} as const;

export function withSubject(noun: string): string {
  return `${SITE.subject}${noun}`;
}
