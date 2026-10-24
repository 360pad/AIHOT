WITH candidate_phrases AS (
  SELECT c.kind, c.capability_id,
         lower(regexp_replace(trim(c.phrase), '[[:space:][:punct:]]', '', 'g')) AS normalized_term,
         c.phrase, c.role, source.normalized_term AS source_normalized_term, source.status AS source_status
    FROM business_keyword_candidates c
    JOIN business_keyword_terms source ON source.id = c.term_id
   WHERE c.status = 'pending' AND source.status = 'pending'
), phrase_groups AS (
  SELECT kind, capability_id, normalized_term,
         min(phrase) AS term,
         min(role) AS role,
         array_remove(array_agg(DISTINCT phrase ORDER BY phrase), min(phrase)) AS variants,
         CASE WHEN bool_or(source_normalized_term = normalized_term)
              THEN min(source_status) FILTER (WHERE source_normalized_term = normalized_term)
              ELSE 'pending' END AS status
    FROM candidate_phrases
   WHERE normalized_term <> ''
   GROUP BY kind, capability_id, normalized_term
)
INSERT INTO business_keyword_terms (kind, term, normalized_term, variants, capability_id, role, status)
SELECT kind, term, normalized_term, variants, capability_id, role, status FROM phrase_groups
ON CONFLICT (kind, capability_id, normalized_term) DO UPDATE SET
  term = EXCLUDED.term,
  variants = EXCLUDED.variants,
  role = EXCLUDED.role,
  updated_at = now();

UPDATE business_keyword_candidates c
   SET term_id = t.id
  FROM business_keyword_terms t
 WHERE c.status = 'pending'
   AND t.status = 'pending'
   AND t.kind = c.kind
   AND t.capability_id = c.capability_id
   AND t.normalized_term = lower(regexp_replace(trim(c.phrase), '[[:space:][:punct:]]', '', 'g'));
