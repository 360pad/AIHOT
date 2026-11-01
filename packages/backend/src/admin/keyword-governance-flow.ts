import { sql } from "../db.ts";
import { collectionBatchOutcomeStats } from "../content/collection-batch.ts";
import { keywordBatchFlowCandidateTerms, keywordBatchFlowCounts, keywordBatchFlowDocuments, type KeywordFlowDrillMetric } from "./keyword-governance.ts";

type BatchSlot = {
  slot: string;
  sourceCount: number;
  foundCount: number;
  newCount: number;
  failedCount: number;
  runningCount: number;
};

async function latestLowScoreBulkReview() {
  const [action] = await sql<any[]>`
    SELECT created_at AS "createdAt",
           coalesce((after->>'days')::int, 1) AS days,
           coalesce((after->>'markedCount')::int, 0) AS "markedCount"
      FROM audit_log
     WHERE action = 'business.matching.feedback.bulk' AND subject = 'low-score-review'
     ORDER BY id DESC LIMIT 1`;
  if (!action) return null;
  if (Number(action.markedCount) === 0) {
    return { createdAt: action.createdAt, days: Number(action.days), markedCount: 0, databaseCount: 0,
      labels: { relevant: 0, irrelevant: 0 }, batches: [] };
  }

  const rows = await sql<any[]>`
    WITH candidate_batches AS (
      SELECT fb.created_at
        FROM business_matching_feedback fb
       WHERE fb.note LIKE '低分批量判读：%'
         AND fb.created_at <= ${action.createdAt}
         AND fb.created_at >= ${action.createdAt} - interval '1 minute'
       GROUP BY fb.created_at
      HAVING count(*) = ${Number(action.markedCount)}
       ORDER BY fb.created_at DESC LIMIT 1
    )
    SELECT coalesce(c.batch_slot, '未关联采集批次') AS slot, fb.label, count(*)::int AS count
      FROM candidate_batches batch
      JOIN business_matching_feedback fb ON fb.created_at = batch.created_at
      LEFT JOIN collection_batch_articles c ON c.article_id = fb.article_id
     WHERE fb.note LIKE '低分批量判读：%'
     GROUP BY c.batch_slot, fb.label
     ORDER BY c.batch_slot, fb.label`;
  const labels = { relevant: 0, irrelevant: 0 };
  const batchCounts = new Map<string, number>();
  for (const row of rows) {
    const count = Number(row.count ?? 0);
    if (row.label in labels) labels[row.label as keyof typeof labels] += count;
    batchCounts.set(row.slot, (batchCounts.get(row.slot) ?? 0) + count);
  }
  return {
    createdAt: action.createdAt,
    days: Number(action.days),
    markedCount: Number(action.markedCount),
    databaseCount: rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
    labels,
    batches: [...batchCounts].map(([slot, count]) => ({ slot, count })),
  };
}

function slotWindow(slot: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/.test(slot)) return null;
  const start = new Date(`${slot}:00:00+08:00`);
  if (!Number.isFinite(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 60 * 60_000) };
}

async function listSlots(): Promise<BatchSlot[]> {
  const rows = await sql<BatchSlot[]>`
    SELECT to_char(date_trunc('hour', fr.started_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"HH24') AS slot,
           count(DISTINCT fr.source_id)::int AS "sourceCount",
           coalesce(sum(fr.found_count), 0)::int AS "foundCount",
           coalesce(sum(fr.new_count), 0)::int AS "newCount",
           count(*) FILTER (WHERE fr.status = 'failed')::int AS "failedCount",
           count(*) FILTER (WHERE fr.status = 'running')::int AS "runningCount"
    FROM fetch_runs fr JOIN sources s ON s.id = fr.source_id
    WHERE fr.started_at >= now() - interval '45 days' AND s.kind IN ('rss', 'web_list', 'json_list', 'x_search')
    GROUP BY 1 ORDER BY 1 DESC LIMIT 90`;
  return rows;
}

