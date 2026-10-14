"""Dopo lo scarico AdE: chiude le fatture pagate nel file e allinea i mastrini.

Stampa solo conteggi. Non elenca fatture, fornitori o importi di riga.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "https://www.atlass.it/api"
KEYS = (
    "paid_count",
    "open_invoices_count",
    "marked_from_pagamenti",
    "pagamenti_paid_rows",
)


def align(company: str) -> int:
    url = f"{BASE}/banca/riconciliazione/auto?company={company}"
    req = urllib.request.Request(url, data=b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            payload = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        print(f"ALIGN {company} http {exc.code}", flush=True)
        return 1
    except Exception as exc:
        print(f"ALIGN {company} errore {type(exc).__name__}", flush=True)
        return 1
    bank = payload.get("bank_sync") if isinstance(payload.get("bank_sync"), dict) else {}
    parts = [f"ALIGN {company}"]
    for key in KEYS:
        if key in payload:
            parts.append(f"{key}={payload.get(key)}")
    if "marked_paid" in bank:
        parts.append(f"marked_paid={bank.get('marked_paid')}")
    if "marked_from_bank" in bank:
        parts.append(f"marked_from_bank={bank.get('marked_from_bank')}")
    if "marked_from_pagamenti" in bank:
        parts.append(f"file={bank.get('marked_from_pagamenti')}")
    print(" ".join(parts), flush=True)
    return 0


def main() -> int:
    companies = [c.strip() for c in sys.argv[1:] if c.strip()]
    if not companies:
        print("ALIGN nessuna societa", flush=True)
        return 2
    rc = 0
    for company in companies:
        if align(company) != 0:
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
