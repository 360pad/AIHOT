import { addDays, beijingDate } from "@aihot/contracts/time";

export const COLLECTION_SCHEDULE_KEY = "collection.tender_schedule";
export const DEFAULT_COLLECTION_TIMES = ["08:00", "17:00"] as const;

export const DEFAULT_HOLIDAY_CALENDAR = {
  year: 2026,
  holidays: [
    "2026-01-01", "2026-01-02", "2026-01-03",
    "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
    "2026-04-04", "2026-04-05", "2026-04-06",
    "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
    "2026-06-19", "2026-06-20", "2026-06-21",
    "2026-09-25", "2026-09-26", "2026-09-27",
    "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
  ],
  workdays: ["2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20", "2026-10-10"],
} as const;

export interface HolidayCalendar {
  year: number;
  holidays: string[];
  workdays: string[];
}

export interface CollectionSchedule {
  times: string[];
  timezone: "Asia/Shanghai";
  skipPublicHolidays: boolean;
  calendar: HolidayCalendar;
}

export function normalizeCollectionTimes(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : DEFAULT_COLLECTION_TIMES;
  const times = [...new Set(raw.filter((v): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)))].sort();
  if (times.length === 0) throw new Error("至少保留一个有效采集时间");
  if (times.length > 3) throw new Error("每天最多设置 3 个采集时间");
  return times;
}

export function scheduleOf(value: unknown): CollectionSchedule {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawCalendar = record.calendar && typeof record.calendar === "object" ? record.calendar as Record<string, unknown> : {};
  const year = Number.isInteger(rawCalendar.year) && Number(rawCalendar.year) >= 2025 && Number(rawCalendar.year) <= 2100
    ? Number(rawCalendar.year)
    : DEFAULT_HOLIDAY_CALENDAR.year;
  const dates = (input: unknown, defaults: readonly string[]) => [...new Set(
    (Array.isArray(input) ? input : defaults).filter((v): v is string => typeof v === "string" && validCalendarDate(v, year)),
  )].sort();
  return {
    times: normalizeCollectionTimes(record.times),
    timezone: "Asia/Shanghai",
    skipPublicHolidays: record.skipPublicHolidays !== false,
    calendar: {
      year,
      holidays: dates(rawCalendar.holidays, year === DEFAULT_HOLIDAY_CALENDAR.year ? DEFAULT_HOLIDAY_CALENDAR.holidays : []),
      workdays: dates(rawCalendar.workdays, year === DEFAULT_HOLIDAY_CALENDAR.year ? DEFAULT_HOLIDAY_CALENDAR.workdays : []),
    },
  };
}

function validCalendarDate(value: string, year: number): boolean {
  if (!new RegExp(`^${year}-\\d{2}-\\d{2}$`).test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCollectionDay(date: string, calendar?: CollectionSchedule): boolean {
  if (!calendar?.skipPublicHolidays || calendar.calendar.year !== Number(date.slice(0, 4))) return true;
  if (calendar.calendar.workdays.includes(date)) return true;
  return !calendar.calendar.holidays.includes(date);
}

export function normalizeCalendarDates(input: unknown, year: number): string[] {
  if (!Number.isInteger(year) || year < 2025 || year > 2100) throw new Error("日历年份需在 2025–2100 之间");
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/\r?\n/) : [];
  const dates = [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
  if (dates.some((date) => !validCalendarDate(date, year))) throw new Error(`日期需使用 ${year}-MM-DD 格式，并且必须是有效日期`);
  if (dates.length > 100) throw new Error("每类日期最多设置 100 个");
  return dates.sort();
}

export function nextScheduledAt(now: Date, times: string[], calendar?: CollectionSchedule): Date {
  const normalized = normalizeCollectionTimes(times);
  let date = beijingDate(now);
  for (let day = 0; day <= 370; day += 1) {
    if (isCollectionDay(date, calendar)) {
      for (const time of normalized) {
        const candidate = new Date(Date.parse(`${date}T${time}:00+08:00`));
        if (candidate.getTime() > now.getTime()) return candidate;
      }
    }
    date = addDays(date, 1);
  }
  throw new Error("找不到下一个采集时段");
}

export function previousScheduledAt(now: Date, times: string[], calendar?: CollectionSchedule): Date {
  const normalized = normalizeCollectionTimes(times);
  let date = beijingDate(now);
  for (let day = 0; day <= 370; day += 1) {
    if (isCollectionDay(date, calendar)) {
      for (let i = normalized.length - 1; i >= 0; i -= 1) {
        const candidate = new Date(Date.parse(`${date}T${normalized[i]}:00+08:00`));
        if (candidate.getTime() <= now.getTime()) return candidate;
      }
    }
    date = addDays(date, -1);
  }
  throw new Error("找不到上一个采集时段");
}

export function scheduleWindow(now: Date, times: string[], windowMinutes = 2, calendar?: CollectionSchedule): { active: boolean; next: Date } {
  const next = nextScheduledAt(now, times, calendar);
  const previous = previousScheduledAt(now, times, calendar);
  const active = now.getTime() - previous.getTime() < windowMinutes * 60_000;
  return { active, next };
}