async function collectionBreakdown(slot: string) {
  const [row] = await sql<any[]>`
    SELECT count(*) FILTER (WHERE status = 'ok')::int AS "successfulRunCount",
           count(*) FILTER (WHERE status = 'ok' AND detail ? 'collectionPipeline')::int AS "trackedRunCount",
           coalesce(sum((detail->'collectionPipeline'->>'rejectedUrlPolicy')::int), 0)::int AS "rejectedUrlPolicy",
           coalesce(sum((detail->'collectionPipeline'->>'rejectedNoise')::int), 0)::int AS "rejectedNoise",
           coalesce(sum((detail->'collectionPipeline'->>'rejectedAge')::int), 0)::int AS "rejectedAge",
           coalesce(sum((detail->'collectionPipeline'->>'rejectedRunLimit')::int), 0)::int AS "rejectedRunLimit",
           coalesce(sum((detail->'collectionPipeline'->>'repeatedInRun')::int), 0)::int AS "repeatedInRun",
           coalesce(sum((detail->'collectionPipeline'->>'alreadyStored')::int), 0)::int AS "alreadyStored",
           coalesce(sum((detail->'collectionPipeline'->>'revised')::int), 0)::int AS revised
    FROM fetch_runs fr JOIN sources s ON s.id = fr.source_id
    WHERE to_char(date_trunc('hour', fr.started_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD"T"HH24') = ${slot}
      AND s.kind IN ('rss', 'web_list', 'json_list', 'x_search')`;
  return {
    ...row,
    available: row.successfulRunCount > 0 && row.trackedRunCount === row.successfulRunCount,
  };
}

