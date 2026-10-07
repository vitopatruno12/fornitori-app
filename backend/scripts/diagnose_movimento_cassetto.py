#!/usr/bin/env python3
"""Trova in EasyRetail i movimenti cassetto scritti in cassa.

Sul PC cassa (stessa cartella e .env dell'agent AtlasSync):

  cd C:\\AtlasSync
  py -u diagnose_movimento_cassetto.py

Giorno preciso (quello della chiusura con MOV. CASSETTO):

  set DIAG_DAY=2026-10-06
  py -u diagnose_movimento_cassetto.py

Stampa solo tipi documento, codici movimento e causali.
Non stampa la password del database.
"""

from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
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

_TABLE_HINTS = (
    "CASSA",
    "CASSET",
    "PRELIEV",
    "VERSAMENT",
    "CAUSAL",
    "CODICEMOV",
    "CODICIMOV",
    "FONDOCASSA",
)
_TEXT_HINTS = ("DESCR", "CAUSAL", "NOTE", "INTEST", "NOME", "MOVIMENTO")
_SKIP_DOC = {"VEN", "VEA", "BIL"}
_SAMPLE_WORDS = ("CASSET", "PRELIEV", "VERSAMENT", "FONDO", "CASSA")


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


def _cell(value, limit: int = 80) -> str:
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
        discover_receipt_mapping,
        resolve_fbclient,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante nel .env di AtlasSync", file=sys.stderr)
        return 2

    day_raw = (os.getenv("DIAG_DAY") or "").strip()
    hours = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS") or "72")
    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        cur = con.cursor()
        tables = {t.upper(): t for t in _list_user_tables(cur)}
        mapping = discover_receipt_mapping(cur)
        table = mapping["table"]
        cols = list(mapping.get("columns") or [])
        col_u = {c.upper(): c for c in cols}
        ts_col = mapping.get("ts") or mapping.get("date")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO") or col_u.get("TOTALEIVATO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        store = mapping.get("store")
        code = col_u.get("CODICEMOVIMENTO")
        code_n = col_u.get("NUMEROCODICEMOVIMENTO")
        text_cols = [
            c
            for c in cols
            if any(h in c.upper() for h in _TEXT_HINTS)
        ][:6]

        print(f"table={table}")
        print(f"ts={ts_col} amount={amt} doc={doc} store={store}")
        print(f"codice={code} numero_codice={code_n}")
        print(f"testo={text_cols}")

        where = []
        params: list = []
        if day_raw:
            day = datetime.strptime(day_raw, "%Y-%m-%d")
            nxt = day + timedelta(days=1)
            if ts_col and mapping.get("ts"):
                where.append(f"{ts_col} >= ? AND {ts_col} < ?")
                params.extend([day, nxt])
            elif ts_col:
                where.append(f"{ts_col} >= ? AND {ts_col} < ?")
                params.extend([day.date(), nxt.date()])
            print(f"giorno={day_raw}")
        else:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
            if ts_col and mapping.get("ts"):
                where.append(f"{ts_col} >= ?")
                params.append(cutoff.replace(tzinfo=None))
            elif ts_col:
                where.append(f"{ts_col} >= ?")
                params.append(cutoff.date())
            print(f"lookback_h={hours}")
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        print("\n=== tabelle che possono essere il cassetto ===")
        hinted = [
            name
            for upper, name in sorted(tables.items())
            if any(h in upper for h in _TABLE_HINTS)
        ]
        if not hinted:
            print("  nessuna tabella con nome cassa/cassetto/prelievo/causale")
        for name in hinted[:25]:
            tcols = _table_columns(cur, name)
            print(f"\n{name}")
            print("  colonne:", ", ".join(tcols[:24]))
            show = tcols[:8]
            if not show:
                continue
            try:
                cur.execute(f"SELECT FIRST 12 {', '.join(show)} FROM {name}")
                rows = cur.fetchall()
            except Exception as exc:
                print(f"  lettura saltata: {exc}")
                continue
            print(f"  righe campione={len(rows)}")
            for row in rows:
                print("   ", " | ".join(_cell(v, 40) for v in row))

        if doc:
            print(f"\n=== {doc} nel periodo ===")
            select = [doc]
            if amt:
                select.append(amt)
            sql = f"SELECT FIRST 30000 {', '.join(select)} FROM {table}{where_sql}"
            cur.execute(sql, params)
            by_doc = defaultdict(lambda: {"n": 0, "tot": 0.0})
            for row in cur.fetchall():
                dtype = "(vuoto)" if row[0] is None or str(row[0]).strip() == "" else str(row[0]).strip()
                by_doc[dtype]["n"] += 1
                if amt:
                    try:
                        by_doc[dtype]["tot"] += float(row[1] or 0)
                    except (TypeError, ValueError):
                        pass
            for dtype, hit in sorted(by_doc.items(), key=lambda kv: -kv[1]["n"]):
                mark = "" if dtype.upper() in _SKIP_DOC else "  <-- fuori dallo scarico attuale"
                print(f"  {dtype}: n={hit['n']} tot≈{hit['tot']:.2f}{mark}")

        if code or code_n:
            print("\n=== codice movimento nel periodo ===")
            parts = [c for c in (doc, code, code_n, amt) if c]
            sql = f"SELECT FIRST 30000 {', '.join(parts)} FROM {table}{where_sql}"
            cur.execute(sql, params)
            by_code = Counter()
            totals = defaultdict(float)
            for row in cur.fetchall():
                idx = 0
                dtype = ""
                if doc:
                    dtype = "" if row[idx] is None else str(row[idx]).strip()
                    idx += 1
                bits = [dtype or "-"]
                if code:
                    bits.append("" if row[idx] is None else str(row[idx]).strip())
                    idx += 1
                if code_n:
                    bits.append("" if row[idx] is None else str(row[idx]).strip())
                    idx += 1
                key = " | ".join(bits)
                by_code[key] += 1
                if amt:
                    try:
                        totals[key] += float(row[idx] or 0)
                    except (TypeError, ValueError):
                        pass
            for key, n in by_code.most_common(40):
                print(f"  n={n:5d} tot≈{totals[key]:10.2f}  {key}")

        print("\n=== campioni che non sono scontrini/preventivi ===")
        sample_cols = [c for c in (ts_col, store, doc, code, code_n, amt, *text_cols) if c]
        # unique, keep order
        seen = set()
        ordered = []
        for c in sample_cols:
            if c not in seen:
                seen.add(c)
                ordered.append(c)
        if doc and ordered:
            sql = f"SELECT FIRST 80 {', '.join(ordered)} FROM {table}{where_sql}"
            extra = ""
            extra_params = list(params)
            if where_sql:
                extra = f" AND UPPER({doc}) NOT IN ('VEN', 'VEA', 'BIL')"
            else:
                extra = f" WHERE UPPER({doc}) NOT IN ('VEN', 'VEA', 'BIL')"
            try:
                cur.execute(sql + extra + (f" ORDER BY {ts_col} DESC" if ts_col else ""), extra_params)
                rows = cur.fetchall()
            except Exception as exc:
                print(f"  campioni saltati: {exc}")
                rows = []
            print(f"  righe={len(rows)}")
            print("  colonne:", " | ".join(ordered))
            for row in rows[:40]:
                print("   ", " | ".join(_cell(v) for v in row))
            if not rows:
                print("  nessun documento fuori da VEN/VEA/BIL in questo periodo")

        print("\nFine. Incolla questo testo in chat (senza altre schermate della cassa).")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
