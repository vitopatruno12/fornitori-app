# Diagnosi rapida 502 ATLAS API (eseguire sul server)
set +e
echo "=== systemd (fornitori / atlas / uvicorn) ==="
systemctl list-units --type=service --all 2>/dev/null | grep -iE 'fornitor|atlas|uvicorn' || true
echo
for s in fornitori-api atlas-api fornitori-app; do
  if systemctl cat "$s" >/dev/null 2>&1; then
    echo "--- status $s ---"
    systemctl is-active "$s"
    systemctl --no-pager -l status "$s" | head -n 25
  fi
done
echo
echo "=== porta 8000 ==="
ss -lntp 2>/dev/null | grep -E ':8000\b' || netstat -lntp 2>/dev/null | grep -E ':8000\b' || echo "nessun listen su 8000"
echo
echo "=== health locale ==="
curl -sS -m 3 http://127.0.0.1:8000/health || echo "FAIL local /health"
curl -sS -m 3 http://127.0.0.1:8000/api/health || echo "FAIL local /api/health"
echo
echo "=== ultimi log fornitori-api ==="
journalctl -u fornitori-api -n 40 --no-pager 2>/dev/null || true
echo
echo "=== syntax check .env ENABLE/BANK lines ==="
grep -nE '^(BANK_|ENABLE_BANKING_|DATABASE_URL)' /opt/fornitori-app/backend/.env 2>/dev/null | sed 's/PASSWORD=.*/PASSWORD=***/;s/TOKEN=.*/TOKEN=***/' || true
