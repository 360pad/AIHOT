-- Versioned company capability profiles and administrator-side semantic matching tests.
-- The profile payload is deliberately JSON: its shape is validated by the backend and can evolve
-- without making the runtime depend on a second hard-coded industry taxonomy.
CREATE TABLE business_profile_versions (
  id              text PRIMARY KEY,
  content_hash    text NOT NULL,
  profile         jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE INDEX business_profile_versions_created_idx ON business_profile_versions (created_at DESC);

CREATE TABLE business_matching_tests (
  id                  text PRIMARY KEY,
  profile_version_id  text NOT NULL REFERENCES business_profile_versions (id),
  title               text NOT NULL,
  body                text NOT NULL DEFAULT '',
  source_url          text,
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  result              jsonb,
  error               text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX business_matching_tests_created_idx ON business_matching_tests (created_at DESC);

CREATE TABLE business_matching_feedback (
  id                bigserial PRIMARY KEY,
  test_id           text REFERENCES business_matching_tests (id) ON DELETE SET NULL,
  article_id        text,
  case_id           text,
  label             text NOT NULL CHECK (label IN ('relevant', 'irrelevant', 'unknown')),
  capability_ids    text[] NOT NULL DEFAULT '{}',
  participation    text CHECK (participation IN ('standalone', 'embedded', 'incidental', 'unknown')),
  evidence_quality text CHECK (evidence_quality IN ('clear', 'limited', 'insufficient')),
  note              text,
  original_result   jsonb,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX business_matching_feedback_test_idx ON business_matching_feedback (test_id, created_at DESC);

ALTER TABLE selectbench_results
  ADD COLUMN business_label text CHECK (business_label IN ('relevant', 'irrelevant', 'unknown')),
  ADD COLUMN capability_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN participation text CHECK (participation IN ('standalone', 'embedded', 'incidental', 'unknown')),
  ADD COLUMN evidence_quality text CHECK (evidence_quality IN ('clear', 'limited', 'insufficient')),
  ADD COLUMN annotation jsonb;
