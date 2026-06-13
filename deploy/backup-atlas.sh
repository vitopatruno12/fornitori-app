#!/usr/bin/env bash
#
# backup-atlas.sh — Backup completo ATLAS prima del deploy.
#
# Include:
#   - Database PostgreSQL (turni, fornitori, Prima Nota, ordini, fatture…)
#   - File caricati (PDF fatture, allegati, XML SDI, fatture tecnici…)
#   - Configurazione backend (.env)
#
# Output (stesso timestamp):
#   backups/atlas_YYYYMMDD_HHMMSS/
#     database.sql.gz
#     uploads.tar.gz          (se presente)
#     env.backup              (se presente)
#     manifest.txt
#   backups/atlas_YYYYMMDD_HHMMSS.tar.gz   (archivio unico)
#
# Uso:
#   sudo APP_DIR=/var/www/app-fornitori/fornitori-app bash deploy/backup-atlas.sh
#
# Cron giornaliero (opzionale):
#   30 3 * * * APP_DIR=/var/www/.../fornitori-app /path/deploy/backup-atlas.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi

DB_NAME="${DB_NAME:-fornitori_db}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BUNDLE_DIR="$BACKUP_DIR/atlas_${TIMESTAMP}"
ARCHIVE="$BACKUP_DIR/atlas_${TIMESTAMP}.tar.gz"
MANIFEST_LINES=()

UPLOADS_DIR="$APP_DIR/backend/app/uploads"
ENV_FILE="$APP_DIR/backend/.env"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

mkdir -p "$BACKUP_DIR"
mkdir -p "$BUNDLE_DIR"
chmod 700 "$BUNDLE_DIR"

# --- 1. Database PostgreSQL ---
log "Backup database PostgreSQL ($DB_NAME)"
if systemctl is-active --quiet postgresql 2>/dev/null || pg_isready -q 2>/dev/null; then
  sudo -u postgres pg_dump -F p -d "$DB_NAME" | gzip -9 > "$BUNDLE_DIR/database.sql.gz"
  gzip -t "$BUNDLE_DIR/database.sql.gz"
  MANIFEST_LINES+=("database: ok ($(du -h "$BUNDLE_DIR/database.sql.gz" | cut -f1))")
else
  MANIFEST_LINES+=("database: SKIPPED (PostgreSQL non attivo)")
  printf "\033[1;33mPostgreSQL non attivo: salto dump database.\033[0m\n"
fi

# --- 2. File caricati (uploads) ---
log "Backup file caricati (uploads)"
if [[ -d "$UPLOADS_DIR" ]] && [[ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null || true)" ]]; then
  tar -czf "$BUNDLE_DIR/uploads.tar.gz" -C "$UPLOADS_DIR" .
  MANIFEST_LINES+=("uploads: ok $(du -h "$BUNDLE_DIR/uploads.tar.gz" | cut -f1) da $UPLOADS_DIR")
else
  MANIFEST_LINES+=("uploads: SKIPPED (cartella vuota o assente)")
fi

# --- 3. Configurazione .env ---
log "Backup configurazione (.env)"
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$BUNDLE_DIR/env.backup"
  chmod 600 "$BUNDLE_DIR/env.backup"
  MANIFEST_LINES+=("env: ok")
else
  MANIFEST_LINES+=("env: SKIPPED (file assente)")
fi

# --- Manifest ---
{
  echo "atlas_backup_timestamp=$TIMESTAMP"
  echo "app_dir=$APP_DIR"
  echo "created_at=$(date -Is)"
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "git_head=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
    echo "git_subject=$(git -C "$APP_DIR" log -1 --format='%s' 2>/dev/null || echo '?')"
  fi
  echo ""
  echo "Componenti:"
  for line in "${MANIFEST_LINES[@]}"; do
    echo "  $line"
  done
  echo ""
  echo "NOTA: i backup locali browser (Personale/Prima Nota in localStorage)"
  echo "restano sui dispositivi degli utenti; non sono sul server."
} > "$BUNDLE_DIR/manifest.txt"

# --- Archivio unico ---
log "Creazione archivio completo"
tar -czf "$ARCHIVE" -C "$BACKUP_DIR" "atlas_${TIMESTAMP}"
chmod 600 "$ARCHIVE"

# --- Rotazione ---
find "$BACKUP_DIR" -maxdepth 1 -type d -name 'atlas_*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'atlas_*.tar.gz' -mtime "+$KEEP_DAYS" -delete
# Mantieni anche i vecchi dump solo-DB per compatibilità
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'fornitori_*.sql.gz' -mtime "+$KEEP_DAYS" -delete

log "Backup completo ATLAS"
echo "  Cartella: $BUNDLE_DIR"
echo "  Archivio: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo "[$(date -Is)] backup-atlas ok"
