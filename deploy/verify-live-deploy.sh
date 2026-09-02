#!/usr/bin/env bash
# Confronta versione git locale, build in dist e build pubblicata su www.atlass.it
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /opt/fornitori-app/.git ]]; then
  APP_DIR="/opt/fornitori-app"
fi

PUBLIC_URL="${PUBLIC_URL:-https://www.atlass.it}"
DIST_DIR="$APP_DIR/frontend/dist"
LOCAL_VERSIONS="$DIST_DIR/section-versions.json"

echo "=== Verifica deploy ATLAS ==="
echo "APP_DIR: $APP_DIR"
echo ""

if [[ -d "$APP_DIR/.git" ]]; then
  echo "Git HEAD:  $(git -C "$APP_DIR" rev-parse --short HEAD) — $(git -C "$APP_DIR" log -1 --format='%s')"
  echo "Git remote: $(git -C "$APP_DIR" rev-parse --short origin/main 2>/dev/null || echo '?')"
  behind="$(git -C "$APP_DIR" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
  if [[ "$behind" != "?" && "$behind" != "0" ]]; then
    echo "ATTENZIONE: il server è $behind commit indietro rispetto a origin/main — esegui git pull + release-safe.sh"
  fi
else
  echo "ATTENZIONE: $APP_DIR non è un repository git"
fi
echo ""

if [[ -f "$LOCAL_VERSIONS" ]]; then
  echo "Build locale (dist):"
  grep -E '"build"|"generatedAt"' "$LOCAL_VERSIONS" || true
else
  echo "ATTENZIONE: manca $LOCAL_VERSIONS — esegui deploy/build-frontend.sh"
fi
echo ""

if [[ -f "$APP_DIR/deploy/detect-served-dist.sh" ]]; then
  # shellcheck source=/dev/null
  source "$APP_DIR/deploy/detect-served-dist.sh"
  mapfile -t served_roots < <(collect_served_dist_roots 2>/dev/null || true)
  if ((${#served_roots[@]} > 0)); then
    echo "Cartelle frontend/dist in Nginx/Caddy:"
    for served in "${served_roots[@]}"; do
      echo "  - $served"
      if [[ "$served" != "$DIST_DIR" ]]; then
        echo "    ATTENZIONE: diversa dal build in $DIST_DIR"
        if [[ -f "$served/section-versions.json" ]]; then
          echo "    Build servita:"
          grep -E '"build"|"generatedAt"' "$served/section-versions.json" | sed 's/^/      /' || true
        fi
      elif [[ -f "$served/section-versions.json" ]]; then
        echo "    OK: coincide con il build locale"
      fi
    done
  else
    echo "Cartella servita: non rilevata (verifica manualmente nginx/caddy)"
  fi
fi
echo ""

if command -v curl >/dev/null 2>&1; then
  echo "Build pubblica ($PUBLIC_URL):"
  curl -sf "${PUBLIC_URL}/section-versions.json?ts=$(date +%s)" | grep -E '"build"|"generatedAt"' || echo "ERRORE: section-versions.json non raggiungibile"
fi
echo ""
echo "Dopo ogni deploy: su gestionale e postazioni operative cliccare «Aggiornamento» (PWA)."
