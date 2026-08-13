-- Fase 1: collega inbox SDI → ElectronicInvoice (gestionale Atlas)
ALTER TABLE sdi_invoices
  ADD COLUMN IF NOT EXISTS electronic_invoice_id INTEGER
    REFERENCES electronic_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_sdi_invoices_electronic_invoice_id
  ON sdi_invoices (electronic_invoice_id);
