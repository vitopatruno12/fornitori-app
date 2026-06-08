#!/usr/bin/env bash
# Verifica che /api/suppliers risponda JSON (non 307 verso /suppliers/ né HTML SPA).
set -euo pipefail

BASE="${1:-https://www.atlass.it}"

echo "==> Health: $BASE/api/health"
curl -sfS "$BASE/api/health" | head -c 200
echo ""

echo "==> Suppliers (headers):"
curl -sS -D - -o /tmp/atlas-suppliers-body.json "$BASE/api/suppliers" | head -n 20
echo "==> Body (primi 200 byte):"
head -c 200 /tmp/atlas-suppliers-body.json
echo ""

if head -c 20 /tmp/atlas-suppliers-body.json | grep -qi '<!doctype\|<html'; then
  echo "ERRORE: risposta HTML — proxy /api non punta a FastAPI (vedi deploy/nginx-atlass.example)"
  exit 1
fi

if curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/suppliers" | grep -q '^200$'; then
  echo "OK: /api/suppliers → 200 JSON"
else
  echo "ERRORE: status non 200 su /api/suppliers"
  exit 1
fi
