#!/usr/bin/env bash
# Crea la tabella codici locale Prima Nota (idempotente). Richiede root/sudo.
set -euo pipefail

DB_NAME="${DB_NAME:-fornitori_db}"

log() { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERRORE: %s\033[0m\n" "$*" >&2; }

if ! command -v psql >/dev/null 2>&1; then
  err "psql non trovato."
  exit 1
fi

if ! sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
  err "Impossibile connettersi a PostgreSQL come utente postgres (esegui con sudo)."
  exit 1
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  err "Database '$DB_NAME' non trovato."
  exit 1
fi

log "Creo tabella prima_nota_locale_packs su $DB_NAME (se manca)"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
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
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'prima_nota_locale_packs'" -d "$DB_NAME" | grep -q 1; then
  err "Tabella prima_nota_locale_packs ancora assente dopo CREATE."
  exit 1
fi

log "OK: prima_nota_locale_packs presente."
sudo -u postgres psql -d "$DB_NAME" -c "\d prima_nota_locale_packs"
