export type ViewKey = "today" | "recent" | "history" | "all";

export interface IndustryArticle {
  id: string;
  url: string;
  title: string;
  source: string;
  author: string;
  kind: string;
  category: string;
  publishedAt: string;
  discoveredAt: string;
  score: number | null;
  summary: string;
  topics: string[];
  sections: Array<{ heading?: string; text?: string; quote?: string }>;
}

export const INDUSTRY_ARTICLES: IndustryArticle[] = [
  {
    id: "geology-model",
    url: "https://mp.weixin.qq.com/s/YUlQA-PypBA9pnLWSD0NsQ",
    title: "GemPy 隐式地质建模方法及其在地下空间研究中的实践",
    source: "地质",
    author: "GemPy 开源社区",
    kind: "学术论文",
    category: "地质与矿业",
    publishedAt: "2019.01.02",
    discoveredAt: "2026-10-13 17:00",
    score: 86,
    summary: "本文介绍开源隐式地质建模工具 GemPy 的核心原理与建模流程，并讨论其在复杂地质条件下的应用前景。",
    topics: ["隐式建模", "三维地质", "地下空间"],
    sections: [
      { heading: "方法概览", text: "GemPy 是一个基于隐式表面表示的开源地质建模工具，通过数学函数描述地质界面，在三维空间中重建地质结构。相比传统的显式建模方法，它能够较好地处理地质体之间的连续性与不确定性。" },
      { quote: "隐式建模通过连续函数表达地质界面，能够在数据稀疏的情况下保持地质结构的合理性，并提供不确定性分析的框架。" },
      { heading: "核心特点对比", text: "适合复杂地质体、地下空间研究和矿产勘查。实施时需要准备钻孔、剖面或测点资料，并对建模假设和误差范围进行记录。" },
    ],
  },
  {
    id: "supermap-3d",
    url: "https://www.supermap.com/news/space-intelligence-3d-gis",
    title: "超图软件发布空间智能与三维 GIS 应用新进展",
    source: "超图软件",
    author: "超图技术团队",
    kind: "企业动向",
    category: "地质与矿业",
    publishedAt: "2026.10.13",
    discoveredAt: "2026-10-13 14:20",
    score: null,
    summary: "围绕空间智能、实景三维与行业场景融合，介绍新一代 GIS 平台的能力变化和典型应用方向。",
    topics: ["GIS", "三维平台", "同行动态"],
    sections: [
      { heading: "内容摘要", text: "文章重点介绍三维数据组织、空间分析和行业应用接口的更新，适合关注 GIS 平台能力和项目交付方式的团队阅读。" },
      { heading: "可借鉴信息", text: "可重点关注平台对多源空间数据的处理方式、三维服务发布能力以及面向政务和自然资源场景的实施边界。" },
    ],
  },
  {
    id: "smart-water-research",
    url: "https://example.com/research/digital-twin-water",
    title: "数字孪生水利工程中的多源数据融合与模型校准",
    source: "水利研究",
    author: "行业研究作者",
    kind: "技术研究",
    category: "水利水务",
    publishedAt: "2026.10.12",
    discoveredAt: "2026-10-13 08:00",
    score: 78,
    summary: "从数据接入、模型校准和运行反馈三个环节梳理数字孪生水利项目的实施重点和常见风险。",
    topics: ["数字孪生", "水利", "数据融合"],
    sections: [
      { heading: "研究重点", text: "研究将实时监测数据、历史运行数据与水动力模型结合，提出分层校准和异常数据复核的工作流程。" },
      { heading: "实施边界", text: "结论依赖于传感器质量、历史样本完整度和模型假设，不能直接替代项目现场的工程论证。" },
    ],
  },
  {
    id: "longruan-mining",
    url: "https://www.longruan.com/news/digital-mine",
    title: "龙软科技：透明地质与数字矿山平台的业务融合实践",
    source: "龙软科技",
    author: "龙软科技",
    kind: "产品与软件",
    category: "地质与矿业",
    publishedAt: "2026.10.09",
    discoveredAt: "2026-10-13 08:00",
    score: 72,
    summary: "梳理透明地质、生产调度和矿山安全场景的产品组合，区分厂商披露内容与可核验的项目事实。",
    topics: ["透明地质", "数字矿山", "产品"],
    sections: [
      { heading: "资料摘要", text: "文章从平台架构和应用模块切入，介绍地质模型、生产数据与安全管理之间的协同方式。" },
      { heading: "阅读提示", text: "产品效果和项目适用性仍需结合客户场景、交付范围和正式项目资料进一步核验。" },
    ],
  },
];

export function filterIndustryArticles(articles: IndustryArticle[], view: ViewKey, category: string, query: string): IndustryArticle[] {
  const needle = query.trim().toLowerCase();
  return articles.filter((article) => {
    const categoryMatch = category === "all" || (category === "geology" ? article.category === "地质与矿业" : category === "water" ? article.category === "水利水务" : category === "government" ? article.category.includes("政府") : category === "gis" ? article.topics.includes("GIS") : article.category.includes("建筑"));
    const viewMatch = view === "all" || view === "recent" || (view === "today" ? article.discoveredAt.startsWith("2026-10-13") : Number(article.publishedAt.slice(0, 4)) < 2026);
    const searchMatch = !needle || [article.title, article.source, article.author, article.summary, ...article.topics].join(" ").toLowerCase().includes(needle);
    return categoryMatch && viewMatch && searchMatch;
  });
}

export function markdownForArticle(article: IndustryArticle): string {
  const lines = [
    `# ${article.title}`,
    "",
    `- 来源：${article.source}`,
    `- 作者：${article.author}`,
    `- 原文发布：${article.publishedAt}`,
    `- 系统收录：${article.discoveredAt}`,
    `- 内容类型：${article.kind}`,
    "",
    "## 摘要",
    "",
    article.summary,
    "",
  ];
  for (const section of article.sections) {
    if (section.heading) lines.push(`## ${section.heading}`, "");
    if (section.text) lines.push(section.text, "");
    if (section.quote) lines.push(`> ${section.quote}`, "");
  }
  return `${lines.join("\n").trim()}\n`;
}
