#!/usr/bin/env python3
"""Elimina scontrini model-2 errati (erano Mucche importati come Mani).

Uso (dopo deploy API sul server):
  set EASYRETAIL_SYNC_TOKEN=...
  python fix_wrong_model2_receipts.py

Oppure con .env accanto (stesso token del sync agent).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def _load_dotenv():
    for p in (Path(__file__).with_name(".env"), Path(r"C:\AtlasSync\.env")):
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def main() -> int:
    _load_dotenv()
    api = (os.getenv("ATLAS_API_BASE") or "https://www.atlass.it/api").rstrip("/")
    token = (os.getenv("EASYRETAIL_SYNC_TOKEN") or "").strip()
    if not token:
        print("ERRORE: manca EASYRETAIL_SYNC_TOKEN", file=sys.stderr)
        return 2
    data = json.dumps({"model_id": "model-2", "confirm": "DELETE"}).encode("utf-8")
    req = urllib.request.Request(
        f"{api}/pos-receipts/purge-model",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Atlas-Sync-Token": token,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(resp.read().decode("utf-8", errors="replace"))
            return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
