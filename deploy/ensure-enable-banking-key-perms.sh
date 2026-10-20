#!/usr/bin/env bash
# Rende leggibili le chiavi Enable Banking (.pem) all'utente che esegue l'API.
# Causa tipica di 502: install -m 600 + chown root:root → Permission denied.
#
# Uso:
#   sudo bash deploy/ensure-enable-banking-key-perms.sh
#   sudo APP_DIR=/opt/fornitori-app bash deploy/ensure-enable-banking-key-perms.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/backend/keys" && -d /var/www/app-fornitori/fornitori-app/backend/keys ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi
KEYS_DIR="$APP_DIR/backend/keys"

resolve_api_user() {
  local u g s
  for s in fornitori-api atlas-api fornitori-app; do
    u="$(systemctl show -p User --value "$s" 2>/dev/null || true)"
    if [[ -n "$u" ]] && id -u "$u" &>/dev/null; then
      g="$(systemctl show -p Group --value "$s" 2>/dev/null || true)"
      echo "${u}:${g:-$u}"
      return 0
    fi
  done
  # Processo uvicorn/API in ascolto su 8000
  u="$(ps -o user= -C uvicorn 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  if [[ -n "$u" ]] && id -u "$u" &>/dev/null; then
    echo "${u}:${u}"
    return 0
  fi
  # Owner della cartella backend (spesso mic04 in produzione)
  if [[ -d "$APP_DIR/backend" ]]; then
    u="$(stat -c '%U' "$APP_DIR/backend" 2>/dev/null || true)"
    if [[ -n "$u" && "$u" != "root" ]] && id -u "$u" &>/dev/null; then
      echo "${u}:${u}"
      return 0
    fi
  fi
  for u in mic04 www-data fornitori; do
    if id -u "$u" &>/dev/null; then
      echo "${u}:${u}"
      return 0
    fi
  done
  return 1
}

OWNER="$(resolve_api_user || true)"
if [[ -z "${OWNER:-}" ]]; then
  echo "ERRORE: nessun utente API valido (fornitori/mic04/…)."
  echo "  Controlla: systemctl show -p User --value fornitori-api"
  echo "             ps -o user= -C uvicorn"
  exit 1
fi
API_USER="${OWNER%%:*}"
API_GROUP="${OWNER#*:}"

if [[ ! -d "$KEYS_DIR" ]]; then
  echo "AVVISO: manca $KEYS_DIR — niente da fare"
  exit 0
fi

echo "API user: $API_USER:$API_GROUP  keys: $KEYS_DIR"

chmod 750 "$KEYS_DIR" 2>/dev/null || true
chown "$API_USER:$API_GROUP" "$KEYS_DIR" 2>/dev/null || true

shopt -s nullglob
pem_files=("$KEYS_DIR"/*.pem)
profile_files=("$KEYS_DIR"/bank_profiles.json)
shopt -u nullglob

n=0
for f in "${pem_files[@]}" "${profile_files[@]}"; do
  [[ -e "$f" ]] || continue
  chown "$API_USER:$API_GROUP" "$f"
  chmod 600 "$f"
  n=$((n + 1))
  echo "OK: $f → $API_USER:$API_GROUP mode 600"
done

if [[ "$n" -eq 0 ]]; then
  echo "AVVISO: nessun .pem / bank_profiles.json in $KEYS_DIR"
else
  echo "OK: $n file Enable Banking leggibili da $API_USER"
fi
