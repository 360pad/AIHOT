import { sql, type Db } from "../db.ts";
import { AWARD_RESULT_TITLE_PATTERN } from "@aihot/industry/taxonomy";

type BatchOutcome = {
  status: "pass" | "unknown" | "block" | "expired" | "award_result_discarded" | "reference" | "skipped" | "failed";
  reason?: string | null;
  score?: number | null;
  selected?: boolean | null;
  manualReviewRequired?: boolean;
};

export async function recordCollectionBatchOutcome(articleId: string, outcome: BatchOutcome, db: Db = sql) {
  await db`UPDATE collection_batch_articles SET
      status = ${outcome.status}, reason = ${outcome.reason ?? null}, ai_score = ${outcome.score ?? null},
      ai_selected = ${outcome.selected ?? null}, manual_review_required = ${outcome.manualReviewRequired ?? false}, processed_at = now()
    WHERE article_id = ${articleId}`;
}

export async function recordCollectionBatchFailure(articleId: string, reason: string) {
  await recordCollectionBatchOutcome(articleId, { status: "failed", reason });
}

export async function recordCollectionBatchFeedback(input: { articleId: string; feedbackId: number; label: "relevant" | "irrelevant"; actor: string }, db: Db = sql) {
  await db`INSERT INTO collection_batch_feedback_events (batch_slot, article_id, feedback_id, label, created_by)
    SELECT batch_slot, article_id, ${input.feedbackId}, ${input.label}, ${input.actor}
    FROM collection_batch_articles WHERE article_id = ${input.articleId}`;
  await db`UPDATE collection_batch_articles SET human_label = ${input.label}, human_labeled_at = now()
    WHERE article_id = ${input.articleId}`;
}

