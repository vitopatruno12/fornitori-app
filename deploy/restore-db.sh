#!/usr/bin/env bash
#
# restore-db.sh
# Importa un dump SQL (formato plain di pg_dump) nel database fornitori_db.
#
# Uso:
#   sudo bash restore-db.sh /percorso/backup_fornitori.sql
#
# Se ci sono dati nel DB, vengono DROPpati prima dell'import.
# Lo script chiede conferma esplicita.

set -euo pipefail

DUMP_FILE="${1:-}"
DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
    echo "Uso: sudo bash $0 /percorso/backup.sql"
    exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "Devi essere root (usa: sudo)"
    exit 1
fi

log "Verifica connessione DB"
sudo -u postgres psql -d "$DB_NAME" -c "SELECT current_database()" >/dev/null

ROW_COUNT=$(sudo -u postgres psql -tA -d "$DB_NAME" -c \
    "SELECT coalesce(sum(n_live_tup),0) FROM pg_stat_user_tables" 2>/dev/null || echo 0)

if [[ "$ROW_COUNT" -gt 0 ]]; then
    echo
    echo "ATTENZIONE: il database $DB_NAME contiene gia' circa $ROW_COUNT righe."
    echo "Procedendo verra' fatto DROP SCHEMA public CASCADE."
    read -r -p "Vuoi continuare? scrivi YES in maiuscolo per confermare: " confirm
    [[ "$confirm" == "YES" ]] || { echo "Annullato."; exit 1; }
fi

log "DROP schema public + CREATE schema vuoto"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public AUTHORIZATION $DB_USER;
GRANT ALL ON SCHEMA public TO $DB_USER;
GRANT ALL ON SCHEMA public TO public;
SQL

log "Import del dump $DUMP_FILE"
# Eseguiamo l'import come $DB_USER cosi' gli oggetti hanno il giusto owner.
# Sed strippa direttive \restrict / \unrestrict (introdotte da pg_dump >=18,
# non riconosciute da psql 16).
sed -E '/^\\(restrict|unrestrict)\b/d' "$DUMP_FILE" \
    | sudo -u postgres PGPASSWORD= psql -v ON_ERROR_STOP=1 -d "$DB_NAME"

log "Riallineamento ownership e sequenze"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
DO \$\$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO $DB_USER', r.tablename);
  END LOOP;
  FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO $DB_USER', r.sequence_name);
  END LOOP;
END
\$\$;
SQL

log "Conteggio tabelle e righe dopo import"
sudo -u postgres psql -d "$DB_NAME" <<SQL
SELECT count(*) AS num_tables FROM information_schema.tables WHERE table_schema='public';
SELECT relname AS table_name, n_live_tup AS rows
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC, relname
  LIMIT 30;
SQL

echo
echo "================================================================"
echo "  Import completato. Ricorda di:"
echo "  - Riavviare il backend:  systemctl restart fornitori-api"
echo "  - Verificare:            curl http://127.0.0.1:8000/health"
echo "================================================================"
