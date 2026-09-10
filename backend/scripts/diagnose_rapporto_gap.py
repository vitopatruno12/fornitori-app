#!/usr/bin/env python3
# -*- coding: ascii -*-
"""Confronta Rapporto Complessivo (Non fiscali+Preventivi) vs GDB.

Target utente:
  Abba (POS=1) ~1246 EUR
  Zanardelli (POS=2) ~701 EUR
  giorno tipico: 2026-09-10

  cd C:\\AtlasSync
  py -u diagnose_rapporto_gap.py
  set DIAG_DAY=2026-09-10 && py -u diagnose_rapporto_gap.py
"""

from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict
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


def _f(x) -> float:
    try:
        return float(x or 0)
    except Exception:
        return 0.0


def _day(x) -> str:
    return str(x)[:10] if x is not None else "?"


def main() -> int:
    _load_dotenv()
    from app.services.easyretail_gdb_service import (
        connect_gdb,
        discover_receipt_mapping,
        resolve_fbclient,
        _list_user_tables,
        _table_columns,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    day = (os.getenv("DIAG_DAY") or "2026-09-10").strip()
    day_dt = datetime.strptime(day, "%Y-%m-%d")
    day_next = day_dt + timedelta(days=1)

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
        col_u = {c.upper(): c for c in cols}
        ts = mapping.get("ts") or mapping.get("date") or col_u.get("DATAMOVIMENTO")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")
        store = mapping.get("store") or col_u.get("NUMEROPOS")
        numdoc = col_u.get("NUMDOC")
        proforma = col_u.get("PROFORMA")
        cm = col_u.get("CODICEMOVIMENTO")
        tables = {t.upper(): t for t in _list_user_tables(cur)}

        print("dsn=%s day=%s" % (dsn, day))
        print("target: Abba POS1~1246 | Zanardelli POS2~701")
        print("cols: ts=%s amt=%s doc=%s store=%s numdoc=%s proforma=%s" % (ts, amt, doc, store, numdoc, proforma))

        # --- load day rows ---
        parts = [c for c in (rid, doc, store, ts, amt, numdoc, proforma, cm) if c]
        cur.execute(
            "SELECT FIRST 50000 %s FROM %s WHERE %s >= ? AND %s < ?"
            % (", ".join(parts), table, ts, ts),
            [day_dt, day_next],
        )
        rows = cur.fetchall()
        idx = {name: i for i, name in enumerate(parts)}

        def cell(r, name):
            i = idx.get(name)
            return None if i is None else r[i]

        print("\n=== MOVIMENTIT giorno: n=%s ===" % len(rows))

        # by POS x TIPODOCUMENTO
        by = defaultdict(lambda: {"n": 0, "tot": 0.0})
        for r in rows:
            dtype = str(cell(r, doc) or "").strip() or "(vuoto)"
            pos = str(cell(r, store) if cell(r, store) is not None else "(vuoto)").strip()
            val = _f(cell(r, amt))
            key = (pos, dtype)
            by[key]["n"] += 1
            by[key]["tot"] += val

        print("\n--- per POS x TIPODOCUMENTO (importo) ---")
        for (pos, dtype), hit in sorted(by.items(), key=lambda kv: (kv[0][0], -kv[1]["tot"])):
            if hit["tot"] == 0 and dtype in ("SCA", "CHF"):
                continue
            print("  POS=%s %s: n=%s EUR %.2f" % (pos, dtype, hit["n"], hit["tot"]))

        # candidates that might match Non fiscali+Preventivi
        print("\n--- candidati Non fiscali / Preventivi ---")
        for pos in ("1", "2", "0", "(vuoto)"):
            vea = by.get((pos, "VEA"), {"n": 0, "tot": 0.0})
            print("  POS=%s VEA: n=%s EUR %.2f" % (pos, vea["n"], vea["tot"]))

        # NUMDOC=0 (no fiscal number) excluding BIL
        if numdoc:
            print("\n--- NUMDOC=0 (no num fiscale) per POS x DOC (escl. BIL se tot alto) ---")
            nd0 = defaultdict(lambda: {"n": 0, "tot": 0.0})
            for r in rows:
                if _f(cell(r, numdoc)) != 0:
                    continue
                dtype = str(cell(r, doc) or "").strip() or "(vuoto)"
                pos = str(cell(r, store) if cell(r, store) is not None else "(vuoto)").strip()
                val = _f(cell(r, amt))
                if val <= 0:
                    continue
                nd0[(pos, dtype)]["n"] += 1
                nd0[(pos, dtype)]["tot"] += val
            for (pos, dtype), hit in sorted(nd0.items(), key=lambda kv: (kv[0][0], -kv[1]["tot"])):
                print("  POS=%s %s NUMDOC=0: n=%s EUR %.2f" % (pos, dtype, hit["n"], hit["tot"]))

            # sum NUMDOC=0 non-BIL non-VEN per POS
            print("\n--- somma NUMDOC=0 AND DOC not in (VEN,BIL,SCA,CHF) ---")
            for pos in ("1", "2"):
                n = 0
                tot = 0.0
                types = Counter()
                for r in rows:
                    p = str(cell(r, store) if cell(r, store) is not None else "").strip()
                    if p != pos:
                        continue
                    if _f(cell(r, numdoc)) != 0:
                        continue
                    dtype = str(cell(r, doc) or "").strip()
                    if dtype in ("VEN", "BIL", "SCA", "CHF"):
                        continue
                    val = _f(cell(r, amt))
                    if val <= 0:
                        continue
                    n += 1
                    tot += val
                    types[dtype] += 1
                print("  POS=%s: n=%s EUR %.2f types=%s" % (pos, n, tot, dict(types)))

        # PROFORMA != 0
        if proforma:
            print("\n--- PROFORMA != 0 ---")
            pf = defaultdict(lambda: {"n": 0, "tot": 0.0, "docs": Counter()})
            for r in rows:
                pv = cell(r, proforma)
                try:
                    if pv is None or int(pv) == 0:
                        continue
                except Exception:
                    if not pv:
                        continue
                pos = str(cell(r, store) if cell(r, store) is not None else "(vuoto)").strip()
                dtype = str(cell(r, doc) or "").strip()
                val = _f(cell(r, amt))
                pf[pos]["n"] += 1
                pf[pos]["tot"] += val
                pf[pos]["docs"][dtype] += 1
            if not pf:
                print("  (nessuno)")
            for pos, hit in sorted(pf.items()):
                print("  POS=%s: n=%s EUR %.2f docs=%s" % (pos, hit["n"], hit["tot"], dict(hit["docs"])))

        # VEN without payment lines (possible non-fiscal twin / unpaid?)
        pay_table = tables.get("PAGAMENTI")
        if pay_table and rid and store and doc and amt:
            print("\n--- VEN del giorno SENZA riga in PAGAMENTI ---")
            try:
                pcols = {c.upper(): c for c in _table_columns(cur, pay_table)}
                pmov = pcols.get("NUMEROMOVIMENTO")
                if pmov:
                    cur.execute(
                        "SELECT FIRST 50000 %s, %s, %s FROM %s WHERE %s >= ? AND %s < ? AND %s = 'VEN'"
                        % (rid, store, amt, table, ts, ts, doc),
                        [day_dt, day_next],
                    )
                    ven_rows = cur.fetchall()
                    ids = [r[0] for r in ven_rows if r[0] is not None]
                    paid = set()
                    # chunk IN lists
                    for i in range(0, len(ids), 800):
                        chunk = ids[i : i + 800]
                        marks = ",".join("?" * len(chunk))
                        cur.execute(
                            "SELECT DISTINCT %s FROM %s WHERE %s IN (%s)"
                            % (pmov, pay_table, pmov, marks),
                            chunk,
                        )
                        for (mid,) in cur.fetchall():
                            paid.add(mid)
                    orphan = defaultdict(lambda: {"n": 0, "tot": 0.0})
                    for mid, pos, val in ven_rows:
                        if mid in paid:
                            continue
                        p = str(pos if pos is not None else "(vuoto)").strip()
                        orphan[p]["n"] += 1
                        orphan[p]["tot"] += _f(val)
                    if not orphan:
                        print("  (tutti i VEN hanno PAGAMENTI)")
                    for p, hit in sorted(orphan.items()):
                        print("  POS=%s VEN no-pay: n=%s EUR %.2f" % (p, hit["n"], hit["tot"]))
            except Exception as exc:
                print("  ERRORE: %s" % exc)

        # ACCONTIPREVENTIVI
        ap = tables.get("ACCONTIPREVENTIVI")
        if ap:
            print("\n--- ACCONTIPREVENTIVI ---")
            try:
                acols = _table_columns(cur, ap)
                print("  cols:", ", ".join(acols[:40]))
                cur.execute("SELECT FIRST 20 * FROM %s" % ap)
                sample = cur.fetchall()
                print("  sample_n=%s" % len(sample))
                for r in sample[:5]:
                    print(" ", r[:15])
                # try date columns
                acu = {c.upper(): c for c in acols}
                date_c = None
                for cand in ("DATAMOVIMENTO", "DATA", "DATADOCUMENTO", "DATAACCONTO", "INSTABLOG"):
                    if cand in acu:
                        date_c = acu[cand]
                        break
                amt_c = None
                for cand in ("IMPORTO", "TOTALE", "TOTALEDOCUMENTO", "ACCONTO"):
                    if cand in acu:
                        amt_c = acu[cand]
                        break
                if date_c and amt_c:
                    cur.execute(
                        "SELECT FIRST 5000 %s, %s FROM %s WHERE %s >= ? AND %s < ?"
                        % (date_c, amt_c, ap, date_c, date_c),
                        [day_dt, day_next],
                    )
                    tot = 0.0
                    n = 0
                    for d, a in cur.fetchall():
                        n += 1
                        tot += _f(a)
                    print("  day %s: n=%s EUR %.2f" % (day, n, tot))
                else:
                    cur.execute("SELECT COUNT(*) FROM %s" % ap)
                    print("  count_all=%s (no date/amt auto)" % cur.fetchone()[0])
            except Exception as exc:
                print("  ERRORE: %s" % exc)

        # VEA list by POS for the day
        print("\n--- elenco VEA del giorno ---")
        for r in rows:
            if str(cell(r, doc) or "").strip() != "VEA":
                continue
            print(
                "  POS=%s id=%s EUR %.2f numdoc=%s proforma=%s code=%s ts=%s"
                % (
                    cell(r, store),
                    cell(r, rid),
                    _f(cell(r, amt)),
                    cell(r, numdoc) if numdoc else "-",
                    cell(r, proforma) if proforma else "-",
                    cell(r, cm) if cm else "-",
                    cell(r, ts),
                )
            )

        print("\n=== lettura ===")
        print("Se VEA POS1~0 e POS2~185, i totali 1246/701 NON sono solo VEA.")
        print("Cerca sopra una riga POS=1 ~1246 o POS=2 ~701.")
        print("=== fine ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
