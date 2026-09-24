#!/usr/bin/env python3
# -*- coding: ascii -*-
"""Cerca PREVENTIVO / PRECONTO in MOVIMENTIT (non solo VEA).

  cd C:\\AtlasSync
  py -u diagnose_preventivo_codici.py
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
        _table_columns,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    hours = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS") or "720")
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
        ts = mapping.get("ts") or mapping.get("date")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")
        store = mapping.get("store") or col_u.get("NUMEROPOS")
        cm = col_u.get("CODICEMOVIMENTO")
        ncm = col_u.get("NUMEROCODICEMOVIMENTO")

        print("dsn=%s lookback_h=%s" % (dsn, hours))
        print("CODICEMOVIMENTO=%s NUMEROCODICEMOVIMENTO=%s" % (cm, ncm))

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        params = []
        where_ts = ""
        if ts and mapping.get("ts"):
            where_ts = "%s >= ?" % ts
            params = [cutoff.replace(tzinfo=None)]
        elif ts:
            where_ts = "%s >= ?" % ts
            params = [cutoff.date()]

        print("\n=== CODICEMOVIMENTO (ultimi %sh) ===" % hours)
        if cm:
            try:
                sql = "SELECT FIRST 50000 %s, %s, %s" % (cm, doc, amt)
                if store:
                    sql += ", %s" % store
                sql += " FROM %s" % table
                if where_ts:
                    sql += " WHERE %s" % where_ts
                cur.execute(sql, params)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0, "docs": Counter(), "pos": Counter()})
                for row in cur.fetchall():
                    code = "(vuoto)" if row[0] is None or str(row[0]).strip() == "" else str(row[0]).strip()
                    dtype = "(vuoto)" if row[1] is None else str(row[1]).strip()
                    by[code]["n"] += 1
                    try:
                        by[code]["tot"] += float(row[2] or 0)
                    except Exception:
                        pass
                    by[code]["docs"][dtype] += 1
                    if store:
                        by[code]["pos"][str(row[3]).strip() if row[3] is not None else "(vuoto)"] += 1
                for code, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
                    print(
                        "  %s: n=%s tot~%.2f docs=%s pos=%s"
                        % (
                            code,
                            hit["n"],
                            hit["tot"],
                            dict(hit["docs"]),
                            dict(hit["pos"].most_common(6)),
                        )
                    )
            except Exception as exc:
                print("  ERRORE: %s" % exc)

        print("\n=== focus PREVENTIVO / PRECONTO / VEA ===")
        for label, clause in (
            ("CODICEMOVIMENTO=PREVENTIVO", ("%s = 'PREVENTIVO'" % cm) if cm else "1=0"),
            ("CODICEMOVIMENTO=PRECONTO", ("%s = 'PRECONTO'" % cm) if cm else "1=0"),
            ("NUMEROCODICEMOVIMENTO=31", ("%s = 31" % ncm) if ncm else "1=0"),
            ("NUMEROCODICEMOVIMENTO=19", ("%s = 19" % ncm) if ncm else "1=0"),
            ("TIPODOCUMENTO=VEA", ("%s = 'VEA'" % doc) if doc else "1=0"),
        ):
            try:
                parts = [c for c in (rid, doc, cm, ncm, store, ts, amt) if c]
                if "PREVENT" in label or "PRECONTO" in label or "=31" in label or "=19" in label:
                    cur.execute(
                        "SELECT FIRST 50 %s FROM %s WHERE %s"
                        % (", ".join(parts), table, clause)
                    )
                    rows = cur.fetchall()
                    print("\n%s (storico FIRST 50, no date): n=%s" % (label, len(rows)))
                    print("cols:", ", ".join(parts))
                    for r in rows[:20]:
                        print(" ", r)
                else:
                    wh = []
                    p = []
                    if where_ts:
                        wh.append(where_ts)
                        p.extend(params)
                    wh.append(clause)
                    wsql = " WHERE " + " AND ".join(wh)
                    cur.execute(
                        "SELECT FIRST 50 %s FROM %s%s" % (", ".join(parts), table, wsql),
                        p,
                    )
                    rows = cur.fetchall()
                    print("\n%s (lookback): n=%s" % (label, len(rows)))
                    for r in rows[:15]:
                        print(" ", r)
            except Exception as exc:
                print("%s: ERRORE %s" % (label, exc))

        # Totals per day for VEA vs all non-VEN with amount > 0 (match Rapporto Complessivo)
        print("\n=== per giorno: VEA vs altri non-VEN (con importo) ===")
        if doc and ts and amt:
            try:
                sql = "SELECT FIRST 30000 %s, %s, %s" % (doc, ts, amt)
                if store:
                    sql += ", %s" % store
                sql += " FROM %s" % table
                if where_ts:
                    sql += " WHERE %s" % where_ts
                cur.execute(sql, params)
                by = defaultdict(lambda: {"vea_n": 0, "vea_tot": 0.0, "other_n": 0, "other_tot": 0.0, "types": Counter()})
                for row in cur.fetchall():
                    dtype = "(vuoto)" if row[0] is None else str(row[0]).strip()
                    day = str(row[1])[:10] if row[1] is not None else "?"
                    try:
                        val = float(row[2] or 0)
                    except Exception:
                        val = 0.0
                    if dtype == "VEN":
                        continue
                    if val <= 0:
                        continue
                    by[day]["types"][dtype] += 1
                    if dtype == "VEA":
                        by[day]["vea_n"] += 1
                        by[day]["vea_tot"] += val
                    else:
                        by[day]["other_n"] += 1
                        by[day]["other_tot"] += val
                for day in sorted(by.keys()):
                    hit = by[day]
                    print(
                        "  %s: VEA n=%s EUR %.2f | altri-non-VEN n=%s EUR %.2f | types=%s"
                        % (
                            day,
                            hit["vea_n"],
                            hit["vea_tot"],
                            hit["other_n"],
                            hit["other_tot"],
                            dict(hit["types"]),
                        )
                    )
            except Exception as exc:
                print("  ERRORE giorno: %s" % exc)

        print("\n=== VEA: distribuzione CODICEMOVIMENTO / NUMEROCODICEMOVIMENTO ===")
        try:
            parts = [c for c in (cm, ncm, doc) if c]
            sql = "SELECT FIRST 5000 %s FROM %s WHERE %s = 'VEA'" % (", ".join(parts), table, doc)
            cur.execute(sql)
            cnt = Counter()
            for row in cur.fetchall():
                cnt[tuple("" if x is None else str(x) for x in row)] += 1
            for k, n in cnt.most_common(20):
                print("  %s: %s" % (k, n))
        except Exception as exc:
            print("  ERRORE: %s" % exc)

        print("\n=== VENDITA con NUMDOC=0 (pattern tipo VEA) per TIPODOCUMENTO ===")
        try:
            numdoc = col_u.get("NUMDOC")
            if cm and numdoc and doc:
                sql = "SELECT FIRST 20000 %s, %s, %s, %s FROM %s" % (doc, cm, numdoc, amt, table)
                if where_ts:
                    sql += " WHERE %s AND %s = 'VENDITA' AND %s = 0" % (where_ts, cm, numdoc)
                    cur.execute(sql, params)
                else:
                    sql += " WHERE %s = 'VENDITA' AND %s = 0" % (cm, numdoc)
                    cur.execute(sql)
                by = Counter()
                tot = defaultdict(float)
                for dtype, code, nd, amount in cur.fetchall():
                    by[str(dtype)] += 1
                    try:
                        tot[str(dtype)] += float(amount or 0)
                    except Exception:
                        pass
                for dtype, n in by.most_common():
                    print("  DOC=%s: n=%s tot~%.2f" % (dtype, n, tot[dtype]))
        except Exception as exc:
            print("  ERRORE: %s" % exc)

        print("\n=== lettura ===")
        print("Confronta i totali VEA del giorno col Rapporto Complessivo Non fiscali+Preventivi.")
        print("Se il rapporto e' piu' alto, EasyRetail conta altri tipi oltre VEA.")
        print("=== fine ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
