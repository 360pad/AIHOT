export const CATEGORIES = [
  { key: "smart-water", label: "智慧水利", section: "业务机会", guide: "数字孪生流域、水旱灾害防御、河湖管理、水资源调度、水利工程监测、水务信息化等项目。" },
  { key: "digital-government", label: "城市治理与数字政府", section: "业务机会", guide: "城市运行管理、市域和基层治理、综治中心、政务数据、政务服务、公共安全、数据治理，以及档案整理、档案数字化、档案加工、电子档案和数字档案馆项目。" },
  { key: "digital-mining", label: "数字矿山", section: "业务机会", guide: "智能矿山、矿山安全生产、人员车辆定位、调度指挥、地质与生产数字化项目。" },
  { key: "digital-construction", label: "数字建筑与智慧工地", section: "业务机会", guide: "智慧工地、BIM、工程项目管理、施工现场物联、质量安全和建筑数字化项目。" },
  { key: "geospatial", label: "GIS与测绘地理信息", section: "业务机会", guide: "GIS 平台、时空大数据、测绘遥感、自然资源调查、实景三维和空间信息应用，以及工程测量、矿山验收测量、土方测量、无人机/航测、水下/多波束/单波束、地形图、地下管线和竣工测量项目。" },
  { key: "general", label: "综合商机", section: "其他线索", guide: "与上述方向暂不明确匹配、但可能属于企业数字化、信息化或行业项目机会的公开线索。" },
] as const;

export const ITEM_TYPES = [
  "tender_notice",
  "procurement_intention",
  "tender_plan",
  "pre_bid_notice",
  "award_result",
  "policy_market_signal",
] as const;

export const STAGE_KEYS = ["tender", "preBid", "award"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];
export const STAGE_LABELS: Record<StageKey, string> = {
  tender: "招标采购",
  preBid: "标前信息",
  award: "中标信息",
};

export function isStageKey(value: string): value is StageKey {
  return (STAGE_KEYS as readonly string[]).includes(value);
}

export const CATEGORY_TAGS = [
  "智慧水利",
  "城市治理与数字政府",
  "数字矿山",
  "数字建筑与智慧工地",
  "GIS与测绘地理信息",
  "综合商机",
] as const;

export const TOPIC_TAGS = [
  "政府采购",
  "工程建设",
  "采购意向",
  "招标计划",
  "标前信息",
  "招标公告",
  "中标及结果",
  "项目预算",
  "竞争格局",
] as const;

export const ENTITY_TAGS = [
  "采购单位",
  "招标单位",
  "代理机构",
  "中标供应商",
  "联合体",
] as const;

export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  水利信息化: "智慧水利",
  智慧水务: "智慧水利",
  数字政府: "城市治理与数字政府",
  社会治理: "城市治理与数字政府",
  智慧城市: "城市治理与数字政府",
  档案整理: "城市治理与数字政府",
  档案数字化: "城市治理与数字政府",
  档案加工: "城市治理与数字政府",
  电子档案: "城市治理与数字政府",
  电子文件归档: "城市治理与数字政府",
  数字档案馆: "城市治理与数字政府",
  数字见证: "城市治理与数字政府",
  智慧矿山: "数字矿山",
  智能矿山: "数字矿山",
  智慧工地: "数字建筑与智慧工地",
  数字建筑: "数字建筑与智慧工地",
  测绘: "GIS与测绘地理信息",
  地理信息: "GIS与测绘地理信息",
  工程测量: "GIS与测绘地理信息",
  矿山测量: "GIS与测绘地理信息",
  矿山验收测量: "GIS与测绘地理信息",
  土方测量: "GIS与测绘地理信息",
  无人机测量: "GIS与测绘地理信息",
  航测: "GIS与测绘地理信息",
  摄影测量: "GIS与测绘地理信息",
  水下测量: "GIS与测绘地理信息",
  水深测量: "GIS与测绘地理信息",
  多波束测量: "GIS与测绘地理信息",
  单波束测量: "GIS与测绘地理信息",
  地下管线测量: "GIS与测绘地理信息",
  竣工测量: "GIS与测绘地理信息",
};

export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  procurement_intention: "综合商机",
  tender_plan: "综合商机",
  pre_bid_notice: "综合商机",
  tender_notice: "综合商机",
  award_result: "综合商机",
  policy_market_signal: "综合商机",
};

export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[] }> = {};

export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [];

export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];

export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [];
