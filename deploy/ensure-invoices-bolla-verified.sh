#!/usr/bin/env bash
# Aggiunge invoices.bolla_verified (spunta Bolla d. in Fatture da pagare).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
MIG="$APP_DIR/backend/migrations/20260926_invoices_bolla_verified.sql"

log() { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERRORE: %s\033[0m\n" "$*" >&2; }

if [[ -f "$MIG" ]]; then
  log "Applico migrazione $MIG su $DB_NAME"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$MIG"
else
  log "Migrazione assente, applico SQL inline su $DB_NAME"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS bolla_verified BOOLEAN;

UPDATE invoices
SET bolla_verified = FALSE
WHERE bolla_verified IS NULL;

ALTER TABLE invoices
ALTER COLUMN bolla_verified SET DEFAULT FALSE;

ALTER TABLE invoices
ALTER COLUMN bolla_verified SET NOT NULL;
SQL
fi

if ! sudo -u postgres psql -tAc \
  "SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='bolla_verified'" \
  -d "$DB_NAME" | grep -q 1; then
  err "Colonna bolla_verified ancora assente."
  exit 1
fi

log "OK: invoices.bolla_verified presente."
