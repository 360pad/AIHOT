INSERT INTO collection_batch_feedback_events
  (batch_slot, article_id, feedback_id, label, created_by, created_at)
SELECT c.batch_slot, c.article_id, fb.id, fb.label, fb.created_by, fb.created_at
  FROM collection_batch_articles c
  JOIN business_matching_feedback fb ON fb.article_id = c.article_id
 WHERE fb.label IN ('relevant', 'irrelevant', 'unknown')
   AND NOT EXISTS (
     SELECT 1 FROM collection_batch_feedback_events event
      WHERE event.batch_slot = c.batch_slot
        AND event.article_id = c.article_id
        AND event.feedback_id = fb.id
   );

WITH latest_feedback AS (
  SELECT DISTINCT ON (article_id) article_id, label, created_at
    FROM business_matching_feedback
   WHERE article_id IS NOT NULL AND label IN ('relevant', 'irrelevant', 'unknown')
   ORDER BY article_id, created_at DESC, id DESC
)
UPDATE collection_batch_articles c
   SET human_label = fb.label, human_labeled_at = fb.created_at
  FROM latest_feedback fb
 WHERE fb.article_id = c.article_id
   AND (c.human_label IS DISTINCT FROM fb.label OR c.human_labeled_at IS DISTINCT FROM fb.created_at);
