#!/usr/bin/env bash
# Diagnostica: perché il frontend in produzione non mostra le ultime modifiche.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"

echo "=== Diagnostica frontend ATLAS ==="
echo ""

if [[ -d "$APP_DIR/.git" ]]; then
  echo "Git ($APP_DIR):"
  git -C "$APP_DIR" log -1 --oneline
  git -C "$APP_DIR" status -sb
else
  echo "ATTENZIONE: $APP_DIR non esiste o non è un repo git"
fi
echo ""

for dist in \
  "$APP_DIR/frontend/dist" \
  /opt/fornitori-app/frontend/dist \
  /var/www/app-fornitori/fornitori-app/frontend/dist; do
  if [[ -d "$dist" ]]; then
    echo "dist: $dist"
    ls -la "$dist/index.html" 2>/dev/null || true
    if grep -rq "Carica in settimana" "$dist/assets/" 2>/dev/null; then
      echo "  ✓ bundle contiene «Carica in settimana»"
    else
      echo "  ✗ bundle NON contiene «Carica in settimana» (build vecchio?)"
    fi
    if grep -rq "Giorni settimana" "$dist/assets/" 2>/dev/null; then
      echo "  ✓ bundle contiene «Giorni settimana»"
    fi
    echo ""
  fi
done

echo "Config web server (root frontend/dist):"
for cfg in /etc/nginx/sites-enabled/* /etc/caddy/Caddyfile; do
  [[ -f "$cfg" ]] || continue
  if grep -q 'frontend/dist' "$cfg" 2>/dev/null; then
    echo "--- $cfg ---"
    grep -E 'root\s+|server_name' "$cfg" | head -5
    echo ""
  fi
done

if command -v curl >/dev/null 2>&1; then
  echo "HTML live (www.atlass.it) — script principale:"
  curl -fsS "https://www.atlass.it/" 2>/dev/null | grep -oE 'assets/[^"]+\.js' | head -3 || echo "  (curl fallito o nessun asset)"
fi

echo ""
echo "Commit atteso su GitHub: 25ad1c0 (Personale Carica in settimana)"
echo "Se git log locale è più vecchio: cd $APP_DIR && git pull origin main"
echo "Poi: sudo APP_DIR=$APP_DIR bash deploy/build-frontend.sh"
