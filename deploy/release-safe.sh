#!/usr/bin/env bash
#
# release-safe.sh — Deploy sicuro ATLAS (frontend + opzionale restart API).
#
# GARANTISCE: il database PostgreSQL NON viene cancellato né sovrascritto.
# Aggiorna solo il codice (git pull + build frontend). Opzionale backup automatico.
#
# Uso sul server (es. www.atlass.it):
#   cd /var/www/app-fornitori/fornitori-app
#   sudo APP_DIR=/var/www/app-fornitori/fornitori-app bash deploy/release-safe.sh
#
# Solo frontend (default):
#   sudo bash deploy/release-safe.sh
#
# Frontend + restart API backend:
#   sudo RESTART_API=1 bash deploy/release-safe.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi

RESTART_API="${RESTART_API:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
BRANCH="${BRANCH:-main}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "ERRORE: $APP_DIR non è un repository git."
  exit 1
fi

echo "================================================================"
echo "  DEPLOY SICURO ATLAS"
echo "  I dati nel database PostgreSQL (turni, dipendenti, fornitori,"
echo "  Prima Nota, ordini, fatture...) RESTANO INTATTI."
echo "  Vengono aggiornati solo i file dell'applicazione."
echo "================================================================"
echo "  APP_DIR: $APP_DIR"
echo "================================================================"

if [[ "$SKIP_BACKUP" != "1" ]] && [[ -f "$APP_DIR/deploy/backup-db.sh" ]]; then
  if systemctl is-active --quiet postgresql 2>/dev/null || pg_isready -q 2>/dev/null; then
    log "Backup automatico database prima del deploy"
    BACKUP_DIR="$APP_DIR/backups" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/backup-db.sh" || {
      warn "ATTENZIONE: backup non riuscito. Deploy continua (il DB non viene modificato)."
    }
  else
    warn "PostgreSQL non attivo: salto backup (il deploy non tocca comunque il database)."
  fi
else
  warn "Backup saltato (SKIP_BACKUP=1 o script backup assente)."
fi

log "Aggiornamento codice (git pull origin $BRANCH)"
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" checkout "$BRANCH"
git -C "$APP_DIR" pull --ff-only origin "$BRANCH"

log "Build frontend (file statici in frontend/dist)"
APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/build-frontend.sh"

if [[ "$RESTART_API" == "1" ]]; then
  log "Restart API (fornitori-api) — create_all aggiunge solo tabelle/colonne mancanti, non cancella dati"
  if systemctl list-unit-files fornitori-api.service &>/dev/null; then
    systemctl restart fornitori-api
    sleep 2
    systemctl --no-pager --full status fornitori-api | head -12 || true
  else
    warn "Servizio fornitori-api non trovato. Salto restart."
  fi
fi

echo ""
echo "================================================================"
echo "  Deploy completato. Database PostgreSQL invariato."
echo "  Backup in: $APP_DIR/backups/"
echo ""
echo "  NON usare restore-db.sh per aggiornare: cancella tutti i dati!"
echo "  Utenti: pulsante «Aggiornamento» nell'app per la nuova versione."
echo "================================================================"
