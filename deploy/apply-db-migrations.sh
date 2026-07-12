#!/usr/bin/env bash
# Applica migrazioni SQL idempotenti (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
# Eseguire sul server con sudo prima o insieme al restart API.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
MIG_DIR="$APP_DIR/backend/migrations"

log() { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }

if [[ ! -d "$MIG_DIR" ]]; then
  warn "Cartella migrazioni assente: $MIG_DIR"
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  warn "psql non trovato: salto migrazioni SQL."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
  warn "Impossibile connettersi a PostgreSQL come utente postgres."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  warn "Database $DB_NAME non trovato: salto migrazioni."
  exit 0
fi

# Migrazioni sicure da rieseguire (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
SAFE_MIGRATIONS=(
  20260616_staff_locale_access_code.sql
  20260617_prima_nota_locale_access_code.sql
  20260710_warehouse_movements.sql
  20260710_supplier_payments_workbook.sql
  20260710_supplier_order_items_volume_liters.sql
  20260712_supplier_multi_contacts.sql
)

log "Migrazioni SQL su database $DB_NAME"
for name in "${SAFE_MIGRATIONS[@]}"; do
  file="$MIG_DIR/$name"
  if [[ ! -f "$file" ]]; then
    warn "File migrazione assente: $file"
    continue
  fi
  log "Applico $name"
  if sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$file"; then
    echo "    OK"
  else
    warn "Migrazione fallita: $name (verifica permessi DB)"
    exit 1
  fi
done

log "Migrazioni completate."

if [[ -f "$APP_DIR/deploy/ensure-prima-nota-locale-table.sh" ]]; then
  log "Permessi e tabella codici Prima Nota (owner app user)"
  DB_NAME="$DB_NAME" bash "$APP_DIR/deploy/ensure-prima-nota-locale-table.sh"
fi