async function legacyOutcomes(slot: string, start: Date, end: Date, expectedNewCount: number) {
  const [row] = await sql<any[]>`
    WITH first_jobs AS (
      SELECT data->>'articleId' AS article_id, min(created_on) AS first_queued_at
      FROM pgboss.job
      WHERE name IN ('content.analyze', 'content.extract-body')
        AND data ? 'articleId' AND created_on >= ${start} AND created_on < ${end}
      GROUP BY data->>'articleId'
    ), latest_analysis_job AS (
      SELECT DISTINCT ON (j.data->>'articleId') j.data->>'articleId' AS article_id,
             j.output->>'state' AS outcome
      FROM pgboss.job j JOIN first_jobs f ON f.article_id = j.data->>'articleId'
      WHERE j.name = 'content.analyze'
      ORDER BY j.data->>'articleId', j.created_on DESC, j.id DESC
    ), article_state AS (
      SELECT f.article_id, j.outcome, a.id IS NOT NULL AS retained,
             coalesce(p.selected AND p.visibility = 'public' AND p.visible_after <= now(), false) AS selected,
             an.relevance, an.score, an.selected AS ai_selected, an.output,
             (j.outcome = 'unknown' OR (j.outcome = 'pass' AND NOT coalesce(an.selected, false)
               AND (an.output->>'deadlineStatus' IN ('due_soon', 'unknown')
                 OR coalesce(an.score, nullif(an.output->>'score', '')::numeric, -1) >=
                   coalesce(nullif(an.output->'businessMatch'->'selectionPolicy'->>'reviewFloor', '')::numeric, 50)))) AS manual_review_required,
             fb.label AS human_label
      FROM first_jobs f
      LEFT JOIN latest_analysis_job j ON j.article_id = f.article_id
      LEFT JOIN articles a ON a.id = f.article_id
      LEFT JOIN publications p ON p.article_id = f.article_id
      LEFT JOIN LATERAL (SELECT relevance, score, selected, output FROM analyses WHERE article_id = f.article_id ORDER BY id DESC LIMIT 1) an ON true
      LEFT JOIN LATERAL (SELECT CASE WHEN label IN ('relevant', 'irrelevant') THEN label END AS label
                           FROM business_matching_feedback WHERE article_id = f.article_id ORDER BY created_at DESC, id DESC LIMIT 1) fb ON true
    ), block_receipts AS (
      SELECT count(*)::int AS count FROM receipts
      WHERE purpose = 'prefilter_article' AND logical_key LIKE 'discarded:%'
        AND created_at >= ${start} AND created_at < ${end}
    )
    SELECT count(*)::int AS "insertedCount",
           count(*) FILTER (WHERE outcome = 'pass')::int AS pass,
           count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown,
           count(*) FILTER (WHERE outcome = 'discarded')::int AS discarded,
           count(*) FILTER (WHERE outcome = 'expired')::int AS expired,
           count(*) FILTER (WHERE outcome = 'keyword-reference')::int AS reference,
           count(*) FILTER (WHERE outcome = 'skipped')::int AS skipped,
           count(*) FILTER (WHERE outcome IS NULL)::int AS queued,
           count(*) FILTER (WHERE outcome = 'failed')::int AS failed,
           count(*) FILTER (WHERE selected)::int AS selected,
           count(*) FILTER (WHERE ai_selected IS TRUE)::int AS "aiSelected",
           count(*) FILTER (WHERE manual_review_required AND outcome = 'pass')::int AS "passManualReviewRequired",
           count(*) FILTER (WHERE retained)::int AS retained,
           count(*) FILTER (WHERE manual_review_required)::int AS "manualReviewRequired",
           count(*) FILTER (WHERE manual_review_required AND human_label IS NOT NULL)::int AS "manualMarked",
           count(*) FILTER (WHERE NOT manual_review_required AND human_label IS NOT NULL)::int AS "manualMarkedOutsideReview",
           count(*) FILTER (WHERE NOT manual_review_required AND human_label = 'relevant')::int AS "manualMarkedOutsideRelevant",
           count(*) FILTER (WHERE NOT manual_review_required AND human_label = 'irrelevant')::int AS "manualMarkedOutsideIrrelevant",
           count(*) FILTER (WHERE manual_review_required AND human_label IS NULL)::int AS "manualPending",
           count(*) FILTER (WHERE manual_review_required AND human_label = 'relevant')::int AS "humanRelevant",
           count(*) FILTER (WHERE manual_review_required AND human_label = 'irrelevant')::int AS "humanIrrelevant",
           (SELECT count FROM block_receipts) AS "receiptBlockCount"
    FROM article_state`;

  const block = Math.min(Number(row.receiptBlockCount ?? 0), Number(row.discarded ?? 0));
  const awardResultDiscarded = Math.max(0, Number(row.discarded ?? 0) - block);
  return {
    insertedCount: Number(row.insertedCount ?? 0),
    pass: Number(row.pass ?? 0),
    unknown: Number(row.unknown ?? 0),
    block,
    expired: Number(row.expired ?? 0),
    awardResultDiscarded,
    reference: Number(row.reference ?? 0),
    skipped: Number(row.skipped ?? 0),
    failed: Number(row.failed ?? 0),
    queued: Number(row.queued ?? 0),
    selected: Number(row.selected ?? 0),
    aiSelected: Number(row.aiSelected ?? 0),
    passManualReviewRequired: Number(row.passManualReviewRequired ?? 0),
    manualReviewRequired: Number(row.manualReviewRequired ?? 0),
    manualMarked: Number(row.manualMarked ?? 0),
    manualMarkedOutsideReview: Number(row.manualMarkedOutsideReview ?? 0),
    manualMarkedOutsideRelevant: Number(row.manualMarkedOutsideRelevant ?? 0),
    manualMarkedOutsideIrrelevant: Number(row.manualMarkedOutsideIrrelevant ?? 0),
    humanRelevant: Number(row.humanRelevant ?? 0),
    humanIrrelevant: Number(row.humanIrrelevant ?? 0),
    manualPending: Number(row.manualPending ?? 0),
    physicallyRemoved: Number(row.discarded ?? 0) + Number(row.expired ?? 0),
    retained: Number(row.retained ?? 0),
    legacy: true,
    exactJobCoverage: Number(row.insertedCount ?? 0) === expectedNewCount,
  };
}

export async function keywordGovernanceBatchOutcomes(slot: string, expectedNewCount: number) {
  const window = slotWindow(slot);
  if (!window) return null;
  const [collection, tracked] = await Promise.all([collectionBreakdown(slot), collectionBatchOutcomeStats(slot)]);
  let outcomes: Record<string, any> = {
    ...tracked,
    physicallyRemoved: tracked.block + tracked.expired + tracked.awardResultDiscarded,
    legacy: false,
    exactJobCoverage: true,
  };
  let historyNote = tracked.insertedCount > 0
    ? "批次文章清单与 AI 最新判读共同统计；人工标注按文章关联。"
    : collection.available && expectedNewCount === 0
      ? "本批次没有新入库文章。"
      : "这是历史批次，正在从现存文章、任务结果和人工标注还原汇总。";

  if (tracked.insertedCount === 0 && expectedNewCount > 0 && collection.trackedRunCount < collection.successfulRunCount) {
    try {
      const legacy = await legacyOutcomes(slot, window.start, window.end, expectedNewCount);
      outcomes = legacy;
      historyNote = legacy.exactJobCoverage
        ? "从旧任务结果和人工标注记录还原批次汇总。"
        : `旧任务日志覆盖 ${legacy.insertedCount}/${expectedNewCount} 条新入库文章，统计范围为现存日志。`;
    } catch {
      historyNote = "旧任务明细不可用，无法还原完整判读分项；采集记录中的发现数和入库数仍可核对。";
    }
  }
  return { collection, outcomes, historyNote };
}

