-- Sezione operativa (Banco, Cucina, Forno, …) e elenco sezioni per pack locale.
ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS section VARCHAR(120);

ALTER TABLE staff_locale_packs
  ADD COLUMN IF NOT EXISTS sections_json TEXT NOT NULL DEFAULT '[]';