export async function collectionBatchOutcomeStats(slot: string, db: Db = sql) {
  const awardPattern = AWARD_RESULT_TITLE_PATTERN.source;
  const [row] = await db<any[]>`
    WITH latest_feedback AS (
      SELECT DISTINCT ON (article_id) article_id, label
        FROM business_matching_feedback
       WHERE article_id IS NOT NULL
       ORDER BY article_id, created_at DESC, id DESC
    ), state AS (
      SELECT c.*,
             an.relevance, an.score, an.selected, an.output,
             p.selected AS publication_is_selected, p.visibility AS publication_visibility,
             p.visible_after AS publication_visible_after,
             fb.label AS latest_human_label,
             ((c.status = 'award_result_discarded' AND an.relevance IS NULL)
               OR coalesce(an.output->>'itemType', '') = 'award_result'
               OR coalesce(a.title, '') ~ ${awardPattern}) AS is_award_result,
             (CASE WHEN an.relevance IS NULL THEN c.status = 'expired' ELSE an.output->>'deadlineStatus' = 'passed' END) AS is_expired,
             (CASE WHEN an.relevance IS NULL THEN c.status = 'block' ELSE an.relevance = 'block' END) AS is_block,
             coalesce(an.score, nullif(an.output->'scoreBreakdown'->>'total', '')::numeric,
                      nullif(an.output->>'score', '')::numeric) AS current_score,
             coalesce(an.output->>'deadlineStatus', '') AS deadline_status,
             coalesce(nullif(an.output->'selectionPolicy'->>'featuredThreshold', '')::numeric,
                      nullif(an.output->>'threshold', '')::numeric, 85) AS featured_threshold,
             coalesce(nullif(an.output->'selectionPolicy'->>'reviewFloor', '')::numeric, 50) AS review_floor_again
        FROM collection_batch_articles c
        LEFT JOIN articles a ON a.id = c.article_id
        LEFT JOIN publications p ON p.article_id = c.article_id
        LEFT JOIN LATERAL (
          SELECT relevance, score, selected, output
            FROM analyses WHERE article_id = c.article_id ORDER BY id DESC LIMIT 1
        ) an ON true
        LEFT JOIN latest_feedback fb ON fb.article_id = c.article_id
       WHERE c.batch_slot = ${slot}
    ), classified AS (
      SELECT state.*,
             CASE
               WHEN is_award_result THEN 'award_result_discarded'
               WHEN is_expired THEN 'expired'
               WHEN is_block THEN 'block'
               WHEN relevance = 'pass' OR (relevance IS NULL AND status = 'pass') THEN 'pass'
               WHEN relevance = 'unknown' OR (relevance IS NULL AND status = 'unknown') THEN 'unknown'
               WHEN status IN ('reference', 'skipped', 'failed') THEN status
               ELSE 'queued'
             END AS current_status,
             CASE
               WHEN is_award_result OR is_expired OR is_block OR deadline_status = 'passed' THEN false
               WHEN relevance IS NULL THEN ai_selected
               WHEN selected IS TRUE THEN true
               ELSE relevance = 'pass' AND current_score IS NOT NULL AND current_score >= featured_threshold
             END AS current_selected,
             CASE
               WHEN is_award_result OR is_expired OR is_block THEN false
               WHEN relevance IS NULL THEN manual_review_required
               WHEN relevance = 'unknown' THEN true
               WHEN relevance = 'pass' THEN
                 NOT (CASE
                   WHEN deadline_status = 'passed' THEN false
                   WHEN selected IS TRUE THEN true
                   ELSE current_score IS NOT NULL AND current_score >= featured_threshold
                 END)
                 AND (deadline_status IN ('due_soon', 'unknown') OR coalesce(current_score, -1) >= review_floor_again)
               ELSE false
             END AS current_manual_review_required,
             CASE WHEN latest_human_label IN ('relevant', 'irrelevant') THEN latest_human_label END AS current_human_label
        FROM state
    )
    SELECT count(*)::int AS "insertedCount",
           count(*) FILTER (WHERE current_status = 'pass')::int AS pass,
           count(*) FILTER (WHERE current_status = 'unknown')::int AS unknown,
           count(*) FILTER (WHERE current_status = 'block')::int AS block,
           count(*) FILTER (WHERE current_status = 'expired')::int AS expired,
           count(*) FILTER (WHERE current_status = 'award_result_discarded')::int AS "awardResultDiscarded",
           count(*) FILTER (WHERE current_status = 'reference')::int AS reference,
           count(*) FILTER (WHERE current_status = 'skipped')::int AS skipped,
           count(*) FILTER (WHERE current_status = 'failed')::int AS failed,
           count(*) FILTER (WHERE current_status = 'queued')::int AS queued,
           count(*) FILTER (WHERE current_status = 'queued')::int AS "unanalyzedCount",
           count(*) FILTER (WHERE current_selected)::int AS "aiSelected",
           count(*) FILTER (WHERE publication_is_selected AND publication_visibility = 'public' AND publication_visible_after <= now())::int AS selected,
           count(*) FILTER (WHERE current_manual_review_required AND current_status = 'pass')::int AS "passManualReviewRequired",
           count(*) FILTER (WHERE current_status NOT IN ('block', 'expired', 'award_result_discarded'))::int AS retained,
           count(*) FILTER (WHERE current_manual_review_required)::int AS "manualReviewRequired",
           count(*) FILTER (WHERE current_manual_review_required AND current_human_label IS NOT NULL)::int AS "manualMarked",
           count(*) FILTER (WHERE NOT current_manual_review_required AND current_human_label IS NOT NULL)::int AS "manualMarkedOutsideReview",
           count(*) FILTER (WHERE NOT current_manual_review_required AND current_human_label = 'relevant')::int AS "manualMarkedOutsideRelevant",
           count(*) FILTER (WHERE NOT current_manual_review_required AND current_human_label = 'irrelevant')::int AS "manualMarkedOutsideIrrelevant",
           count(*) FILTER (WHERE current_manual_review_required AND current_human_label = 'relevant')::int AS "humanRelevant",
           count(*) FILTER (WHERE current_manual_review_required AND current_human_label = 'irrelevant')::int AS "humanIrrelevant",
           count(*) FILTER (WHERE current_manual_review_required AND current_human_label IS NULL)::int AS "manualPending"
      FROM classified`;
  return row ?? {};
}
