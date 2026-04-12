BEGIN;

ALTER TABLE laundry_item_types
  ADD COLUMN IF NOT EXISTS fabric_type TEXT,
  ADD COLUMN IF NOT EXISTS size_label TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);

ALTER TABLE laundry_items
  ADD COLUMN IF NOT EXISTS fabric_type TEXT,
  ADD COLUMN IF NOT EXISTS size_label TEXT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2);

UPDATE laundry_item_types
SET fabric_type = COALESCE(NULLIF(fabric_type, ''), NULLIF(category, ''), 'FABRICS')
WHERE COALESCE(fabric_type, '') = '';

UPDATE laundry_items
SET fabric_type = COALESCE(NULLIF(fabric_type, ''), NULLIF(item_category, ''), 'FABRICS')
WHERE COALESCE(fabric_type, '') = '';

COMMIT;
