import { sql } from "../db.ts";
import { COLLECTION_SCHEDULE_KEY, scheduleOf, type CollectionSchedule } from "./schedule.ts";

export async function loadCollectionSchedule(): Promise<CollectionSchedule> {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = ${COLLECTION_SCHEDULE_KEY}`;
  return scheduleOf(row?.value);
}
