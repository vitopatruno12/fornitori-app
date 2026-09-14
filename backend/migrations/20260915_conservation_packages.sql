-- Conservazione sostitutiva: pacchetti e documenti
CREATE TABLE IF NOT EXISTS conservation_packages (
  id SERIAL PRIMARY KEY,
  company VARCHAR(64) NOT NULL,
  label VARCHAR(255),
  period_from TIMESTAMPTZ,
  period_to TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'bozza',
  document_count INTEGER NOT NULL DEFAULT 0,
  package_hash VARCHAR(64),
  package_path VARCHAR(500),
  index_json_path VARCHAR(500),
  note TEXT,
  built_at TIMESTAMPTZ,
  exported_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  conserved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_conservation_packages_company ON conservation_packages (company);
CREATE INDEX IF NOT EXISTS ix_conservation_packages_status ON conservation_packages (status);
CREATE INDEX IF NOT EXISTS ix_conservation_packages_id ON conservation_packages (id);

CREATE TABLE IF NOT EXISTS conservation_package_items (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES conservation_packages(id) ON DELETE CASCADE,
  source_kind VARCHAR(32) NOT NULL,
  source_id INTEGER NOT NULL,
  invoice_number VARCHAR(128),
  invoice_date TIMESTAMPTZ,
  supplier_name VARCHAR(512),
  customer_vat VARCHAR(32),
  total_amount NUMERIC(12, 2),
  file_role VARCHAR(16) NOT NULL,
  original_filename VARCHAR(255),
  stored_relpath VARCHAR(500),
  content_sha256 VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_conservation_package_items_package ON conservation_package_items (package_id);
CREATE INDEX IF NOT EXISTS ix_conservation_package_items_source ON conservation_package_items (source_kind, source_id);
