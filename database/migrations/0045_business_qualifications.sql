CREATE TABLE business_qualifications (
  id              bigserial PRIMARY KEY,
  category        text NOT NULL CHECK (category IN ('company', 'personnel')),
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  normalized_name text NOT NULL,
  created_by      text NOT NULL,
  updated_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX business_qualifications_active_name_idx
  ON business_qualifications (category, normalized_name)
  WHERE deleted_at IS NULL;

CREATE INDEX business_qualifications_active_category_idx
  ON business_qualifications (category, name)
  WHERE deleted_at IS NULL;
