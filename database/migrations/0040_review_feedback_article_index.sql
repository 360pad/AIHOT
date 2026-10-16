CREATE INDEX business_matching_feedback_article_idx
  ON business_matching_feedback (article_id, created_at DESC);
