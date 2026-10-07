#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cerca nel GDB EasyRetail i totali della LETTURA OPERATORE (carta).

Obiettivo: trovare tabelle/colonne = CONTANTI / CARTA / INCASSO / IN CASSA
cosi Atlas puo allinearsi da solo senza digitare la lettura ogni sera.

Sul PC cassa (C:\\AtlasSync):

  py -u diagnose_lettura_giornate.py
  set DIAG_DAY=2026-10-07
  py -u diagnose_lettura_giornate.py

Non stampa la password del database.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
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

_HINTS = (
    "GIORNAT",
    "CHIUSUR",
    "TOTAL",
    "RAPPORTO",
    "LETTURA",
    "XREPORT",
    "ZREPORT",
    "INCASS",
    "CASSA",
    "BANCOM",
    "CONTANT",
    "FORMEPAG",
)


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


def _cell(value, limit: int = 40) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def main() -> int:
    _load_dotenv()
    from app.services.easyretail_gdb_service import (
        _list_user_tables,
        _table_columns,
        connect_gdb,
        resolve_fbclient,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    day_raw = (os.getenv("DIAG_DAY") or "").strip()[:10]
    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        cur = con.cursor()
        tables = _list_user_tables(cur)
        print(f"gdb={dsn}")
        print(f"tabelle={len(tables)} day_filter={day_raw or '(nessuno)'}")
        print("\n=== tabelle candidate lettura/chiusura/totali ===")
        candidates = []
        for t in tables:
            u = t.upper()
            if any(h in u for h in _HINTS):
                candidates.append(t)
                print(" ", t)
        if not candidates:
            print("  (nessuna — elenco completo sample)")
            candidates = [t for t in tables if "GIORN" in t.upper() or "POS" in t.upper()][:20]

        money_needles = (
            "CONTANT",
            "BANCOM",
            "CARTA",
            "INCASS",
            "CASSA",
            "TOTALE",
            "IMPORTO",
            "ELETTRON",
            "POS",
            "FATTUR",
        )
        for name in candidates[:40]:
            try:
                cols = _table_columns(cur, name)
            except Exception as exc:
                print(f"\n{name}: errore colonne {exc}")
                continue
            interesting = [c for c in cols if any(n in c.upper() for n in money_needles)]
            print(f"\n=== {name} ({len(cols)} col) ===")
            print("  colonne:", ", ".join(cols[:40]), ("…" if len(cols) > 40 else ""))
            if interesting:
                print("  € candidate:", ", ".join(interesting))
            show = interesting[:10] if interesting else cols[:12]
            if not show:
                continue
            # prefer date-ish columns for ORDER BY
            order = None
            for c in cols:
                cu = c.upper()
                if "DATA" in cu or cu.endswith("ORA") or "GIORN" in cu:
                    order = c
                    break
            sql = f"SELECT FIRST 5 {', '.join(show)} FROM {name}"
            if order:
                sql += f" ORDER BY {order} DESC"
            try:
                cur.execute(sql)
                rows = cur.fetchall()
            except Exception as exc:
                print(f"  sample: {exc}")
                continue
            for row in rows:
                print("  ", " | ".join(_cell(v) for v in row))

            if day_raw and order:
                try:
                    day = datetime.strptime(day_raw, "%Y-%m-%d")
                    nxt = day + timedelta(days=1)
                    cur.execute(
                        f"SELECT FIRST 20 {', '.join(show)} FROM {name} "
                        f"WHERE {order} >= ? AND {order} < ?",
                        [day, nxt],
                    )
                    day_rows = cur.fetchall()
                    print(f"  filtro {day_raw}: {len(day_rows)} righe")
                    for row in day_rows[:8]:
                        print("   *", " | ".join(_cell(v) for v in row))
                except Exception as exc:
                    print(f"  filtro giorno: {exc}")

        print(
            "\nFine. Incolla questo output in chat: "
            "cosi colleghiamo CONTANTI/CARTA della carta alla tabella giusta."
        )
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
