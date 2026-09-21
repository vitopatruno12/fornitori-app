#!/usr/bin/env bash
# Wrapper agente Pagamenti + banca (systemd / cron).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi
BACKEND="$APP_DIR/backend"
PY="$BACKEND/venv/bin/python"
if [[ ! -x "$PY" && -x "$BACKEND/.venv/bin/python" ]]; then
  PY="$BACKEND/.venv/bin/python"
fi
if [[ ! -x "$PY" ]]; then
  echo "ERRORE: python venv non trovato in $BACKEND" >&2
  exit 1
fi
cd "$BACKEND"
exec "$PY" "$BACKEND/scripts/pagamenti_bank_watch_agent.py" "$@"
