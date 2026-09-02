#!/usr/bin/env bash
# Trova tutte le cartelle frontend/dist referenziate da Nginx o Caddy.
set -euo pipefail

collect_served_dist_roots() {
  local cfg served roots=()
  for cfg in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/caddy/Caddyfile; do
    [[ -f "$cfg" ]] || continue
    if grep -q 'frontend/dist' "$cfg" 2>/dev/null; then
      while IFS= read -r served; do
        [[ -n "$served" ]] || continue
        roots+=("$served")
      done < <(grep -E 'root\s+' "$cfg" 2>/dev/null | grep -o '/[^;[:space:]]*frontend/dist' || true)
      while IFS= read -r served; do
        [[ -n "$served" ]] || continue
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
