-- P.IVA destinatario e profilo AdE per classificazione fatture passive per società.
ALTER TABLE sdi_invoices ADD COLUMN IF NOT EXISTS receiver_vat VARCHAR(32);
ALTER TABLE sdi_invoices ADD COLUMN IF NOT EXISTS ade_profile_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS ix_sdi_invoices_receiver_vat ON sdi_invoices (receiver_vat);
CREATE INDEX IF NOT EXISTS ix_sdi_invoices_ade_profile_id ON sdi_invoices (ade_profile_id);
