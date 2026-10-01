// Tender Radar industry taxonomy
// 招投标情报行业分类、标签、主体词典

export const CATEGORIES = [
  { key: "tender-notice", label: "招标公告", section: "项目机会", guide: "公开招标、采购公告、资格预审和项目需求发布" },
  { key: "award-notice", label: "中标公告", section: "项目动态", guide: "中标结果、成交公告、供应商信息和竞争格局" },
  { key: "procurement", label: "采购需求", section: "采购情报", guide: "政府采购、企业采购、技术需求和预算信息" },
  { key: "industry", label: "行业动态", section: "行业分析", guide: "政策、产业趋势、区域市场和行业变化" },
  { key: "competitor", label: "竞争情报", section: "竞争分析", guide: "竞争企业、市场份额和投标动态" },
] as const;

export const ITEM_TYPES = [
  "tender_notice",
  "award_notice",
  "procurement_demand",
  "policy_update",
  "competitor_signal",
] as const;

export const CATEGORY_TAGS = [
  "招标公告",
  "中标公告",
  "采购需求",
  "政策监管",
  "行业动态",
  "竞争情报",
] as const;

export const TOPIC_TAGS = [
  "政府采购",
  "企业采购",
  "数字化项目",
  "人工智能",
  "信息化建设",
  "区域市场",
  "重点客户",
  "供应商竞争",
] as const;

export const ENTITY_TAGS = [
  "招标单位",
  "采购单位",
  "代理机构",
  "供应商",
  "竞争企业",
] as const;

export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  招标: "招标公告",
  投标: "招标公告",
  中标: "中标公告",
  成交: "中标公告",
  采购: "采购需求",
  政府采购: "采购需求",
  竞争对手: "竞争情报",
};

export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  tender_notice: "招标公告",
  award_notice: "中标公告",
  procurement_demand: "采购需求",
  policy_update: "行业动态",
  competitor_signal: "竞争情报",
};

export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [];
