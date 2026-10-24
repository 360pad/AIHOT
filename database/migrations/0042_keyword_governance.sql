CREATE TABLE business_keyword_terms (
  id                 bigserial PRIMARY KEY,
  kind               text NOT NULL CHECK (kind IN ('positive', 'negative')),
  term               text NOT NULL CHECK (length(trim(term)) BETWEEN 1 AND 80),
  normalized_term    text NOT NULL,
  variants           text[] NOT NULL DEFAULT '{}',
  capability_id      text NOT NULL,
  role               text NOT NULL CHECK (role IN ('serviceAction', 'method', 'deliverable', 'negative')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'candidate', 'staged', 'published', 'rejected')),
  context_id         text,
  profile_version_id text REFERENCES business_profile_versions (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_by        text,
  reviewed_at        timestamptz,
  review_note        text,
  CHECK ((kind = 'negative' AND role = 'negative') OR (kind = 'positive' AND role <> 'negative')),
  UNIQUE (kind, capability_id, normalized_term)
);

ALTER TABLE business_keyword_candidates
  ADD COLUMN term_id bigint REFERENCES business_keyword_terms (id) ON DELETE SET NULL;

ALTER TABLE business_matching_feedback
  ADD COLUMN keyword_extracted_at timestamptz;

WITH grouped AS (
  SELECT kind, capability_id,
         lower(regexp_replace(trim(phrase), '[[:space:][:punct:]]', '', 'g')) AS normalized_term,
         min(phrase) AS term,
         min(role) AS role,
         array_agg(DISTINCT phrase ORDER BY phrase) AS variants,
         CASE WHEN bool_or(status = 'accepted') THEN 'published'
              WHEN bool_or(status = 'staged') THEN 'staged'
              WHEN bool_or(status = 'rejected') THEN 'rejected'
              ELSE 'pending' END AS status,
         max(profile_version_id) AS profile_version_id,
         min(created_at) AS created_at,
         max(created_at) AS updated_at
    FROM business_keyword_candidates
   GROUP BY kind, capability_id, lower(regexp_replace(trim(phrase), '[[:space:][:punct:]]', '', 'g'))
)
INSERT INTO business_keyword_terms
  (kind, capability_id, normalized_term, term, role, variants, status, profile_version_id, created_at, updated_at)
SELECT kind, capability_id, normalized_term, term, role, variants, status, profile_version_id, created_at, updated_at
  FROM grouped
 WHERE normalized_term <> ''
ON CONFLICT (kind, capability_id, normalized_term) DO NOTHING;

UPDATE business_keyword_candidates c
   SET term_id = t.id
  FROM business_keyword_terms t
 WHERE c.term_id IS NULL
   AND c.kind = t.kind
   AND c.capability_id = t.capability_id
   AND lower(regexp_replace(trim(c.phrase), '[[:space:][:punct:]]', '', 'g')) = t.normalized_term;

CREATE INDEX business_keyword_terms_status_idx
  ON business_keyword_terms (status, kind, updated_at DESC);
CREATE INDEX business_keyword_candidates_term_idx
  ON business_keyword_candidates (term_id, created_at DESC);

CREATE TABLE business_keyword_governance_drafts (
  profile_version_id      text PRIMARY KEY REFERENCES business_profile_versions (id) ON DELETE CASCADE,
  name                    text NOT NULL,
  base_profile_version_id text,
  term_ids                bigint[] NOT NULL DEFAULT '{}',
  context_id              text,
  replay_result           jsonb,
  replayed_at             timestamptz,
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by              text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);
