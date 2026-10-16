export type SourceProcessingMode = "collect_only" | "collect_and_analyze";

/** 公众号默认只保存采集结果；其他信源继续走原有 AI 分析流程。 */
export function processingModeOf(kind: string, config: Record<string, unknown> | null | undefined): SourceProcessingMode {
  const aihot = config?._aihot;
  const configured = aihot && typeof aihot === "object" ? (aihot as Record<string, unknown>).processingMode : null;
  if (kind === "mp_account" && configured !== "collect_and_analyze") return "collect_only";
  return "collect_and_analyze";
}

export function withProcessingMode(config: Record<string, unknown>, mode: SourceProcessingMode): Record<string, unknown> {
  const current = config._aihot && typeof config._aihot === "object" ? config._aihot as Record<string, unknown> : {};
  return { ...config, _aihot: { ...current, processingMode: mode } };
}
