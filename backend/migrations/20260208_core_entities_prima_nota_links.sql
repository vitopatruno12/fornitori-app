-- Struttura dati: Clienti, Conti, Metodi pagamento, Categorie, Allegati, Righe fattura, Testata consegna
-- Collegamenti Prima Nota (cash_entries) → fattura, consegna, fornitore (già), cliente, conto, categorie, metodo pagamento

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  vat_number VARCHAR(50),
  email VARCHAR(255),
  phone VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32),
  name VARCHAR(120) NOT NULL,
  account_type VARCHAR(20) NOT NULL DEFAULT 'cassa',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  flow VARCHAR(20) NOT NULL DEFAULT 'entrambi'
);

CREATE TABLE IF NOT EXISTS delivery_documents (
  id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  ddt_number VARCHAR(64),
  delivery_date TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_delivery_documents_supplier ON delivery_documents (supplier_id);
CREATE INDEX IF NOT EXISTS ix_delivery_documents_date ON delivery_documents (delivery_date);

CREATE TABLE IF NOT EXISTS invoice_rows (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  description VARCHAR(500),
  quantity NUMERIC(12, 3),
  unit_price NUMERIC(12, 2),
  vat_percent NUMERIC(5, 2) NOT NULL DEFAULT 22.00,
  imponibile NUMERIC(12, 2) NOT NULL,
  vat_amount NUMERIC(12, 2) NOT NULL,
  total_line NUMERIC(12, 2) NOT NULL,
  UNIQUE (invoice_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_invoice_rows_invoice ON invoice_rows (invoice_id);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delivery_document_id INTEGER REFERENCES delivery_documents(id);

CREATE INDEX IF NOT EXISTS ix_deliveries_doc ON deliveries (delivery_document_id);

ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS delivery_id INTEGER REFERENCES deliveries(id);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS payment_method_id INTEGER REFERENCES payment_methods(id);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id);

CREATE INDEX IF NOT EXISTS ix_cash_entries_invoice ON cash_entries (invoice_id);
CREATE INDEX IF NOT EXISTS ix_cash_entries_delivery ON cash_entries (delivery_id);
CREATE INDEX IF NOT EXISTS ix_cash_entries_customer ON cash_entries (customer_id);
CREATE INDEX IF NOT EXISTS ix_cash_entries_account ON cash_entries (account_id);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  storage_path VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  title VARCHAR(255),
  mime_type VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cash_entry_id INTEGER REFERENCES cash_entries(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  delivery_id INTEGER REFERENCES deliveries(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_attachments_cash ON attachments (cash_entry_id);
CREATE INDEX IF NOT EXISTS ix_attachments_invoice ON attachments (invoice_id);
CREATE INDEX IF NOT EXISTS ix_attachments_delivery ON attachments (delivery_id);

INSERT INTO accounts (code, name, account_type, is_active, sort_order)
SELECT 'CASSA', 'Cassa', 'cassa', TRUE, 1
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = 'CASSA');

INSERT INTO accounts (code, name, account_type, is_active, sort_order)
SELECT 'BANCA', 'Conto corrente / Banca', 'banca', TRUE, 2
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = 'BANCA');

INSERT INTO payment_methods (name, sort_order) SELECT 'Contanti', 1
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'Contanti');
INSERT INTO payment_methods (name, sort_order) SELECT 'Bonifico', 2
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'Bonifico');
INSERT INTO payment_methods (name, sort_order) SELECT 'Carta', 3
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'Carta');
INSERT INTO payment_methods (name, sort_order) SELECT 'Assegno', 4
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'Assegno');
INSERT INTO payment_methods (name, sort_order) SELECT 'RID / SDD', 5
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE name = 'RID / SDD');

INSERT INTO categories (name, flow) SELECT 'Generico', 'entrambi'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Generico');
INSERT INTO categories (name, flow) SELECT 'Fornitori', 'uscita'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Fornitori');
INSERT INTO categories (name, flow) SELECT 'Clienti', 'entrata'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Clienti');
INSERT INTO categories (name, flow) SELECT 'Personale', 'uscita'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Personale');
INSERT INTO categories (name, flow) SELECT 'Fiscale', 'entrambi'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Fiscale');
