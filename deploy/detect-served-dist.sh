#!/usr/bin/env bash
# Trova le cartelle frontend/dist di ATLAS referenziate da Nginx o Caddy.
# Esclude altri siti sullo stesso server (es. wemake, corevian).
set -euo pipefail

# True se il path appartiene ad ATLAS / fornitori-app (non ad altri progetti).
is_atlas_dist_root() {
  local path="$1"
  local app="${APP_DIR:-/var/www/app-fornitori/fornitori-app}"
  case "$path" in
    */wemake/*|*/wemakee/*|*/corevian/*|/var/www/nat/*|/var/www/nat)
      return 1
      ;;
  esac
  if [[ -n "$app" && "$path" == "$app/frontend/dist" ]]; then
    return 0
  fi
  case "$path" in
    */app-fornitori/*/frontend/dist|*/fornitori-app/frontend/dist|/opt/fornitori-app/frontend/dist)
      return 0
      ;;
  esac
  return 1
}

collect_served_dist_roots() {
  local cfg served roots=()
  for cfg in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/caddy/Caddyfile; do
    [[ -f "$cfg" ]] || continue
    if grep -q 'frontend/dist' "$cfg" 2>/dev/null; then
      while IFS= read -r served; do
        [[ -n "$served" ]] || continue
        is_atlas_dist_root "$served" || continue
        roots+=("$served")
      done < <(grep -E 'root\s+' "$cfg" 2>/dev/null | grep -o '/[^;[:space:]]*frontend/dist' || true)
      while IFS= read -r served; do
        [[ -n "$served" ]] || continue
        is_atlas_dist_root "$served" || continue
        roots+=("$served")
      done < <(grep -E 'root \*' "$cfg" 2>/dev/null | grep -o '/[^[:space:]]*frontend/dist' || true)
    fi
  done
  if ((${#roots[@]} == 0)); then
    return 1
  fi
  printf '%s\n' "${roots[@]}" | awk '!seen[$0]++'
}

detect_served_dist_root() {
  collect_served_dist_roots | head -1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  collect_served_dist_roots || exit 1
fi
