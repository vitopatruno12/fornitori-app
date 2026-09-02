#!/usr/bin/env bash
# Trova la cartella frontend/dist effettivamente servita da Nginx o Caddy.
set -euo pipefail

detect_served_dist_root() {
  local cfg served=""
  for cfg in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/caddy/Caddyfile; do
    [[ -f "$cfg" ]] || continue
    if grep -q 'frontend/dist' "$cfg" 2>/dev/null; then
      served="$(grep -E 'root\s+' "$cfg" 2>/dev/null | grep -o '/[^;[:space:]]*frontend/dist' | head -1 || true)"
      if [[ -z "$served" ]]; then
        served="$(grep -E 'root \*' "$cfg" 2>/dev/null | grep -o '/[^[:space:]]*frontend/dist' | head -1 || true)"
      fi
      if [[ -n "$served" ]]; then
        echo "$served"
        return 0
      fi
    fi
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  detect_served_dist_root || exit 1
fi
