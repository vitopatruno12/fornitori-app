-- Scontrini / ticket POS (EasyRetail o CSV export)
CREATE TABLE IF NOT EXISTS pos_receipts (
  id SERIAL PRIMARY KEY,
  source VARCHAR(32) NOT NULL DEFAULT 'easyretail',
  store_key VARCHAR(64) NOT NULL DEFAULT '',
  model_id VARCHAR(32),
  model_label VARCHAR(80),
  external_id VARCHAR(120) NOT NULL,
  receipt_at TIMESTAMPTZ NOT NULL,
  amount_eur NUMERIC(12, 2),
  is_void INTEGER NOT NULL DEFAULT 0,
  raw_store VARCHAR(120),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_pos_receipts_source_store_external UNIQUE (source, store_key, external_id)
);

CREATE INDEX IF NOT EXISTS ix_pos_receipts_source ON pos_receipts (source);
CREATE INDEX IF NOT EXISTS ix_pos_receipts_store_key ON pos_receipts (store_key);
CREATE INDEX IF NOT EXISTS ix_pos_receipts_model_id ON pos_receipts (model_id);
CREATE INDEX IF NOT EXISTS ix_pos_receipts_receipt_at ON pos_receipts (receipt_at);
CREATE INDEX IF NOT EXISTS ix_pos_receipts_when_store ON pos_receipts (receipt_at, store_key);
CREATE INDEX IF NOT EXISTS ix_pos_receipts_model_when ON pos_receipts (model_id, receipt_at);
