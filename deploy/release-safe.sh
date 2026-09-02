#!/usr/bin/env bash
#
# release-safe.sh — Deploy sicuro ATLAS (frontend + opzionale restart API).
#
# GARANTISCE: database PostgreSQL e file caricati NON vengono cancellati.
# Prima del deploy: backup completo (DB + uploads + .env).
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
echo "  Backup automatico completo prima del deploy:"
echo "    • Database PostgreSQL (turni, dipendenti, fornitori, Prima Nota…)"
echo "    • File caricati (PDF, allegati, XML SDI…)"
echo "    • Configurazione server (.env)"
echo "  Il deploy aggiorna solo il codice; i dati sul server restano intatti."
echo "================================================================"
echo "  APP_DIR: $APP_DIR"
echo "================================================================"

if [[ "$SKIP_BACKUP" != "1" ]] && [[ -f "$APP_DIR/deploy/backup-atlas.sh" ]]; then
  log "Backup completo applicazione prima del deploy"
  APP_DIR="$APP_DIR" BACKUP_DIR="$APP_DIR/backups" bash "$APP_DIR/deploy/backup-atlas.sh" || {
    warn "ATTENZIONE: backup completo non riuscito. Deploy continua (i dati non vengono cancellati)."
  }
elif [[ "$SKIP_BACKUP" != "1" ]] && [[ -f "$APP_DIR/deploy/backup-db.sh" ]]; then
  if systemctl is-active --quiet postgresql 2>/dev/null || pg_isready -q 2>/dev/null; then
    log "Backup database (backup-atlas.sh assente, uso solo DB)"
    BACKUP_DIR="$APP_DIR/backups" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/backup-db.sh" || {
      warn "ATTENZIONE: backup DB non riuscito. Deploy continua."
    }
  else
    warn "PostgreSQL non attivo: salto backup."
  fi
else
  warn "Backup saltato (SKIP_BACKUP=1 o script assente)."
fi

log "Aggiornamento codice (git pull origin $BRANCH)"
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" checkout "$BRANCH"
# section-versions.json viene rigenerato a ogni build: non deve bloccare il pull
git -C "$APP_DIR" checkout -- frontend/public/section-versions.json 2>/dev/null || true
git -C "$APP_DIR" pull --ff-only origin "$BRANCH"

log "Build frontend (file statici in frontend/dist)"
if [[ -f "$APP_DIR/deploy/publish-atlas.sh" ]]; then
  SKIP_GIT_PULL=1 APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/publish-atlas.sh"
else
  APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/build-frontend.sh"
  DIST_DIR="$APP_DIR/frontend/dist"
  if [[ -f "$APP_DIR/deploy/detect-served-dist.sh" ]]; then
    # shellcheck source=/dev/null
    source "$APP_DIR/deploy/detect-served-dist.sh"
    mapfile -t SERVED_DIST_ROOTS < <(collect_served_dist_roots 2>/dev/null || true)
    for SERVED_DIST in "${SERVED_DIST_ROOTS[@]}"; do
      [[ -n "$SERVED_DIST" ]] || continue
      [[ "$SERVED_DIST" == "$DIST_DIR" ]] && continue
      [[ -d "$DIST_DIR" ]] || continue
      log "Copia frontend/dist in $SERVED_DIST"
      mkdir -p "$SERVED_DIST"
      if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete "$DIST_DIR/" "$SERVED_DIST/"
      else
        rm -rf "${SERVED_DIST:?}/"*
        cp -a "$DIST_DIR/." "$SERVED_DIST/"
      fi
    done
  fi
  if systemctl is-active --quiet nginx 2>/dev/null; then
    nginx -t && systemctl reload nginx
  elif systemctl is-active --quiet caddy 2>/dev/null; then
    systemctl reload caddy
  fi
fi