async function latestLabeledBatchSlot(slots: BatchSlot[]) {
  if (!slots.length) return null;
  const [row] = await sql<{ slot: string }[]>`
    SELECT c.batch_slot AS slot
      FROM collection_batch_articles c
      JOIN LATERAL (
        SELECT fb.label
          FROM business_matching_feedback fb
         WHERE fb.article_id = c.article_id AND fb.label IN ('relevant', 'irrelevant')
         ORDER BY fb.created_at DESC, fb.id DESC LIMIT 1
      ) latest_feedback ON true
     WHERE c.batch_slot = ANY(${slots.map(({ slot }) => slot)}::text[])
     GROUP BY c.batch_slot
     ORDER BY c.batch_slot DESC LIMIT 1`;
  return row?.slot ?? null;
}

export async function keywordGovernanceFlow(requestedSlot?: string, drillMetric?: string, drillPage?: number) {
  const [slots, recentBulkReview] = await Promise.all([listSlots(), latestLowScoreBulkReview()]);
  const latestLabeledSlot = await latestLabeledBatchSlot(slots);
  const hasRequestedSlot = Boolean(requestedSlot && slots.some((item) => item.slot === requestedSlot));
  const selectedSlot = hasRequestedSlot ? requestedSlot! : latestLabeledSlot ?? slots[0]?.slot ?? null;
  const autoSelectedLabeledBatch = !hasRequestedSlot && Boolean(latestLabeledSlot && latestLabeledSlot !== slots[0]?.slot);
  if (!selectedSlot) return { slots, selectedSlot: null, batch: null, recentBulkReview, latestLabeledSlot, autoSelectedLabeledBatch };
  const window = slotWindow(selectedSlot);
  if (!window) return { slots, selectedSlot: null, batch: null, recentBulkReview, latestLabeledSlot, autoSelectedLabeledBatch };

  const [slotInfo] = slots.filter((item) => item.slot === selectedSlot);
  const batchSummary = await keywordGovernanceBatchOutcomes(selectedSlot, slotInfo.newCount);
  if (!batchSummary) return { slots, selectedSlot: null, batch: null, recentBulkReview, latestLabeledSlot, autoSelectedLabeledBatch };
  const { collection, outcomes, historyNote } = batchSummary;

  const flow = await keywordBatchFlowCounts({
    slot: selectedSlot,
    start: window.start,
    end: window.end,
    legacy: Boolean(outcomes.legacy),
  });
  const drillMetrics = new Set([
    "samples", "relevant", "irrelevant", "formalHit", "conflict", "consistent", "noFormalHit",
    "formalAndCandidate", "formalOnly", "candidateOnly", "neither", "candidateSamples", "positiveRelevantCandidateSamples", "noCandidateSamples",
    "negativeCandidateSamples", "irrelevantWithoutCandidate", "lowScoreIrrelevant",
  ]);
  const drilldown = drillMetric === "positiveCandidateTerms"
    ? await keywordBatchFlowCandidateTerms({
      slot: selectedSlot,
      start: window.start,
      end: window.end,
      legacy: Boolean(outcomes.legacy),
      page: drillPage,
    })
    : drillMetric && drillMetrics.has(drillMetric)
    ? await keywordBatchFlowDocuments({
      slot: selectedSlot,
      start: window.start,
      end: window.end,
      legacy: Boolean(outcomes.legacy),
      metric: drillMetric as KeywordFlowDrillMetric,
      page: drillPage,
    })
    : null;

  return {
    slots,
    selectedSlot,
    recentBulkReview,
    latestLabeledSlot,
    autoSelectedLabeledBatch,
    batch: {
      ...slotInfo,
      collection,
      outcomes,
      flow,
      drilldown,
      historyNote,
    },
  };
}
