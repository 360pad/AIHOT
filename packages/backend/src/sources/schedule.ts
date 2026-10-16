import { addDays, beijingDate } from "@aihot/contracts/time";

export const COLLECTION_SCHEDULE_KEY = "collection.tender_schedule";
export const DEFAULT_COLLECTION_TIMES = ["08:00", "17:00"] as const;

export interface CollectionSchedule {
  times: string[];
  timezone: "Asia/Shanghai";
}

export function normalizeCollectionTimes(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : DEFAULT_COLLECTION_TIMES;
  const times = [...new Set(raw.filter((v): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)))].sort();
  if (times.length === 0) throw new Error("至少保留一个有效采集时间");
  if (times.length > 4) throw new Error("每天最多设置 4 个采集时间");
  return times;
}

export function scheduleOf(value: unknown): CollectionSchedule {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { times: normalizeCollectionTimes(record.times), timezone: "Asia/Shanghai" };
}

export function nextScheduledAt(now: Date, times: string[]): Date {
  const normalized = normalizeCollectionTimes(times);
  const date = beijingDate(now);
  for (const time of normalized) {
    const candidate = new Date(Date.parse(`${date}T${time}:00+08:00`));
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  const tomorrow = addDays(date, 1);
  return new Date(Date.parse(`${tomorrow}T${normalized[0]}:00+08:00`));
}

export function previousScheduledAt(now: Date, times: string[]): Date {
  const normalized = normalizeCollectionTimes(times);
  const date = beijingDate(now);
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const candidate = new Date(Date.parse(`${date}T${normalized[i]}:00+08:00`));
    if (candidate.getTime() <= now.getTime()) return candidate;
  }
  const yesterday = addDays(date, -1);
  return new Date(Date.parse(`${yesterday}T${normalized.at(-1)}:00+08:00`));
}

export function scheduleWindow(now: Date, times: string[], windowMinutes = 2): { active: boolean; next: Date } {
  const next = nextScheduledAt(now, times);
  const previous = previousScheduledAt(now, times);
  const active = now.getTime() - previous.getTime() < windowMinutes * 60_000;
  return { active, next };
}
