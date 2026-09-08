#!/usr/bin/env python3
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

    hours = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS") or "720")  # 30 giorni
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

        print(f"dsn={dsn} lookback_h={hours}")
        print(f"CODICEMOVIMENTO={cm} NUMEROCODICEMOVIMENTO={ncm}")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        params = []
        where_ts = ""
        if ts and mapping.get("ts"):
            where_ts = f"{ts} >= ?"
            params = [cutoff.replace(tzinfo=None)]
        elif ts:
            where_ts = f"{ts} >= ?"
            params = [cutoff.date()]

        # 1) Conteggio per CODICEMOVIMENTO
        print(f"\n=== CODICEMOVIMENTO (ultimi {hours}h) ===")
        if cm:
            try:
                sql = f"SELECT FIRST 50000 {cm}, {doc}, {amt}"
                if store:
                    sql += f", {store}"
                sql += f" FROM {table}"
                if where_ts:
                    sql += f" WHERE {where_ts}"
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
                        f"  {code}: n={hit['n']} tot≈{hit['tot']:.2f} "
                        f"docs={dict(hit['docs'])} pos={dict(hit['pos'].most_common(6))}"
                    )
            except Exception as exc:
                print(f"  ERRORE: {exc}")

        # 2) Focus PREVENTIVO / PRECONTO / VENDITA+VEA
        print("\n=== focus PREVENTIVO / PRECONTO / VEA ===")
        for label, clause, extra_params in (
            ("CODICEMOVIMENTO=PREVENTIVO", f"{cm} = 'PREVENTIVO'" if cm else "1=0", []),
            ("CODICEMOVIMENTO=PRECONTO", f"{cm} = 'PRECONTO'" if cm else "1=0", []),
            ("NUMEROCODICEMOVIMENTO=31 (PREVENTIVO)", f"{ncm} = 31" if ncm else "1=0", []),
            ("NUMEROCODICEMOVIMENTO=19 (PRECONTO)", f"{ncm} = 19" if ncm else "1=0", []),
            ("TIPODOCUMENTO=VEA", f"{doc} = 'VEA'", []),
        ):
            try:
                wh = []
                p = []
                if where_ts:
                    wh.append(where_ts)
                    p.extend(params)
                wh.append(clause)
                p.extend(extra_params)
                wsql = " WHERE " + " AND ".join(wh)
                parts = [c for c in (rid, doc, cm, ncm, store, ts, amt) if c]
                # senza filtro data per PREVENTIVO/PRECONTO (possono essere rari)
                if "PREVENT" in label or "PRECONTO" in label or "31" in label or "19" in label:
                    # storico più ampio: FIRST 200 senza date se 0 nel lookback
                    cur.execute(f"SELECT FIRST 50 {', '.join(parts)} FROM {table} WHERE {clause}")
                    rows = cur.fetchall()
                    print(f"\n{label} (storico FIRST 50, no date): n={len(rows)}")
                    print("cols:", ", ".join(parts))
                    for r in rows[:20]:
                        print(" ", r)
                else:
                    cur.execute(f"SELECT FIRST 50 {', '.join(parts)} FROM {table}{wsql}", p)
                    rows = cur.fetchall()
                    print(f"\n{label} (lookback): n={len(rows)}")
                    for r in rows[:15]:
                        print(" ", r)
            except Exception as exc:
                print(f"{label}: ERRORE {exc}")

        # 3) Cosa è VEA in rapporto ai codici
        print("\n=== VEA: distribuzione CODICEMOVIMENTO / NUMEROCODICEMOVIMENTO ===")
        try:
            parts = [c for c in (cm, ncm, doc) if c]
            sql = f"SELECT FIRST 5000 {', '.join(parts)} FROM {table} WHERE {doc} = 'VEA'"
            cur.execute(sql)
            cnt = Counter()
            for row in cur.fetchall():
                cnt[tuple("" if x is None else str(x) for x in row)] += 1
            for k, n in cnt.most_common(20):
                print(f"  {k}: {n}")
        except Exception as exc:
            print(f"  ERRORE: {exc}")

        # 4) VENDITA + NUMDOC=0 + no NUMERODOCUMENTO → stesso pattern VEA?
        print("\n=== VENDITA con NUMDOC=0 (pattern tipo VEA) per TIPODOCUMENTO ===")
        try:
            numdoc = col_u.get("NUMDOC")
            if cm and numdoc and doc:
                sql = (
                    f"SELECT FIRST 20000 {doc}, {cm}, {numdoc}, {amt} FROM {table}"
                )
                if where_ts:
                    sql += f" WHERE {where_ts} AND {cm} = 'VENDITA' AND {numdoc} = 0"
                    cur.execute(sql, params)
                else:
                    sql += f" WHERE {cm} = 'VENDITA' AND {numdoc} = 0"
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
                    print(f"  DOC={dtype}: n={n} tot≈{tot[dtype]:.2f}")
        except Exception as exc:
            print(f"  ERRORE: {exc}")

        print("\n=== lettura ===")
        print("In CODICIMOVIMENTI esistono PREVENTIVO (31) e PRECONTO (19).")
        print("Se MOVIMENTIT ha 0 righe PREVENTIVO/PRECONTO, quei documenti non vengono usati in cassa.")
        print("VEA con CODICEMOVIMENTO=VENDITA = vendita salvata SENZA scontrino fiscale,")
        print("non il documento anagrafico 'PREVENTIVO'.")
        print("=== fine ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
