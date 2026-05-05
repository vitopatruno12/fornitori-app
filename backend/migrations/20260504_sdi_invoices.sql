-- Tabella ricezione fatture passive da canale SDI: metadati in DB, XML su filesystem o object storage.
CREATE TABLE IF NOT EXISTS sdi_invoices (
  id SERIAL PRIMARY KEY,
  dedupe_key VARCHAR(64) NOT NULL,
  sdi_message_id VARCHAR(256),
  storage_path VARCHAR(1024) NOT NULL,
  supplier_vat VARCHAR(32),
  supplier_name VARCHAR(512),
  invoice_number VARCHAR(128),
  invoice_date DATE,
  receiver_code VARCHAR(16),
  destination TEXT,
  pipeline_status VARCHAR(32) NOT NULL DEFAULT 'parsed',
  source VARCHAR(16) NOT NULL DEFAULT 'push',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sdi_invoices_dedupe_key UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS ix_sdi_invoices_created_at ON sdi_invoices (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sdi_invoices_pipeline_status ON sdi_invoices (pipeline_status);
CREATE INDEX IF NOT EXISTS ix_sdi_invoices_supplier_vat ON sdi_invoices (supplier_vat);
