ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS expected_delivery_date DATE;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS note_internal TEXT;
