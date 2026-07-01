#!/usr/bin/env bash
# Crea la tabella codici locale Prima Nota come superuser e assegna permessi all'utente app.
set -euo pipefail

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"

_read_env_database_url() {
  local candidates=(
    "${API_ENV_FILE:-}"
    "/opt/fornitori-app/backend/.env"
    "/var/www/app-fornitori/fornitori-app/backend/.env"
  )
  local f url
  for f in "${candidates[@]}"; do
    [[ -n "$f" && -f "$f" ]] || continue
    url="$(grep -E '^DATABASE_URL=' "$f" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
  done
  return 1
}

if [[ -f /root/fornitori_db_credentials.txt ]]; then
  # shellcheck disable=SC1091
  val="$(grep -E '^DB_USER=' /root/fornitori_db_credentials.txt | head -1 | cut -d= -f2- || true)"
  if [[ -n "$val" ]]; then
    DB_USER="$val"
  fi
  val="$(grep -E '^DB_NAME=' /root/fornitori_db_credentials.txt | head -1 | cut -d= -f2- || true)"
  if [[ -n "$val" ]]; then
    DB_NAME="$val"
  fi
fi

if db_url="$(_read_env_database_url 2>/dev/null)"; then
  if [[ "$db_url" =~ postgresql://([^:/@]+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
  fi
  if [[ "$db_url" =~ /([^/?]+)(\?|$) ]]; then
    DB_NAME="${BASH_REMATCH[1]}"
  fi
fi

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

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; then
  err "Utente database '$DB_USER' non trovato."
  exit 1
fi

log "Creo tabella prima_nota_locale_packs su $DB_NAME (owner $DB_USER)"

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

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE prima_nota_locale_packs OWNER TO "$DB_USER";
ALTER SEQUENCE IF EXISTS prima_nota_locale_packs_id_seq OWNER TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE prima_nota_locale_packs TO "$DB_USER";
GRANT USAGE, SELECT ON SEQUENCE prima_nota_locale_packs_id_seq TO "$DB_USER";
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'prima_nota_locale_packs'" -d "$DB_NAME" | grep -q 1; then
  err "Tabella prima_nota_locale_packs ancora assente dopo CREATE."
  exit 1
fi

log "OK: prima_nota_locale_packs presente (owner $DB_USER)."
sudo -u postgres psql -d "$DB_NAME" -c "\d prima_nota_locale_packs"
