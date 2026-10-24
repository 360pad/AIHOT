CREATE TABLE business_keyword_candidates (
  id                 bigserial PRIMARY KEY,
  article_id         text NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  feedback_id        bigint NOT NULL REFERENCES business_matching_feedback (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('positive', 'negative')),
  phrase             text NOT NULL CHECK (length(trim(phrase)) BETWEEN 1 AND 80),
  capability_id      text NOT NULL,
  role               text NOT NULL CHECK (role IN ('serviceAction', 'method', 'deliverable', 'negative')),
  evidence_source    text NOT NULL CHECK (evidence_source IN ('title', 'body')),
  evidence           text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'staged', 'accepted', 'rejected')),
  profile_version_id text REFERENCES business_profile_versions (id) ON DELETE SET NULL,
  created_by         text NOT NULL,
  reviewed_by        text,
  review_note        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at        timestamptz,
  CHECK ((kind = 'negative' AND role = 'negative') OR (kind = 'positive' AND role <> 'negative')),
  UNIQUE (article_id, kind, phrase, capability_id)
);

CREATE INDEX business_keyword_candidates_status_idx
  ON business_keyword_candidates (status, created_at DESC);
