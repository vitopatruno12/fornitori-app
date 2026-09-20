#!/usr/bin/env bash
# Crea tabelle conservazione sostitutiva e assegna ownership all'utente app.
# Uso:
#   sudo APP_DIR=/var/www/app-fornitori/fornitori-app bash deploy/ensure-conservation-tables.sh
#   # oppure (API systemd):
#   sudo APP_DIR=/opt/fornitori-app bash deploy/ensure-conservation-tables.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"
MIG="$APP_DIR/backend/migrations/20260915_conservation_packages.sql"

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

[[ -f "$MIG" ]] || { err "Migrazione assente: $MIG — esegui git pull su $APP_DIR"; exit 1; }

log "APP_DIR=$APP_DIR"
log "Applico conservation_packages su $DB_NAME (owner $DB_USER)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$MIG"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE IF EXISTS conservation_packages OWNER TO "$DB_USER";
ALTER TABLE IF EXISTS conservation_package_items OWNER TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conservation_packages TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conservation_package_items TO "$DB_USER";
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'conservation_packages_id_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE conservation_packages_id_seq OWNER TO "$DB_USER"';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE conservation_packages_id_seq TO "$DB_USER"';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'conservation_package_items_id_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE conservation_package_items_id_seq OWNER TO "$DB_USER"';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE conservation_package_items_id_seq TO "$DB_USER"';
  END IF;
END
\$\$;
SQL

log "Verifica tabelle"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c \
  "SELECT 'conservation_packages' AS t, COUNT(*) AS n FROM conservation_packages
   UNION ALL
   SELECT 'conservation_package_items', COUNT(*) FROM conservation_package_items;"

log "OK: tabelle conservazione presenti e accessibili"
