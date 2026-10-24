import { sql } from "../db.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { loadCollectionSchedule } from "./schedule-config.ts";
import { scheduleWindow, nextScheduledAt } from "./schedule.ts";
import { planXShards, shardHandle, shardQuery, SHARDABLE_SQL } from "./x.ts";
import type { SourceRow } from "./types.ts";

export const SCHEDULED_SOURCE_KINDS = new Set(["rss", "web_list", "json_list"]);

const X_SHARD_MINUTES: Record<string, number> = { editorial: 30, hot_signal: 60 };
export const shardMinutes = (mode: string) => X_SHARD_MINUTES[mode] ?? 60;

const sharded = () => sql`kind = 'x_search' AND config->>'query' ~* ${SHARDABLE_SQL} AND coalesce(config->>'searchType', 'Latest') = 'Latest' AND cursor->>'lastTweetId' IS NOT NULL`;

async function scheduleXShards(): Promise<number> {
  const rows = await sql<Array<Pick<SourceRow, "id" | "kind" | "config" | "cursor" | "participation_mode"> & { due: boolean }>>`
    SELECT id, kind, config, cursor, participation_mode, (next_fetch_at IS NULL OR next_fetch_at <= now()) AS due
    FROM sources WHERE enabled AND ${sharded()}`;
  const due = new Set(rows.filter((row) => row.due).map((row) => row.id));
  let enqueued = 0;
  for (const shard of planXShards(rows)) {
    if (!shard.sourceIds.some((id) => due.has(id))) continue;
    await enqueue(QUEUES.fetchXShard, { key: shard.key, sourceIds: shard.sourceIds }, { singletonKey: shard.key });
    await sql`UPDATE sources SET next_fetch_at = now() + interval '10 minutes' WHERE id IN ${sql(shard.sourceIds)}`;
    enqueued += 1;
  }
  return enqueued;
}

/** Enqueues sources whose stored next-fetch time is due; the worker runs this every minute. */
export async function scheduleDueSources(limit = Number(process.env.FETCH_SCHEDULE_BATCH || 40)): Promise<{ enqueued: number; shards: number }> {
  const kinds: string[] = (process.env.COLLECT_KINDS || "rss,web_list,json_list,x_search").split(",");
  const schedule = await loadCollectionSchedule();
  const window = scheduleWindow(new Date(), schedule.times, 60, schedule);
  const skipJina = process.env.COLLECT_SKIP_JINA === "true";
  const rows = await sql<{ id: string; kind: string }[]>`
    SELECT id, kind FROM sources
    WHERE enabled AND kind IN ${sql(kinds)} AND (next_fetch_at IS NULL OR next_fetch_at <= now()) AND NOT (${sharded()})
      ${skipJina ? sql`AND config::text NOT LIKE '%r.jina.ai%'` : sql``}
    ORDER BY next_fetch_at NULLS FIRST LIMIT ${limit}`;
  let enqueued = 0;
  for (const row of rows) {
    if (SCHEDULED_SOURCE_KINDS.has(row.kind) && !window.active) {
      await sql`UPDATE sources SET next_fetch_at = ${window.next} WHERE id = ${row.id}`;
      continue;
    }
    await enqueue(QUEUES.fetchSource, { sourceId: row.id }, { singletonKey: row.id });
    await sql`UPDATE sources SET next_fetch_at = now() + interval '10 minutes' WHERE id = ${row.id}`;
    enqueued += 1;
  }
  const shards = kinds.includes("x_search") ? await scheduleXShards() : 0;
  return { enqueued, shards };
}

export async function fetchScheduledSourcesNow(limit = Number(process.env.FETCH_SCHEDULE_BATCH || 40)): Promise<{ enqueued: number; startedAt: string }> {
  const startedAt = new Date().toISOString();
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM sources
    WHERE enabled AND kind IN ('rss', 'web_list', 'json_list')
    ORDER BY last_fetch_at NULLS FIRST, name
    LIMIT ${limit}`;
  for (const row of rows) {
    await enqueue(QUEUES.fetchSource, { sourceId: row.id, force: true }, { singletonKey: row.id });
    await sql`UPDATE sources SET next_fetch_at = now() + interval '10 minutes' WHERE id = ${row.id}`;
  }
  return { enqueued: rows.length, startedAt };
}

/** Daily: adapt each source's interval to its recent output (active 15 min … quiet 120 min). */
export async function adaptIntervals(): Promise<{ updated: number }> {
  const rows = await sql<Array<Pick<SourceRow, "id" | "participation_mode" | "kind" | "config" | "cursor"> & { paid_listing: boolean; per_day: number }>>`
    SELECT s.id, s.participation_mode, s.kind, s.config, s.cursor, coalesce(s.config->>'url', '') LIKE 'https://r.jina.ai/%' AS paid_listing,
      (SELECT count(*) FROM articles a WHERE a.source_id = s.id AND a.discovered_at > now() - interval '7 days' AND NOT a.backfill) / 7.0 AS per_day
    FROM sources s WHERE s.enabled AND s.kind IN ('rss', 'web_list', 'json_list', 'x_search')`;
  const updates: Array<{ id: string; interval: number }> = [];
  for (const row of rows) {
    if (SCHEDULED_SOURCE_KINDS.has(row.kind)) continue;
    const perDay = Number(row.per_day);
    const max = row.participation_mode === "hot_signal" ? 180 : row.kind === "x_search" || row.paid_listing ? 120 : 60;
    const min = row.paid_listing ? 60 : 15;
    const interval = shardHandle(row) ? shardMinutes(row.participation_mode) : perDay <= 0.15 ? max : Math.round(Math.min(max, Math.max(min, (24 * 60) / (perDay * 3))));
    updates.push({ id: row.id, interval });
  }
  if (!updates.length) return { updated: 0 };
  const result = await sql`
    UPDATE sources AS s SET interval_minutes = changes.interval_minutes
    FROM unnest(${updates.map((item) => item.id)}::text[], ${updates.map((item) => item.interval)}::int[])
      AS changes(id, interval_minutes)
    WHERE s.id = changes.id AND s.interval_minutes <> changes.interval_minutes`;
  return { updated: result.count };
}
