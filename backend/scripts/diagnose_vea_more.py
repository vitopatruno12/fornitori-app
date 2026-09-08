#!/usr/bin/env python3
"""Altre prove su VEA: descrizione codice documento, righe, confronti.

  cd C:\\AtlasSync
  py -u diagnose_vea_more.py
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

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    hours = int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS") or "168")
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
        tables = {t.upper(): t for t in _list_user_tables(cur)}
        ts_col = mapping.get("ts") or mapping.get("date")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        params = []
        where_sql = ""
        if ts_col and mapping.get("ts"):
            where_sql = f" WHERE {ts_col} >= ?"
            params = [cutoff.replace(tzinfo=None)]
        elif ts_col:
            where_sql = f" WHERE {ts_col} >= ?"
            params = [cutoff.date()]

        print(f"dsn={dsn} lookback_h={hours}")
        print(f"tables_count={len(tables)}")

        # --- 1) Tabelle anagrafiche tipi documento / codici movimenti ---
        print("\n=== anagrafiche tipo documento / codici (cerca VEA) ===")
        candidates = [
            t
            for u, t in sorted(tables.items())
            if any(
                k in u
                for k in (
                    "CODICEMOV",
                    "CODICIMOV",
                    "TIPODOC",
                    "TIPIDOC",
                    "DOCUMENTI",
                    "CAUSALI",
                    "NUMERAZION",
                )
            )
        ]
        print("candidate tables:", candidates[:40])
        for tname in candidates[:25]:
            try:
                tcols = _table_columns(cur, tname)
                tcu = {c.upper(): c for c in tcols}
                # cerca colonne codice/descrizione
                code_cols = [
                    c
                    for c in tcols
                    if any(
                        k in c.upper()
                        for k in ("CODICE", "TIPO", "SIGLA", "MOVIMENTO", "DOCUMENTO")
                    )
                ][:6]
                desc_cols = [
                    c
                    for c in tcols
                    if any(k in c.upper() for k in ("DESCR", "NOME", "MOVIMENTO", "NOTE"))
                ][:4]
                print(f"\n{tname}: cols={len(tcols)} code≈{code_cols} desc≈{desc_cols}")
                # scan for VEA / PREVENT / NON FISC
                text_cols = [c for c in tcols if c.upper() not in ("LOGICDELETE", "SINCROFIELD", "SINCROSERVERFIELD", "INSTABLOG", "UPDTABLOG")]
                # pull sample and filter in python (safer than many OR)
                cur.execute(f"SELECT FIRST 500 {', '.join(text_cols[:20])} FROM {tname}")
                hits = []
                for row in cur.fetchall():
                    blob = " | ".join("" if x is None else str(x) for x in row).upper()
                    if any(k in blob for k in ("VEA", "PREV", "NON FISC", "QUOTE", "PROFORMA", "SCONTRINO")):
                        hits.append(row)
                if hits:
                    print(f"  HIT rows={len(hits)} (mostra max 15):")
                    for h in hits[:15]:
                        print("   ", h[:12])
                else:
                    # still show if table looks like tipidocumento with few rows
                    try:
                        cur.execute(f"SELECT FIRST 40 {', '.join(text_cols[:8])} FROM {tname}")
                        rows = cur.fetchall()
                        if len(rows) <= 40:
                            print(f"  all rows ({len(rows)}):")
                            for r in rows:
                                print("   ", r)
                    except Exception:
                        pass
            except Exception as exc:
                print(f"{tname}: ERRORE {exc}")

        # Direct common tables
        for tname in ("CODICIMOVIMENTI", "CODICEMOVIMENTI", "TIPIDOCUMENTO", "TIPIDOCUMENTI", "TIPIDOCUMENTO"):
            if tname not in tables:
                continue
            real = tables[tname]
            print(f"\n=== dump {real} ===")
            try:
                tcols = _table_columns(cur, real)
                cur.execute(f"SELECT FIRST 80 * FROM {real}")
                print("cols:", ", ".join(tcols[:25]))
                for r in cur.fetchall():
                    print(" ", r[:15])
            except Exception as exc:
                print(f"  ERRORE: {exc}")

        # --- 2) Righe MOVIMENTIR per VEA vs VEN ---
        print("\n=== righe dettaglio (MOVIMENTIR / simili) su VEA ===")
        line_tables = [
            tables[u]
            for u in tables
            if u in ("MOVIMENTIR", "MOVIMENTI", "RIGHEMOVIMENTI", "DETTAGLIOMOVIMENTI")
            or (u.startswith("MOVIMENT") and u.endswith("R"))
        ]
        # unique preserve
        seen = set()
        line_tables = [t for t in line_tables if not (t in seen or seen.add(t))]
        print("line tables:", line_tables)
        # get recent VEA ids
        vea_ids = []
        try:
            sql = f"SELECT FIRST 30 {rid}, {amt}, {ts_col} FROM {table}{where_sql}"
            if where_sql:
                sql += f" AND {doc} = 'VEA'"
            else:
                sql += f" WHERE {doc} = 'VEA'"
            cur.execute(sql, params)
            vea_rows = cur.fetchall()
            vea_ids = [r[0] for r in vea_rows]
            print(f"VEA ids sample ({len(vea_ids)}): {vea_ids[:10]}")
        except Exception as exc:
            print(f"VEA ids ERRORE: {exc}")

        for lt in line_tables[:4]:
            try:
                lcols = _table_columns(cur, lt)
                lcu = {c.upper(): c for c in lcols}
                link = lcu.get("NUMEROMOVIMENTO")
                if not link or not vea_ids:
                    print(f"{lt}: skip (link={link})")
                    continue
                prod = (
                    lcu.get("CODICEPRODOTTO")
                    or lcu.get("DESCRIZIONE")
                    or lcu.get("PRODOTTO")
                    or lcu.get("EAN")
                )
                qty = lcu.get("QTA") or lcu.get("QUANTITA")
                price = lcu.get("TOTALE") or lcu.get("PREZZO") or lcu.get("IMPORTO")
                print(f"\n{lt}: link={link} prod={prod} qty={qty} price={price}")
                chunk = vea_ids[:20]
                ph = ",".join("?" * len(chunk))
                sel = [link]
                for c in (prod, qty, price, lcu.get("DESCRIZIONE"), lcu.get("CODICEPRODOTTO")):
                    if c and c not in sel:
                        sel.append(c)
                cur.execute(
                    f"SELECT FIRST 80 {', '.join(sel)} FROM {lt} WHERE {link} IN ({ph})",
                    chunk,
                )
                rows = cur.fetchall()
                print(f"  line rows for VEA: {len(rows)}")
                for r in rows[:25]:
                    print(" ", r)
            except Exception as exc:
                print(f"{lt}: ERRORE {exc}")

        # --- 3) Confronto BIL gemelli di VEA? ---
        print("\n=== overlap VEA↔BIL (stesso € ±3s, qualsiasi POS) ===")
        try:
            store = mapping.get("store") or col_u.get("NUMEROPOS")
            sql = (
                f"SELECT FIRST 20000 {doc}, {rid}, {store}, {ts_col}, {amt} FROM {table}"
                f"{where_sql} AND {doc} IN ('VEA','BIL','VEN')"
                if where_sql
                else f"SELECT FIRST 20000 {doc}, {rid}, {store}, {ts_col}, {amt} "
                f"FROM {table} WHERE {doc} IN ('VEA','BIL','VEN')"
            )
            cur.execute(sql, params)
            by_type = defaultdict(list)
            for dtype, mid, npos, when, amount in cur.fetchall():
                if when is None or amount is None:
                    continue
                by_type[dtype].append(
                    {
                        "id": mid,
                        "pos": npos,
                        "when": when,
                        "amt": round(float(amount), 2),
                    }
                )
            veas = by_type.get("VEA", [])
            for other in ("BIL", "VEN"):
                idx = defaultdict(list)
                for v in by_type.get(other, []):
                    idx[v["amt"]].append(v)
                pairs = 0
                for a in veas:
                    for v in idx.get(a["amt"], []):
                        try:
                            if abs((a["when"] - v["when"]).total_seconds()) <= 3:
                                pairs += 1
                                break
                        except Exception:
                            pass
                print(f"  VEA con gemello {other} ±3s stesso €: {pairs}/{len(veas)}")
        except Exception as exc:
            print(f"  ERRORE: {exc}")

        # --- 4) Istruzioni prova manuale ---
        print("\n=== prova manuale (decisiva) ===")
        print("1) In cassa, annota ora esatta.")
        print("2) Stampa UN preventivo / totale non fiscale di prova (es. 0,11 €).")
        print("3) Rilancia subito: py -u diagnose_vea_more.py")
        print("4) Se compare un nuovo VEA con quell'importo/ora → VEA = quel tasto.")
        print("5) Se non compare nulla → VEA è altro; i preventivi non si salvano.")
        print("\nIn EasyRetail UI: Dettaglio scontrini → filtra Preventivo e apri")
        print("uno dei NUMEROMOVIMENTO VEA sopra: se compare lì, conferma.")
        print("\n=== fine diagnose_vea_more ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
