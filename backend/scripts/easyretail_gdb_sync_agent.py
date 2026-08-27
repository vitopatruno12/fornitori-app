#!/usr/bin/env python3
"""Agent sync EasyRetail GDB → ATLAS (da eseguire sul PC cassa).

Esempio (Task Scheduler ogni 3 minuti):
  python easyretail_gdb_sync_agent.py

Variabili (o file .env accanto allo script):
  ATLAS_API_BASE=https://www.atlass.it/api
  EASYRETAIL_SYNC_TOKEN=...          # stesso token sul server
  EASYRETAIL_GDB_PATH=C:\\EasyRetail\\DBase\\DBRETAIL.GDB
  EASYRETAIL_FBCLIENT=C:\\EasyRetail\\DBase\\fbclient.dll
  EASYRETAIL_MODEL_ID=model-2        # opzionale: Mani in Pasta
  EASYRETAIL_GDB_LOOKBACK_HOURS=48
  EASYRETAIL_GDB_USER=SYSDBA
  EASYRETAIL_GDB_PASSWORD=masterkey
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Root = cartella che contiene `app/`
# - repo: backend/scripts/agent.py → backend/
# - PC cassa flat: C:\AtlasSync\agent.py → C:\AtlasSync\ (con app\ accanto)
_HERE = Path(__file__).resolve().parent
if (_HERE / "app").is_dir():
    ROOT = _HERE
elif (_HERE.parent / "app").is_dir():
    ROOT = _HERE.parent
else:
    ROOT = _HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dotenv():
    for p in (Path(__file__).with_name(".env"), ROOT / ".env", ROOT / "app" / ".." / ".env"):
        p = p.resolve()
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def main() -> int:
    _load_dotenv()
    api = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
    token = (os.getenv("EASYRETAIL_SYNC_TOKEN") or os.getenv("POS_RECEIPTS_SYNC_TOKEN") or "").strip()
    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: imposta EASYRETAIL_GDB_PATH (es. C:\\EasyRetail\\DBase\\DBRETAIL.GDB)", file=sys.stderr)
        return 2
    if not token:
        print("ERRORE: imposta EASYRETAIL_SYNC_TOKEN (stesso valore sul server ATLAS)", file=sys.stderr)
        return 2

    from app.services.easyretail_gdb_service import fetch_receipts_from_gdb

    lookback = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS", "48") or "48")
    model_id = (os.getenv("EASYRETAIL_MODEL_ID") or "").strip() or None
    rows, meta = fetch_receipts_from_gdb(
        dsn=dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=(os.getenv("EASYRETAIL_FBCLIENT") or None),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
        lookback_hours=lookback,
        default_model_id=model_id,
    )

    payload = {
        "model_id": model_id,
        "receipts": [
            {
                **{k: v for k, v in r.items() if k != "receipt_at" and k != "amount_eur"},
                "receipt_at": r["receipt_at"].astimezone(timezone.utc).isoformat()
                if isinstance(r.get("receipt_at"), datetime)
                else r.get("receipt_at"),
                "amount_eur": float(r["amount_eur"]) if r.get("amount_eur") is not None else None,
            }
            for r in rows
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{api}/pos-receipts/ingest",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Atlas-Sync-Token": token,
            "User-Agent": "atlas-easyretail-gdb-agent/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"OK fetched={meta.get('fetched')} table={meta.get('table')} → {body}")
            return 0
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {err}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
