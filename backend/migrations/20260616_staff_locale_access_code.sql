-- Codice a 6 cifre per caricare i dipendenti di un locale (zona).

ALTER TABLE staff_locale_packs
  ADD COLUMN IF NOT EXISTS access_code VARCHAR(6);

CREATE INDEX IF NOT EXISTS ix_staff_locale_packs_access_code
  ON staff_locale_packs (access_code)
  WHERE access_code IS NOT NULL;
