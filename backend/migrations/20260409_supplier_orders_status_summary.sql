-- Stato ordine, snapshot fornitore, riepilogo merce
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(255);
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS merchandise_summary TEXT;
UPDATE supplier_orders SET status = 'pending' WHERE status IS NULL;
