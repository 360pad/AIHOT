CREATE TABLE collection_batch_articles (
  batch_slot text NOT NULL CHECK (batch_slot ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3])$'),
  article_id text NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'pass', 'unknown', 'block', 'expired', 'award_result_discarded', 'reference', 'skipped', 'failed')),
  reason text,
  ai_score numeric(5, 2),
  ai_selected boolean,
  published_selected boolean,
  manual_review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  human_label text CHECK (human_label IN ('relevant', 'irrelevant', 'unknown')),
  human_labeled_at timestamptz,
  PRIMARY KEY (batch_slot, article_id)
);

CREATE INDEX collection_batch_articles_source_idx ON collection_batch_articles (batch_slot, source_id);

CREATE TABLE collection_batch_feedback_events (
  id bigserial PRIMARY KEY,
  batch_slot text NOT NULL,
  article_id text NOT NULL,
  feedback_id bigint,
  label text NOT NULL CHECK (label IN ('relevant', 'irrelevant', 'unknown')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_slot, article_id) REFERENCES collection_batch_articles (batch_slot, article_id) ON DELETE RESTRICT
);

CREATE INDEX collection_batch_feedback_events_idx ON collection_batch_feedback_events (batch_slot, label, created_at DESC);
