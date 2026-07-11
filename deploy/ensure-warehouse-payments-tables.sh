#!/usr/bin/env bash
# Crea tabelle magazzino / pagamenti fornitori e colonna volume_liters come superuser,
# poi assegna permessi all'utente app (fornitori_user).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"
MIG_DIR="$APP_DIR/backend/migrations"

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
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERRORE: %s\033[0m\n" "$*" >&2; }

if ! command -v psql >/dev/null 2>&1; then
  warn "psql non trovato: salto migrazioni magazzino/pagamenti."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
  warn "Impossibile connettersi a PostgreSQL come postgres: salto migrazioni magazzino/pagamenti."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  warn "Database '$DB_NAME' non trovato: salto migrazioni magazzino/pagamenti."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1; then
  err "Utente database '$DB_USER' non trovato."
  exit 1
fi

_apply_sql_file() {
  local name="$1"
  local file="$MIG_DIR/$name"
  if [[ ! -f "$file" ]]; then
    err "File migrazione assente: $file"
    exit 1
  fi
  log "Applico $name"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$file"
}

log "Migrazioni magazzino / pagamenti / ordini su $DB_NAME (owner $DB_USER)"

for mig in \
  20260710_warehouse_movements.sql \
  20260710_supplier_payments_workbook.sql \
  20260710_supplier_order_items_volume_liters.sql
do
  _apply_sql_file "$mig"
done

_grant_table() {
  local table="$1"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE ${table} OWNER TO "$DB_USER";
ALTER SEQUENCE IF EXISTS ${table}_id_seq OWNER TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO "$DB_USER";
GRANT USAGE, SELECT ON SEQUENCE ${table}_id_seq TO "$DB_USER";
SQL
}

_grant_table warehouse_movements
_grant_table supplier_payments_workbooks

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE supplier_order_items TO "$DB_USER";
SQL

for table in warehouse_movements supplier_payments_workbooks; do
  if ! sudo -u postgres psql -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table'" \
    -d "$DB_NAME" | grep -q 1; then
    err "Tabella $table ancora assente dopo CREATE."
    exit 1
  fi
done

if ! sudo -u postgres psql -tAc \
  "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'supplier_order_items' AND column_name = 'volume_liters'" \
  -d "$DB_NAME" | grep -q 1; then
  err "Colonna supplier_order_items.volume_liters ancora assente."
  exit 1
fi

log "OK: warehouse_movements, supplier_payments_workbooks e volume_liters presenti."
