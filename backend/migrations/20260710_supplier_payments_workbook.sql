CREATE TABLE IF NOT EXISTS supplier_payments_workbooks (
    id SERIAL PRIMARY KEY,
    workbook_key VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_supplier_payments_workbook_key UNIQUE (workbook_key)
);

CREATE INDEX IF NOT EXISTS ix_supplier_payments_workbook_key ON supplier_payments_workbooks (workbook_key);
