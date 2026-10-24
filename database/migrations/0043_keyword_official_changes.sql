CREATE TABLE business_keyword_official_changes (
  id                  bigserial PRIMARY KEY,
  kind                text NOT NULL CHECK (kind IN ('positive', 'negative')),
  term                text NOT NULL CHECK (length(trim(term)) BETWEEN 1 AND 80),
  normalized_term     text NOT NULL,
  capability_id       text NOT NULL,
  role                text NOT NULL CHECK (role IN ('serviceAction', 'method', 'deliverable', 'negative')),
  action              text NOT NULL CHECK (action IN ('keep', 'deactivate', 'replace')),
  replacement_term    text CHECK (replacement_term IS NULL OR length(trim(replacement_term)) BETWEEN 1 AND 80),
  status              text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'staged', 'published', 'rejected', 'resolved')),
  profile_version_id  text REFERENCES business_profile_versions (id) ON DELETE SET NULL,
  review_note         text NOT NULL,
  created_by          text NOT NULL,
  reviewed_by         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'replace' AND replacement_term IS NOT NULL) OR (action IN ('keep', 'deactivate') AND replacement_term IS NULL)),
  CHECK ((kind = 'negative' AND role = 'negative') OR (kind = 'positive' AND role <> 'negative'))
);

CREATE INDEX business_keyword_official_changes_status_idx
  ON business_keyword_official_changes (status, created_at DESC);

ALTER TABLE business_keyword_governance_drafts
  ADD COLUMN official_change_ids bigint[] NOT NULL DEFAULT '{}';
