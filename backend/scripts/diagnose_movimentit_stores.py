#!/usr/bin/env python3
"""Diagnostica colonne cassa/negozio in MOVIMENTIT (da PC cassa Abba).

Uso:
  cd C:\\AtlasSync
  py -u diagnose_movimentit_stores.py
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if (_HERE / "app").is_dir():
    ROOT = _HERE
elif (_HERE.parent / "app").is_dir():
    ROOT = _HERE.parent
else:
    ROOT = _HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_dotenv() -> None:
    for p in (Path(__file__).with_name(".env"), ROOT / ".env"):
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
    from app.services.easyretail_gdb_service import (
        connect_gdb,
        discover_receipt_mapping,
        resolve_fbclient,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        cur = con.cursor()
        mapping = discover_receipt_mapping(cur)
        table = mapping["table"]
        cols = list(mapping.get("columns") or [])
        print(f"table={table}")
        print(f"store_mapping={mapping.get('store')}")
        print(f"colonne ({len(cols)}): {', '.join(cols)}")

        interest = [
            c
            for c in cols
            if any(
                k in c.upper()
                for k in (
                    "POS",
                    "CASSA",
                    "NEGOZ",
                    "SEDE",
                    "PDV",
                    "POSTAZ",
                    "MAGAZZ",
                    "AZIENDA",
                    "FILIALE",
                    "PUNTO",
                )
            )
        ]
        print(f"\ncandidate ({len(interest)}): {', '.join(interest) or '(nessuna)'}")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        ts_col = mapping.get("ts") or mapping.get("date")
        doc = mapping.get("doc_type")
        where = []
        params = []
        if ts_col:
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.replace(tzinfo=None) if mapping.get("ts") else cutoff.date())
        if doc:
            where.append(f"{doc} = 'VEN'")
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        for col in interest[:20]:
            try:
                sql = f"SELECT FIRST 5000 {col} FROM {table}{where_sql}"
                cur.execute(sql, params)
                cnt = Counter()
                for (val,) in cur.fetchall():
                    key = "(vuoto)" if val is None or str(val).strip() == "" else str(val).strip()
                    cnt[key] += 1
                top = cnt.most_common(12)
                print(f"\n{col}: {dict(top)}")
            except Exception as exc:
                print(f"\n{col}: ERRORE {exc}")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
