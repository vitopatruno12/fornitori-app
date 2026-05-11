#!/usr/bin/env bash
#
# backup-db.sh
# Dump giornaliero del DB compresso. Mantiene gli ultimi 14 dump.
#
# Installazione cron (come root):
#   sudo install -m 755 /opt/fornitori-app/deploy/backup-db.sh /usr/local/sbin/fornitori-backup
#   echo "30 3 * * * /usr/local/sbin/fornitori-backup >> /var/log/fornitori-backup.log 2>&1" | sudo tee /etc/cron.d/fornitori-backup
#   sudo chmod 644 /etc/cron.d/fornitori-backup
#
# Output:
#   /opt/fornitori-app/backups/fornitori_YYYYMMDD_HHMMSS.sql.gz

set -euo pipefail

DB_NAME="${DB_NAME:-fornitori_db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fornitori-app/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/fornitori_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump via utente postgres (peer auth, niente password in chiaro)
sudo -u postgres pg_dump -F p -d "$DB_NAME" | gzip -9 > "$OUT"

# Verifica integrita' base
gzip -t "$OUT"

# Rotazione: cancella i dump piu' vecchi di KEEP_DAYS giorni
find "$BACKUP_DIR" -type f -name 'fornitori_*.sql.gz' -mtime "+$KEEP_DAYS" -delete

# Permessi solo proprietario
chmod 600 "$OUT"

echo "[$(date -Is)] backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
