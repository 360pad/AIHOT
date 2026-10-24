import { sql } from "../db.ts";
import { COLLECTION_SCHEDULE_KEY, scheduleOf } from "../sources/schedule.ts";

export async function loadCollectionSummary() {
  const [[setting], [source]] = await Promise.all([
    sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${COLLECTION_SCHEDULE_KEY}`,
    sql<{ at: Date | null }[]>`SELECT max(last_ok_at) AS at FROM sources WHERE enabled AND kind <> 'external'`,
  ]);
  const schedule = scheduleOf(setting?.value);
  return {
    times: schedule.times,
    timezone: schedule.timezone,
    lastSourceSuccessAt: source?.at?.toISOString() ?? null,
  };
}
