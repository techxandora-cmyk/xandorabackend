ALTER TABLE laundry_item_types
  ALTER COLUMN category SET DEFAULT 'FABRICS';

ALTER TABLE laundry_items
  ALTER COLUMN item_category SET DEFAULT 'FABRICS';

UPDATE laundry_item_types
SET category = 'FABRICS'
WHERE UPPER(COALESCE(category, '')) = 'LINEN';

UPDATE laundry_items
SET item_category = 'FABRICS'
WHERE UPPER(COALESCE(item_category, '')) = 'LINEN';
