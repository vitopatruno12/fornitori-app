#!/usr/bin/env bash
# Build frontend produzione (HTTPS /api) — da eseguire sul server DOPO git pull.
# NON tocca PostgreSQL: turni, fornitori, Prima Nota e ordini restano nel database.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
if [[ ! -d "$APP_DIR/.git" && -d /var/www/app-fornitori/fornitori-app/.git ]]; then
  APP_DIR="/var/www/app-fornitori/fornitori-app"
fi
DIST_DIR="$APP_DIR/frontend/dist"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "ERRORE: $APP_DIR non è un repo git. Imposta APP_DIR corretto."
  exit 1
fi

GIT_HEAD="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
GIT_SUBJECT="$(git -C "$APP_DIR" log -1 --format='%s' 2>/dev/null || echo '?')"
echo "==> Repo: $APP_DIR @ $GIT_HEAD — $GIT_SUBJECT"
echo "==> Sicurezza dati: aggiornamento SOLO frontend statico; PostgreSQL non viene modificato."

cd "$APP_DIR/frontend"

if ! command -v npm >/dev/null 2>&1; then
  echo "Installa Node.js 20+ (es. apt install nodejs npm o nvm)"
  exit 1
fi

echo "==> npm ci && npm run build"
npm ci
npm run build

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "ERRORE: build fallita — manca $DIST_DIR/index.html"
  exit 1
fi

if [[ ! -f "$DIST_DIR/sw.js" || ! -f "$DIST_DIR/manifest.webmanifest" ]]; then
  echo "ATTENZIONE: PWA non generata (mancano sw.js o manifest.webmanifest)"
else
  echo "==> PWA OK: sw.js e manifest.webmanifest presenti"
fi

echo "==> Build OK: $DIST_DIR"
ls -la "$DIST_DIR/index.html"

# Verifica che il bundle contenga le modifiche Personale recenti
if grep -rq "Carica in settimana" "$DIST_DIR/assets/" 2>/dev/null; then
  echo "==> Verifica OK: trovato «Carica in settimana» nel bundle"
else
  echo "ATTENZIONE: «Carica in settimana» NON trovato in dist/assets — git pull aggiornato?"
  echo "    Esegui: cd $APP_DIR && git fetch origin && git log -1 --oneline && git pull origin main"
fi

# Confronto con tutte le root Nginx/Caddy (causa frequente: build in cartella diversa da quella servita)
warned_mismatch=0
for cfg in /etc/nginx/sites-enabled/* /etc/caddy/Caddyfile; do
  [[ -f "$cfg" ]] || continue
  if grep -q 'frontend/dist' "$cfg" 2>/dev/null; then
    while IFS= read -r served; do
      [[ -n "$served" ]] || continue
      if [[ "$served" != "$DIST_DIR" ]]; then
        if [[ "$warned_mismatch" == "0" ]]; then
          echo ""
          echo "================================================================"
          echo "  ATTENZIONE: Nginx/Caddy serve cartelle DIVERSE dal build!"
          echo "  Build:   $DIST_DIR"
          warned_mismatch=1
        fi
        echo "  Servito: $served  (in $cfg)"
        echo "  Copia:   sudo rsync -a --delete \"$DIST_DIR/\" \"$served/\""
      else
        echo "==> Web server root OK: $served"
      fi
    done < <(grep -E 'root\s+' "$cfg" 2>/dev/null | grep -o '/[^;[:space:]]*frontend/dist' || true)
    while IFS= read -r served; do
      [[ -n "$served" ]] || continue
      if [[ "$served" != "$DIST_DIR" ]]; then
        if [[ "$warned_mismatch" == "0" ]]; then
          echo ""
          echo "================================================================"
          echo "  ATTENZIONE: Nginx/Caddy serve cartelle DIVERSE dal build!"
          echo "  Build:   $DIST_DIR"
          warned_mismatch=1
        fi
        echo "  Servito: $served  (in $cfg)"
        echo "  Copia:   sudo rsync -a --delete \"$DIST_DIR/\" \"$served/\""
      fi
    done < <(grep -E 'root \*' "$cfg" 2>/dev/null | grep -o '/[^;[:space:]]*frontend/dist' || true)
  fi
done
if [[ "$warned_mismatch" == "1" ]]; then
  echo "================================================================"
fi

echo ""
echo "    Poi: sudo systemctl reload nginx   (o reload caddy)"
echo "    Browser: Ctrl+Shift+R su https://www.atlass.it"
