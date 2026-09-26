ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS bolla_verified BOOLEAN;

UPDATE invoices
SET bolla_verified = FALSE
WHERE bolla_verified IS NULL;

ALTER TABLE invoices
ALTER COLUMN bolla_verified SET DEFAULT FALSE;

ALTER TABLE invoices
ALTER COLUMN bolla_verified SET NOT NULL;
