#!/usr/bin/env bash
# Rende leggibili le chiavi Enable Banking (.pem) all'utente di fornitori-api.
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

API_USER="$(systemctl show -p User --value fornitori-api 2>/dev/null || true)"
API_USER="${API_USER:-fornitori}"
API_GROUP="$(systemctl show -p Group --value fornitori-api 2>/dev/null || true)"
API_GROUP="${API_GROUP:-$API_USER}"

if [[ ! -d "$KEYS_DIR" ]]; then
  echo "AVVISO: manca $KEYS_DIR — niente da fare"
  exit 0
fi

# Directory traversabile (senza listare a terzi se 711; 750 se gruppo API)
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
