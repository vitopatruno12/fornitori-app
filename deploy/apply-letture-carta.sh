#!/usr/bin/env bash
# Allinea Prima Nota ai seed carta (tutti i giorni in paper_closing_overrides).
# Uso:
#   cd /var/www/app-fornitori/fornitori-app
#   sudo bash deploy/apply-letture-carta.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKEND="$APP_DIR/backend"

PY=""
for candidate in \
  "$BACKEND/venv/bin/python" \
  "$BACKEND/.venv/bin/python" \
  "$APP_DIR/venv/bin/python" \
  "$APP_DIR/.venv/bin/python"
do
  if [[ -x "$candidate" ]]; then
    PY="$candidate"
    break
  fi
done

if [[ -z "$PY" ]]; then
  echo "ERRORE: python venv non trovato sotto $APP_DIR" >&2
  ls -la "$BACKEND/venv/bin/python" "$BACKEND/.venv/bin/python" 2>/dev/null || true
  exit 1
fi

echo "Uso: $PY"
cd "$BACKEND"
exec "$PY" scripts/apply_lettura_7_ottobre.py
