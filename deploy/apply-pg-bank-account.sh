#!/usr/bin/env bash
# Installa su produzione la chiave Enable Banking e il profilo BPPB di PG S.R.L.
# Uso (dopo aver caricato il .pem in /tmp):
#   sudo bash deploy/apply-pg-bank-account.sh
#   # oppure:
#   PEM_SRC=/tmp/82c21178-2e47-44e6-a73d-396be16ccf96.pem sudo bash deploy/apply-pg-bank-account.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
KEYS_DIR="$APP_DIR/backend/keys"
PROFILES="$KEYS_DIR/bank_profiles.json"
APP_ID="82c21178-2e47-44e6-a73d-396be16ccf96"
PEM_NAME="${APP_ID}.pem"
PEM_SRC="${PEM_SRC:-/tmp/${PEM_NAME}}"

if [[ ! -f "$PEM_SRC" ]]; then
  echo "ERRORE: manca PEM $PEM_SRC"
  exit 1
fi

mkdir -p "$KEYS_DIR"
install -m 600 "$PEM_SRC" "$KEYS_DIR/$PEM_NAME"
# L'API gira come User=fornitori: root:root 600 → Permission denied in lettura
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$APP_DIR" bash "$SCRIPT_DIR/ensure-enable-banking-key-perms.sh"
echo "OK: PEM → $KEYS_DIR/$PEM_NAME"

if [[ ! -f "$PROFILES" ]]; then
  if [[ -f "$KEYS_DIR/bank_profiles.example.json" ]]; then
    cp -a "$KEYS_DIR/bank_profiles.example.json" "$PROFILES"
    chmod 600 "$PROFILES"
    echo "OK: creato $PROFILES da example"
  else
    echo "ERRORE: manca $PROFILES"
    exit 1
  fi
fi

cp -a "$PROFILES" "$PROFILES.bak.$(date +%Y%m%d%H%M%S)"

PROFILES_PATH="$PROFILES" python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["PROFILES_PATH"])
rows = json.loads(path.read_text(encoding="utf-8"))
if not isinstance(rows, list):
    raise SystemExit("bank_profiles.json non è una lista")

profile = {
    "id": "bppb_pg",
    "label": "BPPB — PG S.R.L. (Gazza Ladra)",
    "company": "pg",
    "bank_name": "BPPB - Banca Popolare di Puglia e Basilicata",
    "iban": "IT92F0538516000CC1410004516",
    "account_number": "CC1410004516",
    "username": "",
    "password": "",
    "portal_url": "",
    "enable_banking_app_id": "82c21178-2e47-44e6-a73d-396be16ccf96",
    "enable_banking_key_path": "./keys/82c21178-2e47-44e6-a73d-396be16ccf96.pem",
    "enabled": True,
}

out = []
replaced = False
for row in rows:
    if isinstance(row, dict) and row.get("id") == "bppb_pg":
        merged = dict(row)
        merged.update(profile)
        out.append(merged)
        replaced = True
    else:
        out.append(row)
if not replaced:
    out.append(profile)

path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("OK: profilo bppb_pg in bank_profiles.json")
PY

chmod 600 "$PROFILES"

# Crea il conto in DB se manca (seed canonico)
VENV="$APP_DIR/backend/venv"
[[ -x "$APP_DIR/backend/.venv/bin/python" ]] && VENV="$APP_DIR/backend/.venv"
if [[ -x "$VENV/bin/python" ]]; then
  (
    cd "$APP_DIR/backend"
    # shellcheck disable=SC1091
    set -a
    [[ -f .env ]] && source .env
    set +a
    "$VENV/bin/python" - <<'PY'
from app.database import SessionLocal
from app.services.banca_service import ensure_canonical_bank_accounts, ensure_known_account_companies

db = SessionLocal()
try:
    created = ensure_canonical_bank_accounts(db)
    aligned = ensure_known_account_companies(db)
    print(f"OK: seed conti created={created} company_aligned={aligned}")
finally:
    db.close()
PY
  ) || echo "AVVISO: seed DB non eseguito (verrà creato al primo accesso a Conti)"
fi

systemctl restart fornitori-api 2>/dev/null || systemctl restart atlas-api 2>/dev/null || true
echo
echo "Fatto. In Atlas → Banca → Conti: apri PG · Gazza Ladra e Collega Enable Banking (BPPB)."
echo "IBAN IT92F0538516000CC1410004516 · SWIFT BPDMIT3B"
