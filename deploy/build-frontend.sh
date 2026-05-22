#!/usr/bin/env bash
# Build frontend produzione (HTTPS /api) — da eseguire sul server dopo git pull.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
cd "$APP_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "Installa Node.js 20+ (es. apt install nodejs npm o nvm)"
  exit 1
fi

echo "==> npm ci && npm run build"
npm ci
npm run build

echo "==> Build in $APP_DIR/frontend/dist"
echo "    Configura Caddy: root * $APP_DIR/frontend/dist + reverse_proxy /api/*"