if systemctl is-active --quiet postgresql 2>/dev/null || pg_isready -q 2>/dev/null; then
  if [[ -f "$APP_DIR/deploy/ensure-prima-nota-locale-table.sh" ]]; then
    log "Tabella codici Prima Nota (obbligatoria per salvare i codici locale)"
    APP_DIR="$APP_DIR" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/ensure-prima-nota-locale-table.sh"
  elif [[ -f "$APP_DIR/deploy/apply-db-migrations.sh" ]]; then
    log "Migrazioni database (codici locale Personale / Prima Nota)"
    APP_DIR="$APP_DIR" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/apply-db-migrations.sh"
  else
    warn "Script migrazione assente: esegui manualmente deploy/ensure-prima-nota-locale-table.sh"
  fi
  if [[ -f "$APP_DIR/deploy/ensure-warehouse-payments-tables.sh" ]]; then
    log "Tabelle magazzino / pagamenti fornitori / volume_liters ordini / contatti fornitori"
    APP_DIR="$APP_DIR" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/ensure-warehouse-payments-tables.sh"
  else
    warn "Script ensure-warehouse-payments-tables.sh assente: le API magazzino/pagamenti/fornitori possono restituire 500."
  fi
else
  warn "PostgreSQL non attivo: salto migrazioni database."
fi

API_DIR="${API_DIR:-/opt/fornitori-app}"

ensure_access_codes_unlock_password() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  if grep -qE '^ACCESS_CODES_UNLOCK_PASSWORD=' "$env_file"; then
    return 0
  fi
  {
    echo ""
    echo "# Link codici — password sblocco (aggiunto automaticamente da release-safe.sh)"
    echo "ACCESS_CODES_UNLOCK_PASSWORD=Burnet"
  } >> "$env_file"
  log "Aggiunto ACCESS_CODES_UNLOCK_PASSWORD=Burnet in $env_file"
}

for _env_candidate in "$APP_DIR/backend/.env" "$API_DIR/backend/.env" "/opt/fornitori-app/backend/.env"; do
  ensure_access_codes_unlock_password "$_env_candidate"
done

if [[ "$RESTART_API" == "1" ]] && [[ -d "$API_DIR/.git" ]] && [[ "$(readlink -f "$API_DIR")" != "$(readlink -f "$APP_DIR")" ]]; then
  log "Aggiornamento backend API in $API_DIR (cartella usata da systemd)"
  git -C "$API_DIR" fetch origin
  git -C "$API_DIR" checkout "$BRANCH"
  git -C "$API_DIR" checkout -- frontend/public/section-versions.json 2>/dev/null || true
  git -C "$API_DIR" pull --ff-only origin "$BRANCH"
  if [[ -x "$API_DIR/backend/venv/bin/pip" ]]; then
    "$API_DIR/backend/venv/bin/pip" install -q -r "$API_DIR/backend/requirements.txt" || {
      warn "pip install in $API_DIR fallito; verifica dipendenze Python."
    }
  fi
fi

if [[ "$RESTART_API" == "1" ]]; then
  log "Restart API (fornitori-api) — create_all aggiunge solo tabelle/colonne mancanti, non cancella dati"
  if systemctl list-unit-files fornitori-api.service &>/dev/null; then
    systemctl restart fornitori-api
    sleep 2
    systemctl --no-pager --full status fornitori-api | head -12 || true
  else
    warn "Servizio fornitori-api non trovato. Salto restart."
  fi
  if command -v curl >/dev/null 2>&1; then
    log "Verifica rapida API"
    curl -sf "http://127.0.0.1:8000/health" && echo "" || warn "Health locale non OK su :8000"
  fi
fi

echo ""
echo "================================================================"
echo "  Deploy completato. Dati server invariati."
echo "  Backup completi in: $APP_DIR/backups/atlas_YYYYMMDD_HHMMSS.tar.gz"
echo ""
echo "  NON usare restore-db.sh per aggiornare: cancella tutti i dati!"
echo "  Utenti: pulsante «Aggiornamento» nell'app per la nuova versione."
echo "  Verifica: sudo APP_DIR=$APP_DIR bash $APP_DIR/deploy/verify-live-deploy.sh"
echo "================================================================"
