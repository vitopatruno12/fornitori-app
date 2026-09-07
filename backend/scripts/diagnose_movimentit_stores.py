#!/usr/bin/env python3
"""Diagnostica colonne cassa/negozio in MOVIMENTIT (da PC cassa Abba).

Uso:
  cd C:\\AtlasSync
  py -u diagnose_movimentit_stores.py
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
        _list_user_tables,
        _table_columns,
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
                    "MATRICOLA",
                    "GIORNO",
                )
            )
        ]
        print(f"\ncandidate ({len(interest)}): {', '.join(interest) or '(nessuna)'}")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=96)
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

        for col in interest[:25]:
            try:
                sql = f"SELECT FIRST 8000 {col} FROM {table}{where_sql}"
                cur.execute(sql, params)
                cnt = Counter()
                for (val,) in cur.fetchall():
                    key = "(vuoto)" if val is None or str(val).strip() == "" else str(val).strip()
                    cnt[key] += 1
                top = cnt.most_common(12)
                print(f"\n{col}: {dict(top)}")
            except Exception as exc:
                print(f"\n{col}: ERRORE {exc}")

        # Breakdown NUMEROGIORNOPOS x giorno x totale
        if "NUMEROGIORNOPOS" in {c.upper() for c in cols} and ts_col:
            print("\n=== NUMEROGIORNOPOS per giorno (VEN, 96h) ===")
            try:
                amt = mapping.get("amount") or "TOTALEDOCUMENTO"
                sql = (
                    f"SELECT FIRST 8000 NUMEROGIORNOPOS, {ts_col}, {amt} "
                    f"FROM {table}{where_sql}"
                )
                cur.execute(sql, params)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0, "days": Counter()})
                for gid, when, amount in cur.fetchall():
                    g = "(vuoto)" if gid is None else str(gid).strip()
                    by[g]["n"] += 1
                    try:
                        by[g]["tot"] += float(amount or 0)
                    except Exception:
                        pass
                    day = str(when)[:10] if when is not None else "?"
                    by[g]["days"][day] += 1
                for g, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
                    print(f"  GIORNOPOS={g}: n={hit['n']} tot≈{hit['tot']:.2f} days={dict(hit['days'])}")
            except Exception as exc:
                print(f"  ERRORE breakdown: {exc}")

        # NUMEROPOS x giorno (filtro stabile)
        col_upper = {c.upper(): c for c in cols}
        if "NUMEROPOS" in col_upper and ts_col:
            print("\n=== NUMEROPOS per giorno (VEN, 96h) — usa questo per EASYRETAIL_STORE_FILTER ===")
            try:
                amt = mapping.get("amount") or "TOTALEDOCUMENTO"
                npos = col_upper["NUMEROPOS"]
                sql = (
                    f"SELECT FIRST 8000 {npos}, {ts_col}, {amt} "
                    f"FROM {table}{where_sql}"
                )
                cur.execute(sql, params)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0, "days": Counter()})
                for pid, when, amount in cur.fetchall():
                    p = "(vuoto)" if pid is None else str(pid).strip()
                    by[p]["n"] += 1
                    try:
                        by[p]["tot"] += float(amount or 0)
                    except Exception:
                        pass
                    day = str(when)[:10] if when is not None else "?"
                    by[p]["days"][day] += 1
                for p, hit in sorted(by.items(), key=lambda kv: kv[0]):
                    print(f"  NUMEROPOS={p}: n={hit['n']} tot≈{hit['tot']:.2f}")
                    for day, n in sorted(hit["days"].items()):
                        print(f"    {day}: docs={n}")
            except Exception as exc:
                print(f"  ERRORE NUMEROPOS/giorno: {exc}")

        if "NUMEROPOS" in col_upper and "NUMEROGIORNOPOS" in col_upper and ts_col:
            print("\n=== NUMEROPOS x NUMEROGIORNOPOS ===")
            try:
                amt = mapping.get("amount") or "TOTALEDOCUMENTO"
                npos = col_upper["NUMEROPOS"]
                sql = (
                    f"SELECT FIRST 8000 {npos}, NUMEROGIORNOPOS, {amt} "
                    f"FROM {table}{where_sql}"
                )
                cur.execute(sql, params)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0})
                for pid, gid, amount in cur.fetchall():
                    key = f"POS={pid} GIORNO={gid}"
                    by[key]["n"] += 1
                    try:
                        by[key]["tot"] += float(amount or 0)
                    except Exception:
                        pass
                for key, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
                    print(f"  {key}: n={hit['n']} tot≈{hit['tot']:.2f}")
            except Exception as exc:
                print(f"  ERRORE cross: {exc}")

        # Tabella GIORNATEPOS se esiste
        tables = _list_user_tables(cur)
        gtable = next((t for t in tables if t.upper() == "GIORNATEPOS"), None)
        if not gtable:
            gtable = next((t for t in tables if "GIORNAT" in t.upper() and "POS" in t.upper()), None)
        if gtable:
            gcols = _table_columns(cur, gtable)
            print(f"\n=== {gtable} colonne: {', '.join(gcols)} ===")
            try:
                cur.execute(f"SELECT FIRST 30 * FROM {gtable}")
                rows = cur.fetchall()
                print(f"sample rows ({len(rows)}):")
                for r in rows[:15]:
                    print(" ", r)
            except Exception as exc:
                print(f"sample ERRORE: {exc}")
            # Join recenti
            try:
                id_col = next((c for c in gcols if c.upper() in ("NUMEROGIORNOPOS", "NUMERO", "ID")), None)
                if id_col:
                    cur.execute(
                        f"SELECT FIRST 40 * FROM {gtable} "
                        f"WHERE {id_col} IN (6692, 6694) OR {id_col} IS NOT NULL"
                    )
                    print(f"\n{gtable} focus 6692/6694 / recenti:")
                    for r in cur.fetchall()[:20]:
                        print(" ", r)
            except Exception as exc:
                print(f"focus ERRORE: {exc}")
        else:
            print("\n(nessuna tabella GIORNATEPOS trovata)")
            print("tabelle POS-like:", [t for t in tables if "POS" in t.upper()][:40])

        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
