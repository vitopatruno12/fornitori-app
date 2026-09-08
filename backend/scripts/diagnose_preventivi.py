#!/usr/bin/env python3
"""Diagnostica preventivi / documenti non fiscali in EasyRetail GDB.

Da eseguire sul PC cassa (stesso .env dell'agent AtlasSync):

  cd C:\\AtlasSync
  py -u diagnose_preventivi.py

Cosa stampa:
  - distribuzione TIPODOCUMENTO (tutti i tipi, non solo VEN)
  - flag PROFORMA se presente
  - tabelle *PREVENTIV*
  - campioni recenti non-VEN
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
        ts_col = mapping.get("ts") or mapping.get("date")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO") or col_u.get("TOTALEIVATO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")
        store = mapping.get("store")

        print(f"dsn={dsn}")
        print(f"table={table} lookback_h={hours}")
        print(f"ts={ts_col} amount={amt} doc={doc} id={rid} store={store}")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        where = []
        params: list = []
        if ts_col and mapping.get("ts"):
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.replace(tzinfo=None))
        elif ts_col and mapping.get("date"):
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.date())
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        # --- TIPODOCUMENTO breakdown ---
        if doc:
            print(f"\n=== {doc} (ultimi {hours}h) ===")
            try:
                select = [doc]
                if amt:
                    select.append(amt)
                if ts_col:
                    select.append(ts_col)
                if store:
                    select.append(store)
                sql = f"SELECT FIRST 20000 {', '.join(select)} FROM {table}{where_sql}"
                cur.execute(sql, params)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0, "days": Counter(), "stores": Counter()})
                for row in cur.fetchall():
                    dtype = "(vuoto)" if row[0] is None or str(row[0]).strip() == "" else str(row[0]).strip()
                    by[dtype]["n"] += 1
                    idx = 1
                    if amt:
                        try:
                            by[dtype]["tot"] += float(row[idx] or 0)
                        except Exception:
                            pass
                        idx += 1
                    if ts_col:
                        day = str(row[idx])[:10] if row[idx] is not None else "?"
                        by[dtype]["days"][day] += 1
                        idx += 1
                    if store:
                        sk = "(vuoto)" if row[idx] is None else str(row[idx]).strip()
                        by[dtype]["stores"][sk] += 1
                for dtype, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
                    print(f"  {dtype}: n={hit['n']} tot≈{hit['tot']:.2f}")
                    for day, n in sorted(hit["days"].items())[-7:]:
                        print(f"    {day}: {n}")
                    if hit["stores"]:
                        top_s = hit["stores"].most_common(6)
                        print(f"    stores={dict(top_s)}")
            except Exception as exc:
                print(f"  ERRORE TIPODOCUMENTO: {exc}")
        else:
            print("\n(nessuna colonna TIPODOCUMENTO)")

        # --- PROFORMA ---
        if "PROFORMA" in col_u:
            pcol = col_u["PROFORMA"]
            print(f"\n=== {pcol} x {doc or 'ALL'} ===")
            try:
                parts = [pcol]
                if doc:
                    parts.append(doc)
                if amt:
                    parts.append(amt)
                sql = f"SELECT FIRST 20000 {', '.join(parts)} FROM {table}{where_sql}"
                cur.execute(sql, params)
                cnt = Counter()
                for row in cur.fetchall():
                    pf = "(vuoto)" if row[0] is None else str(row[0]).strip()
                    dtype = ""
                    if doc:
                        dtype = "(vuoto)" if row[1] is None else str(row[1]).strip()
                    cnt[f"PROFORMA={pf}|DOC={dtype or '-'}"] += 1
                for k, n in cnt.most_common(30):
                    print(f"  {k}: {n}")
            except Exception as exc:
                print(f"  ERRORE PROFORMA: {exc}")

        # --- CODICEMOVIMENTO (spesso distingue preventivo) ---
        for cand in ("CODICEMOVIMENTO", "NUMEROCODICEMOVIMENTO"):
            if cand not in col_u:
                continue
            ccol = col_u[cand]
            print(f"\n=== {ccol} (non-VEN, ultimi {hours}h) ===")
            try:
                w2 = list(where)
                p2 = list(params)
                if doc:
                    w2.append(f"{doc} <> 'VEN'")
                w2sql = (" WHERE " + " AND ".join(w2)) if w2 else ""
                parts = [ccol]
                if doc:
                    parts.append(doc)
                if amt:
                    parts.append(amt)
                sql = f"SELECT FIRST 8000 {', '.join(parts)} FROM {table}{w2sql}"
                cur.execute(sql, p2)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0, "docs": Counter()})
                for row in cur.fetchall():
                    code = "(vuoto)" if row[0] is None else str(row[0]).strip()
                    by[code]["n"] += 1
                    idx = 1
                    if doc:
                        by[code]["docs"][str(row[idx]).strip() if row[idx] is not None else "?"] += 1
                        idx += 1
                    if amt:
                        try:
                            by[code]["tot"] += float(row[idx] or 0)
                        except Exception:
                            pass
                for code, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"])[:40]:
                    print(f"  {code}: n={hit['n']} tot≈{hit['tot']:.2f} docs={dict(hit['docs'])}")
            except Exception as exc:
                print(f"  ERRORE {cand}: {exc}")

        # --- Sample non-VEN ---
        if doc:
            print(f"\n=== sample non-VEN (max 25) ===")
            try:
                sample_cols = [c for c in (rid, doc, ts_col, amt, store, col_u.get("PROFORMA"), col_u.get("CODICEMOVIMENTO"), col_u.get("NUMEROMODELLOSTAMPA"), col_u.get("INTESTAZIONE")) if c]
                w2 = list(where) + [f"{doc} <> 'VEN'"]
                p2 = list(params)
                w2sql = " WHERE " + " AND ".join(w2)
                order = f" ORDER BY {ts_col}" if ts_col else ""
                sql = f"SELECT FIRST 25 {', '.join(sample_cols)} FROM {table}{w2sql}{order}"
                # Firebird: FIRST before ORDER can be odd; keep simple
                sql = f"SELECT FIRST 25 {', '.join(sample_cols)} FROM {table}{w2sql}"
                cur.execute(sql, p2)
                print("cols:", ", ".join(sample_cols))
                for row in cur.fetchall():
                    print(" ", row)
            except Exception as exc:
                print(f"  ERRORE sample: {exc}")

        # --- Tabelle preventivi ---
        tables = _list_user_tables(cur)
        prev_tables = [t for t in tables if "PREVENT" in t.upper() or "PROFORMA" in t.upper() or "QUOTE" in t.upper()]
        print(f"\n=== tabelle PREVENT/PROFORMA/QUOTE ({len(prev_tables)}) ===")
        for t in sorted(prev_tables)[:30]:
            try:
                tcols = _table_columns(cur, t)
                print(f"\n{t}: {', '.join(tcols[:40])}{'…' if len(tcols) > 40 else ''}")
                cur.execute(f"SELECT FIRST 5 * FROM {t}")
                rows = cur.fetchall()
                for r in rows:
                    print(" ", r[:20], ("…" if len(r) > 20 else ""))
            except Exception as exc:
                print(f"{t}: ERRORE {exc}")

        # --- ACCONTIPREVENTIVI: conteggio + join MOVIMENTIT ---
        if any(t.upper() == "ACCONTIPREVENTIVI" for t in tables):
            print("\n=== ACCONTIPREVENTIVI dettaglio ===")
            try:
                cur.execute("SELECT FIRST 1 COUNT(*) FROM ACCONTIPREVENTIVI")
                # Firebird COUNT may be slow; prefer FIRST sample + MAX id
            except Exception:
                pass
            try:
                cur.execute(
                    "SELECT FIRST 30 NUMEROACCONTOPREVENTIVO, NUMEROMOVIMENTO, "
                    "DATAACCONTOPREVENTIVO, IMPORTOACCONTOPREVENTIVO, CONDIZIONEACCONTOPREVENTIVO "
                    "FROM ACCONTIPREVENTIVI"
                )
                rows = cur.fetchall()
                print(f"sample rows={len(rows)}")
                for r in rows:
                    print(" ", r)
            except Exception as exc:
                print(f"  ERRORE sample accanti: {exc}")
            try:
                cur.execute(
                    "SELECT FIRST 20 a.NUMEROMOVIMENTO, a.IMPORTOACCONTOPREVENTIVO, "
                    "a.DATAACCONTOPREVENTIVO, m.TIPODOCUMENTO, m.CODICEMOVIMENTO, "
                    "m.TOTALEDOCUMENTO, m.NUMEROPOS "
                    "FROM ACCONTIPREVENTIVI a "
                    "LEFT JOIN MOVIMENTIT m ON m.NUMEROMOVIMENTO = a.NUMEROMOVIMENTO"
                )
                print("join MOVIMENTIT:")
                for r in cur.fetchall():
                    print(" ", r)
            except Exception as exc:
                print(f"  ERRORE join: {exc}")

        # --- Focus VEA / SCA (candidati non fiscali / comanda) ---
        if doc and ts_col and amt:
            for focus in ("VEA", "SCA", "DUC"):
                print(f"\n=== focus {focus} (sample 15) ===")
                try:
                    extra = []
                    for cname in (
                        "CODICEMOVIMENTO",
                        "NUMERODOCUMENTO",
                        "NUMDOC",
                        "INTESTAZIONE",
                        "NUMEROMODELLOSTAMPA",
                        "INGRESSOUSCITA",
                        "DOCUMENTOACCONTO",
                    ):
                        if cname in col_u:
                            extra.append(col_u[cname])
                    parts = [rid, doc, ts_col, amt, store] + extra if rid else [doc, ts_col, amt, store] + extra
                    parts = [p for p in parts if p]
                    sql = (
                        f"SELECT FIRST 15 {', '.join(parts)} FROM {table} "
                        f"WHERE {doc} = ? "
                        + (f"AND {ts_col} >= ?" if where else "")
                    )
                    p3 = [focus] + (params if where else [])
                    cur.execute(sql, p3)
                    print("cols:", ", ".join(parts))
                    for r in cur.fetchall():
                        print(" ", r)
                except Exception as exc:
                    print(f"  ERRORE focus {focus}: {exc}")

        # --- TIPODOCUMENTO storici (senza filtro data, FIRST 50k) ---
        if doc:
            print("\n=== TIPODOCUMENTO storico (FIRST 50000, no date filter) ===")
            try:
                sql = f"SELECT FIRST 50000 {doc}"
                if amt:
                    sql += f", {amt}"
                sql += f" FROM {table}"
                cur.execute(sql)
                by = defaultdict(lambda: {"n": 0, "tot": 0.0})
                for row in cur.fetchall():
                    dtype = "(vuoto)" if row[0] is None or str(row[0]).strip() == "" else str(row[0]).strip()
                    by[dtype]["n"] += 1
                    if amt:
                        try:
                            by[dtype]["tot"] += float(row[1] or 0)
                        except Exception:
                            pass
                for dtype, hit in sorted(by.items(), key=lambda kv: -kv[1]["n"]):
                    print(f"  {dtype}: n={hit['n']} tot≈{hit['tot']:.2f}")
            except Exception as exc:
                print(f"  ERRORE storico: {exc}")

        print("\n=== fine diagnostica preventivi ===")
        print("Copia tutto l'output e incollalo in chat.")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
