#!/usr/bin/env bash
# Crea tabella issued_invoices (fatture emesse) e assegna ownership all'utente app.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"
MIG="$APP_DIR/backend/migrations/20260909_issued_invoices.sql"

_read_env_database_url() {
  local candidates=(
    "${API_ENV_FILE:-}"
    "$APP_DIR/backend/.env"
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
  [[ -n "$val" ]] && DB_USER="$val"
  val="$(grep -E '^DB_NAME=' /root/fornitori_db_credentials.txt | head -1 | cut -d= -f2- || true)"
  [[ -n "$val" ]] && DB_NAME="$val"
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

[[ -f "$MIG" ]] || { err "Migrazione assente: $MIG"; exit 1; }

log "Applico issued_invoices su $DB_NAME (owner $DB_USER)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$MIG"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE IF EXISTS issued_invoices ADD COLUMN IF NOT EXISTS customer_name VARCHAR(512);
ALTER TABLE IF EXISTS issued_invoices ADD COLUMN IF NOT EXISTS customer_vat VARCHAR(32);
ALTER TABLE IF EXISTS issued_invoices OWNER TO "$DB_USER";
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'issued_invoices_id_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE issued_invoices_id_seq OWNER TO "$DB_USER"';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE issued_invoices_id_seq TO "$DB_USER"';
  END IF;
END
\$\$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE issued_invoices TO "$DB_USER";
SQL

if ! sudo -u postgres psql -tAc \
  "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'issued_invoices'" \
  -d "$DB_NAME" | grep -q 1; then
  err "Tabella issued_invoices ancora assente."
  exit 1
fi

log "OK: issued_invoices presente"
