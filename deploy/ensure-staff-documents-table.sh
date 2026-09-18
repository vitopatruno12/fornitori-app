#!/usr/bin/env bash
# Crea staff_documents (contratti / buste paga / documenti personale) se manca.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"
MIG="$APP_DIR/backend/migrations/20260918_staff_documents.sql"

log() { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }
err() { printf "\033[1;31mERRORE: %s\033[0m\n" "$*" >&2; }

if [[ ! -f "$MIG" ]]; then
  err "Migrazione assente: $MIG — esegui git pull"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  err "psql non trovato"
  exit 1
fi

log "Applico staff_documents su $DB_NAME"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$MIG"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE IF EXISTS staff_documents OWNER TO "$DB_USER";
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'staff_documents_id_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE staff_documents_id_seq OWNER TO "$DB_USER"';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE staff_documents_id_seq TO "$DB_USER"';
  END IF;
END
\$\$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE staff_documents TO "$DB_USER";
SQL

log "OK staff_documents"
