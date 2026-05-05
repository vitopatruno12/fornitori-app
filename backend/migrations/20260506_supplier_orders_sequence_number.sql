-- Numerazione ordine per fornitore (riuso del primo numero libero dopo eliminazioni)
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

UPDATE supplier_orders o
SET sequence_number = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY id ASC) AS rn
  FROM supplier_orders
) sub
WHERE o.id = sub.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_orders_supplier_sequence
  ON supplier_orders (supplier_id, sequence_number);

ALTER TABLE supplier_orders ALTER COLUMN sequence_number SET NOT NULL;
