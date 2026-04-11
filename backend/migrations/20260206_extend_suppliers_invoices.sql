-- PostgreSQL: estensione anagrafica fornitori e fatture (pagamenti / scadenze).
-- Eseguire una volta sul database esistente (es. psql -f ...).
-- Se il DB e stato creato da zero dopo l'aggiornamento del codice, le colonne
-- potrebbero gia esistere: in quel caso gli IF NOT EXISTS evitano errori.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS fiscal_code VARCHAR(32);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS merchandise_category VARCHAR(120);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS price_list_label VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_expired BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cash_entry_id INTEGER NULL REFERENCES cash_entries(id);

CREATE INDEX IF NOT EXISTS ix_invoices_due_date ON invoices (due_date);
CREATE INDEX IF NOT EXISTS ix_invoices_cash_entry_id ON invoices (cash_entry_id);
