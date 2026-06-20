-- Codice a 6 cifre per aprire un locale Prima Nota (zona cassa).

CREATE TABLE IF NOT EXISTS prima_nota_locale_packs (
  id SERIAL PRIMARY KEY,
  activity_slug VARCHAR(32) NOT NULL,
  label VARCHAR(255),
  access_code VARCHAR(6),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_prima_nota_locale_packs_slug UNIQUE (activity_slug)
);

CREATE INDEX IF NOT EXISTS ix_prima_nota_locale_packs_slug
  ON prima_nota_locale_packs (activity_slug);

CREATE INDEX IF NOT EXISTS ix_prima_nota_locale_packs_access_code
  ON prima_nota_locale_packs (access_code)
  WHERE access_code IS NOT NULL;
