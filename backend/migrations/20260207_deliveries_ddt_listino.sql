-- Consegne: DDT, confronto listino, note anomalie
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS ddt_number VARCHAR(64);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS list_unit_price NUMERIC(10, 2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS price_diff_vs_list NUMERIC(10, 2);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS anomaly_note TEXT;

CREATE INDEX IF NOT EXISTS ix_deliveries_ddt_number ON deliveries (ddt_number);
CREATE INDEX IF NOT EXISTS ix_deliveries_product_desc ON deliveries (product_description);
