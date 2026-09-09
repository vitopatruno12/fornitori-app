-- Fatture emesse caricate manualmente (XML / PDF / immagine)
CREATE TABLE IF NOT EXISTS issued_invoices (
    id SERIAL PRIMARY KEY,
    company VARCHAR(64) NOT NULL,
    activity VARCHAR(64),
    file_kind VARCHAR(16) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    invoice_number VARCHAR(100),
    invoice_date TIMESTAMPTZ,
    total_amount NUMERIC(12, 2),
    status VARCHAR(32) NOT NULL DEFAULT 'caricata',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_issued_invoices_company ON issued_invoices (company);
CREATE INDEX IF NOT EXISTS ix_issued_invoices_activity ON issued_invoices (activity);
CREATE INDEX IF NOT EXISTS ix_issued_invoices_id ON issued_invoices (id);
