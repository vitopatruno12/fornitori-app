#!/usr/bin/env bash
#
# Pubblica il frontend ATLAS su www.atlass.it
#
# Uso (sul server narcil):
#   cd /var/www/app-fornitori/fornitori-app
#   git pull --ff-only origin main
#   sudo APP_DIR=/var/www/app-fornitori/fornitori-app bash deploy/publish-atlas.sh
#
# Opzionale: cartelle extra dove copiare il dist (separate da spazio)
#   sudo ATLAS_EXTRA_DIST="/percorso/altro/frontend/dist" APP_DIR=... bash deploy/publish-atlas.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
PUBLIC_URL="${PUBLIC_URL:-https://www.atlass.it}"
BRANCH="${BRANCH:-main}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m%s\033[0m\n" "$*"; }
fail() { printf "\033[1;31m%s\033[0m\n" "$*"; exit 1; }

if [[ ! -d "$APP_DIR/.git" ]]; then
  fail "ERRORE: $APP_DIR non è un repository git ATLAS."
fi

if [[ "${SKIP_GIT_PULL:-0}" != "1" ]]; then
  log "Aggiornamento codice ATLAS (branch $BRANCH)"
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" checkout -- frontend/public/section-versions.json 2>/dev/null || true
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  echo "Git: $(git -C "$APP_DIR" rev-parse --short HEAD) — $(git -C "$APP_DIR" log -1 --format='%s')"
else
  log "Skip git pull (già aggiornato da release-safe)"
fi

log "Build frontend ATLAS"
APP_DIR="$APP_DIR" bash "$APP_DIR/deploy/build-frontend.sh"

DIST_DIR="$APP_DIR/frontend/dist"
[[ -f "$DIST_DIR/index.html" ]] || fail "Build fallita: manca $DIST_DIR/index.html"

LOCAL_BUILD="$(grep -o '"build": "[^"]*"' "$DIST_DIR/section-versions.json" | head -1 || true)"
log "Build locale: ${LOCAL_BUILD:-?}"

publish_to() {
  local target="$1"
  [[ -n "$target" ]] || return 0
  # Non toccare mai altri siti sullo stesso server (wemake, ecc.)
  case "$target" in
    */wemake/*|*/wemakee/*|*/corevian/*|/var/www/nat/*)
      warn "Salto pubblicazione su sito non-ATLAS: $target"
      return 0
      ;;
  esac
  if [[ "$target" == "$DIST_DIR" ]]; then
    log "Già servito da: $target"
    return 0
  fi
  log "Pubblico ATLAS in: $target"
  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$DIST_DIR/" "$target/"
  else
    rm -rf "${target:?}/"*
    cp -a "$DIST_DIR/." "$target/"
  fi
}

TARGETS=()
if [[ -f "$APP_DIR/deploy/detect-served-dist.sh" ]]; then
  # shellcheck source=/dev/null
  source "$APP_DIR/deploy/detect-served-dist.sh"
  while IFS= read -r root; do
    [[ -n "$root" ]] && TARGETS+=("$root")
  done < <(collect_served_dist_roots 2>/dev/null || true)
fi

if [[ -n "${ATLAS_EXTRA_DIST:-}" ]]; then
  for extra in $ATLAS_EXTRA_DIST; do
    TARGETS+=("$extra")
  done
fi

if ((${#TARGETS[@]} == 0)); then
  warn "Nessuna cartella Nginx trovata — uso solo $DIST_DIR"
  TARGETS=("$DIST_DIR")
fi

# dedup
mapfile -t TARGETS < <(printf '%s\n' "${TARGETS[@]}" | awk '!seen[$0]++')

for t in "${TARGETS[@]}"; do
  publish_to "$t"
done

if systemctl is-active --quiet nginx 2>/dev/null; then
  log "Reload Nginx"
  nginx -t
  systemctl reload nginx
elif systemctl is-active --quiet caddy 2>/dev/null; then
  log "Reload Caddy"
  systemctl reload caddy
fi

log "Verifica pubblicazione su $PUBLIC_URL"
if command -v curl >/dev/null 2>&1; then
  PUBLIC_BUILD="$(curl -sf "${PUBLIC_URL}/section-versions.json?ts=$(date +%s)" | grep -o '"build": "[^"]*"' | head -1 || true)"
  echo "Build pubblica: ${PUBLIC_BUILD:-ERRORE}"
  if [[ -n "$LOCAL_BUILD" && -n "$PUBLIC_BUILD" && "$LOCAL_BUILD" == "$PUBLIC_BUILD" ]]; then
    echo ""
    echo "================================================================"
    echo "  OK: ATLAS pubblicato correttamente su $PUBLIC_URL"
    echo "  Su ogni PC/postazione: pulsante «Aggiornamento» (↻) o Ctrl+Shift+R"
    echo "================================================================"
  else
    echo ""
    echo "================================================================"
    fail "ATTENZIONE: build pubblica DIVERSA da quella locale.
  Locale:  $LOCAL_BUILD
  Online:  $PUBLIC_BUILD

  Controlla quale cartella serve atlass.it:
    grep -B2 -A12 'server_name.*atlass' /etc/nginx/sites-enabled/*

  Poi ripeti con la cartella corretta:
    sudo ATLAS_EXTRA_DIST=\"/percorso/corretto/frontend/dist\" APP_DIR=$APP_DIR bash deploy/publish-atlas.sh"
  fi
else
  warn "curl non disponibile — verifica manualmente $PUBLIC_URL/section-versions.json"
fi
