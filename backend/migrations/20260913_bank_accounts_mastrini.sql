-- Associazione conti banca → mastrini (società + codice mastro)
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS company VARCHAR(64);
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS ledger_code VARCHAR(16) DEFAULT '1100';
UPDATE bank_accounts SET ledger_code = '1100' WHERE ledger_code IS NULL OR trim(ledger_code) = '';
CREATE INDEX IF NOT EXISTS ix_bank_accounts_company ON bank_accounts (company);
