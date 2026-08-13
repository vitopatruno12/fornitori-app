-- Electronic invoice XML import (FatturaPA → fatture passive)
-- Atlas: SQLAlchemy / PostgreSQL (equivalente allo schema Prisma proposto)

CREATE TABLE IF NOT EXISTS electronic_invoices (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(512),
  xml_content TEXT NOT NULL,
  document_hash VARCHAR(64) NOT NULL UNIQUE,
  document_type VARCHAR(16),
  invoice_number VARCHAR(128),
  invoice_date DATE,
  currency VARCHAR(8),
  supplier_vat VARCHAR(32),
  customer_vat VARCHAR(32),
  total_amount NUMERIC(15, 2),
  taxable_amount NUMERIC(15, 2),
  vat_amount NUMERIC(15, 2),
  status VARCHAR(32) NOT NULL DEFAULT 'IMPORTED',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_electronic_invoices_supplier_vat ON electronic_invoices (supplier_vat);
CREATE INDEX IF NOT EXISTS ix_electronic_invoices_invoice_number ON electronic_invoices (invoice_number);

CREATE TABLE IF NOT EXISTS incoming_invoices (
  id SERIAL PRIMARY KEY,
  electronic_invoice_id INTEGER NOT NULL UNIQUE REFERENCES electronic_invoices(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  atlas_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number VARCHAR(128) NOT NULL,
  invoice_date TIMESTAMPTZ NOT NULL,
  taxable_amount NUMERIC(15, 2) NOT NULL,
  vat_amount NUMERIC(15, 2) NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_incoming_invoices_supplier ON incoming_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS ix_incoming_invoices_atlas_invoice ON incoming_invoices (atlas_invoice_id);

CREATE TABLE IF NOT EXISTS incoming_invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES incoming_invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  description TEXT,
  quantity NUMERIC(15, 4),
  unit_price NUMERIC(15, 8),
  line_total NUMERIC(15, 2),
  vat_rate NUMERIC(5, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, line_number)
);

CREATE INDEX IF NOT EXISTS ix_incoming_invoice_lines_invoice ON incoming_invoice_lines (invoice_id);
