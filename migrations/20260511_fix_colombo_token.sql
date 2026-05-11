BEGIN;

-- Replace the randomly-generated COLOMBO_01 store token with a known value
-- so the reader bridge config can be set deterministically.

UPDATE scan_tokens
SET is_active = FALSE, updated_at = NOW()
WHERE token_type = 'store'
  AND store_id = 'COLOMBO_01'
  AND is_active = TRUE;

INSERT INTO scan_tokens (token, token_type, company_name, store_id, label, is_active)
SELECT
  'st_colombo01xandora2026dbauto0001',
  'store',
  cs.company_name,
  'COLOMBO_01',
  COALESCE(NULLIF(cs.store_name, ''), 'COLOMBO_01'),
  TRUE
FROM company_stores cs
WHERE cs.store_id = 'COLOMBO_01'
  AND cs.is_active = TRUE
LIMIT 1
ON CONFLICT DO NOTHING;

COMMIT;
