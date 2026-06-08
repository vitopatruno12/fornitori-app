#!/usr/bin/env bash
# Trova chi occupa la porta 8000 e quale servizio systemd lo gestisce.
set -euo pipefail

PORT="${1:-8000}"

echo "==> Porta $PORT"
ss -tlnp "sport = :$PORT" 2>/dev/null || ss -tlnp | grep ":$PORT " || true
echo

pids="$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
if [[ -z "$pids" ]]; then
  echo "Nessun processo in ascolto su $PORT."
  exit 0
fi

for pid in $pids; do
  echo "==> PID $pid"
  ps -o pid,ppid,user,etime,cmd -p "$pid" 2>/dev/null || true
  if [[ -r "/proc/$pid/cgroup" ]]; then
    echo "cgroup:"
    cat "/proc/$pid/cgroup"
  fi
  if command -v systemctl &>/dev/null; then
    echo "systemd unit:"
    systemctl status "$pid" --no-pager 2>/dev/null | head -5 || echo "(non gestito da systemd o permessi insufficienti)"
  fi
  echo
done

echo "==> Servizi systemd (fornitori / uvicorn / api)"
systemctl list-units --type=service --all 2>/dev/null | grep -iE 'fornitor|uvicorn|atlass|api' || true
echo
echo "==> Unit file con uvicorn o :8000"
grep -rlE 'uvicorn|:8000' /etc/systemd/system/ 2>/dev/null || true
