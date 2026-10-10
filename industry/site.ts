export const SITE = {
  name: "Tender Radar",
  subject: "招投标商机",
  homeTitle: "Tender Radar — 数字化项目商机雷达",
  description: "聚合公开采购意向、招标计划、招标公告与结果公示，借助 AI 识别智慧水利、数字政府、数字矿山、数字建筑和 GIS 测绘项目机会。",
  tagline: "从公开项目线索中发现值得跟进的数字化商机",
  locale: "zh-CN",
  defaultUrl: "http://localhost:3000",
  mcpPrefix: "tender_radar",
  contactEmail: null as string | null,
  footerNote: "基于公开信息聚合，仅供商机研判参考",
  icp: null as string | null,
  organization: {
    name: "Tender Radar",
    founder: null as null | { name: string; url?: string; description?: string },
  },
  crawlerName: "TenderRadarBot",
} as const;

export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  headline: ["每天都有新的公开项目，", "真正匹配业务的需要尽早发现。"] as [string, string],
  lead: `${SITE.name} 聚合公开项目线索，按业务方向和项目阶段研判，帮助团队优先关注标前和招标中的数字化机会。`,
  steps: {
    collect: "采集公开交易平台中的招标公告、结果公示和政策项目线索。",
    store: "将同一项目的公告、澄清和结果归并，保留其阶段演进。",
    select: "模型按业务匹配、项目阶段、规模线索和可跟进性筛选重点机会。",
    publish: "生成按业务方向归类的商机日报，方便团队优先研判。",
  },
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。`,
} as const;

export function withSubject(noun: string): string {
  return `${SITE.subject}${noun}`;
}
