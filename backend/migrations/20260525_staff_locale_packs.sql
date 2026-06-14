-- Personale: liste dipendenti salvate per nome locale (condivise tra browser/PC)

CREATE TABLE IF NOT EXISTS staff_locale_packs (
  id SERIAL PRIMARY KEY,
  locale_name VARCHAR(255) NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_staff_locale_packs_name UNIQUE (locale_name)
);

CREATE INDEX IF NOT EXISTS ix_staff_locale_packs_name ON staff_locale_packs (locale_name);
