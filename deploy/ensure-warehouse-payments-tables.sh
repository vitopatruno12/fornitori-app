#!/usr/bin/env bash
# Crea/aggiorna tabelle schema Atlas e assegna ownership all'utente app (fornitori_user).
# Copre magazzino, pagamenti, ordini, staff, banca, carriers, fatture elettroniche, POS.
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
  warn "psql non trovato: salto migrazioni schema."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1" >/dev/null 2>&1; then
  warn "Impossibile connettersi a PostgreSQL come postgres: salto migrazioni schema."
  exit 0
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  warn "Database '$DB_NAME' non trovato: salto migrazioni schema."
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
    warn "File migrazione assente (salto): $file"
    return 0
  fi
  log "Applico $name"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$file"
}

log "Migrazioni schema Atlas su $DB_NAME (owner $DB_USER)"

for mig in \
  20260616_staff_locale_access_code.sql \
  20260617_prima_nota_locale_access_code.sql \
  20260710_warehouse_movements.sql \
  20260710_supplier_payments_workbook.sql \
  20260710_supplier_order_items_volume_liters.sql \
  20260712_supplier_multi_contacts.sql \
  20260723_staff_member_section.sql \
  20260723_bank_module.sql \
  20260729_staff_stipendi_months.sql \
  20260902_staff_stipendi_locale.sql \
  20260812_carriers.sql \
  20260812_electronic_invoices.sql \
  20260812_sdi_electronic_invoice_link.sql \
  20260816_pos_receipts.sql
do
  _apply_sql_file "$mig"
done

_grant_table() {
  local table="$1"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
ALTER TABLE IF EXISTS ${table} OWNER TO "$DB_USER";
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = '${table}_id_seq' AND c.relkind = 'S'
  ) THEN
    EXECUTE 'ALTER SEQUENCE ${table}_id_seq OWNER TO "$DB_USER"';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE ${table}_id_seq TO "$DB_USER"';
  END IF;
END
\$\$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO "$DB_USER";
SQL
}

for table in \
  warehouse_movements \
  supplier_payments_workbooks \
  staff_stipendi_months \
  staff_payroll_months \
  staff_locale_packs \
  staff_backups \
  bank_accounts \
  bank_movements \
  carriers \
  carrier_maintenance_logs \
  carrier_fuel_expenses \
  carrier_other_expenses \
  electronic_invoices \
  incoming_invoices \
  incoming_invoice_lines \
  pos_receipts \
  prima_nota_locale_packs
do
  if sudo -u postgres psql -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table'" \
    -d "$DB_NAME" | grep -q 1; then
    _grant_table "$table"
  else
    warn "Tabella $table assente dopo CREATE (verifica migrazione)."
  fi
done

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE supplier_order_items TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE suppliers TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE deliveries TO "$DB_USER";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sdi_invoices TO "$DB_USER";
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

for col in phones_json emails_json cities_json merchandise_categories_json; do
  if ! sudo -u postgres psql -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = '$col'" \
    -d "$DB_NAME" | grep -q 1; then
    err "Colonna suppliers.$col ancora assente."
    exit 1
  fi
done

log "OK: schema Atlas aggiornato e ownership assegnata a $DB_USER."
