#!/usr/bin/env python3
"""Verifica se VEA = vendita/stampa non fiscale (vs VEN fiscale).

Sul PC cassa:
  cd C:\\AtlasSync
  py -u diagnose_vea.py

Controlla:
  - totali giornalieri VEA vs VEN per NUMEROPOS
  - pagamenti collegati (PAGAMENTI / NUMEROFORMAPAGAMENTO)
  - overlap importo/ora con VEN (annullo / gemello?)
  - campi tipici fiscali vs vuoti
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


def _f(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


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
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")
        store = mapping.get("store") or col_u.get("NUMEROPOS")
        pay_col = mapping.get("payment_type") or col_u.get("NUMEROFORMAPAGAMENTO")

        print(f"dsn={dsn}")
        print(f"table={table} lookback_h={hours}")
        print(f"ts={ts_col} amount={amt} doc={doc} id={rid} store={store} pay={pay_col}")

        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        where = []
        params: list = []
        if ts_col and mapping.get("ts"):
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.replace(tzinfo=None))
        elif ts_col:
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.date())
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""

        # --- 1) Giornaliero VEN vs VEA per POS ---
        print(f"\n=== VEN vs VEA per giorno / NUMEROPOS (ultimi {hours}h) ===")
        try:
            sql = (
                f"SELECT FIRST 30000 {doc}, {store}, {ts_col}, {amt} "
                f"FROM {table}{where_sql} AND {doc} IN ('VEN','VEA')"
                if where_sql
                else f"SELECT FIRST 30000 {doc}, {store}, {ts_col}, {amt} "
                f"FROM {table} WHERE {doc} IN ('VEN','VEA')"
            )
            # Fix: where_sql already has WHERE
            if where_sql:
                sql = (
                    f"SELECT FIRST 30000 {doc}, {store}, {ts_col}, {amt} "
                    f"FROM {table}{where_sql} AND {doc} IN ('VEN','VEA')"
                )
            else:
                sql = (
                    f"SELECT FIRST 30000 {doc}, {store}, {ts_col}, {amt} "
                    f"FROM {table} WHERE {doc} IN ('VEN','VEA')"
                )
            cur.execute(sql, params)
            by = defaultdict(lambda: {"n": 0, "tot": 0.0})
            for dtype, npos, when, amount in cur.fetchall():
                day = str(when)[:10] if when is not None else "?"
                pos = "(vuoto)" if npos is None else str(npos).strip()
                key = f"{day}|POS={pos}|{dtype}"
                by[key]["n"] += 1
                by[key]["tot"] += _f(amount)
            # group by day+pos
            days = sorted({k.split("|")[0] for k in by})
            for day in days:
                print(f"\n  {day}:")
                for pos in ("1", "2", "0", "(vuoto)"):
                    ven = by.get(f"{day}|POS={pos}|VEN", {"n": 0, "tot": 0.0})
                    vea = by.get(f"{day}|POS={pos}|VEA", {"n": 0, "tot": 0.0})
                    if ven["n"] == 0 and vea["n"] == 0:
                        continue
                    print(
                        f"    POS={pos}:  VEN n={ven['n']} €{ven['tot']:.2f}  |  "
                        f"VEA n={vea['n']} €{vea['tot']:.2f}"
                    )
        except Exception as exc:
            print(f"  ERRORE confronto: {exc}")

        # --- 2) Campi testata VEA vs VEN (distribuzioni) ---
        print("\n=== campi testata: VEA vs VEN ===")
        interest = [
            c
            for c in (
                pay_col,
                col_u.get("LOGICDELETE"),
                col_u.get("ANNULLATO"),
                col_u.get("DOCUMENTOANNULLATO"),
                col_u.get("NUMDOC"),
                col_u.get("NUMERODOCUMENTO"),
                col_u.get("NUMDOCLOCALE"),
                col_u.get("PROFORMA"),
                col_u.get("DOCUMENTOACCONTO"),
                col_u.get("NUMEROMODELLOSTAMPA"),
                col_u.get("VARIANTE"),
                col_u.get("INGRESSOUSCITA"),
                col_u.get("CLIFOR"),
                col_u.get("NUMEROMOVIMENTOCONTABILE"),
                col_u.get("MATRICOLA"),
                col_u.get("NUMERORT"),
                col_u.get("IDFISCALE"),
            )
            if c
        ]
        # also any col with FISC / RT / SCONTR in name
        for c in cols:
            u = c.upper()
            if any(k in u for k in ("FISC", "RT", "SCONTR", " annull".upper(), "VOID", "QUOTE", "PREV")):
                if c not in interest:
                    interest.append(c)

        for dtype in ("VEA", "VEN"):
            print(f"\n  -- {dtype} --")
            try:
                select = [c for c in interest if c]
                if not select:
                    print("  (nessun campo interessato)")
                    continue
                sql = (
                    f"SELECT FIRST 5000 {', '.join(select)} FROM {table}{where_sql} AND {doc} = ?"
                    if where_sql
                    else f"SELECT FIRST 5000 {', '.join(select)} FROM {table} WHERE {doc} = ?"
                )
                cur.execute(sql, list(params) + [dtype])
                rows = cur.fetchall()
                print(f"  rows={len(rows)}")
                for i, cname in enumerate(select):
                    cnt = Counter()
                    nulls = 0
                    for row in rows:
                        v = row[i]
                        if v is None or str(v).strip() == "":
                            nulls += 1
                        else:
                            cnt[str(v).strip()[:80]] += 1
                    top = cnt.most_common(8)
                    print(f"    {cname}: null/empty={nulls} top={dict(top)}")
            except Exception as exc:
                print(f"  ERRORE campi {dtype}: {exc}")

        # --- 3) Pagamenti collegati ---
        print("\n=== pagamenti collegati a VEA ===")
        tables = {t.upper(): t for t in _list_user_tables(cur)}
        pay_table = tables.get("PAGAMENTI") or tables.get("MOVIMENTIPAGAMENTI")
        if pay_table and rid:
            try:
                pcols = _table_columns(cur, pay_table)
                pcu = {c.upper(): c for c in pcols}
                link = pcu.get("NUMEROMOVIMENTO")
                pamt = pcu.get("IMPORTO") or pcu.get("IMPORTOFORMAPAGAMENTO")
                ptype = pcu.get("NUMEROFORMAPAGAMENTO") or pcu.get("CODICEFORMAPAGAMENTO")
                print(f"  pay_table={pay_table} link={link} amount={pamt} type={ptype}")
                # recent VEA ids
                sql = (
                    f"SELECT FIRST 200 {rid}, {amt}, {store}, {ts_col} FROM {table}"
                    f"{where_sql} AND {doc} = 'VEA'"
                    if where_sql
                    else f"SELECT FIRST 200 {rid}, {amt}, {store}, {ts_col} FROM {table} WHERE {doc} = 'VEA'"
                )
                cur.execute(sql, params)
                vea_rows = cur.fetchall()
                ids = [r[0] for r in vea_rows if r[0] is not None]
                print(f"  VEA recent={len(vea_rows)} ids={len(ids)}")
                matched = 0
                pay_types = Counter()
                pay_amt = 0.0
                for i in range(0, len(ids), 40):
                    chunk = ids[i : i + 40]
                    placeholders = ",".join("?" * len(chunk))
                    cur.execute(
                        f"SELECT {link}, {ptype}, {pamt} FROM {pay_table} "
                        f"WHERE {link} IN ({placeholders})",
                        chunk,
                    )
                    for mid, pt, pa in cur.fetchall():
                        matched += 1
                        pay_types[str(pt)] += 1
                        pay_amt += _f(pa)
                print(f"  payment_lines matched={matched} tot_pay≈{pay_amt:.2f} types={dict(pay_types)}")
                # lookup forme
                if "FORMEPAGAMENTI" in tables and pay_types:
                    try:
                        fcols = _table_columns(cur, tables["FORMEPAGAMENTI"])
                        fcu = {c.upper(): c for c in fcols}
                        fid = fcu.get("NUMEROFORMAPAGAMENTO") or fcu.get("CODICE") or fcols[0]
                        fnome = fcu.get("DESCRIZIONE") or fcu.get("FORMAPAGAMENTO") or fcu.get("NOME")
                        if fnome:
                            codes = list(pay_types.keys())[:20]
                            ph = ",".join("?" * len(codes))
                            cur.execute(
                                f"SELECT {fid}, {fnome} FROM {tables['FORMEPAGAMENTI']} "
                                f"WHERE {fid} IN ({ph})",
                                codes,
                            )
                            print("  forme pagamento:")
                            for r in cur.fetchall():
                                print(f"    {r[0]} → {r[1]}")
                    except Exception as exc:
                        print(f"  lookup forme: {exc}")
            except Exception as exc:
                print(f"  ERRORE pagamenti: {exc}")
        else:
            print("  (tabella pagamenti non trovata)")

        # --- 4) Overlap VEA ↔ VEN stesso importo entro 3s stesso POS ---
        print("\n=== overlap VEA↔VEN (stesso POS, stesso €, ±3s) ===")
        try:
            sql = (
                f"SELECT FIRST 15000 {doc}, {rid}, {store}, {ts_col}, {amt} FROM {table}"
                f"{where_sql} AND {doc} IN ('VEN','VEA')"
                if where_sql
                else f"SELECT FIRST 15000 {doc}, {rid}, {store}, {ts_col}, {amt} "
                f"FROM {table} WHERE {doc} IN ('VEN','VEA')"
            )
            cur.execute(sql, params)
            ven_list = []
            vea_list = []
            for dtype, mid, npos, when, amount in cur.fetchall():
                if when is None or amount is None:
                    continue
                item = {
                    "id": mid,
                    "pos": str(npos).strip() if npos is not None else "",
                    "when": when,
                    "amt": round(_f(amount), 2),
                }
                if dtype == "VEN":
                    ven_list.append(item)
                else:
                    vea_list.append(item)
            # index VEN by pos+amt
            ven_idx = defaultdict(list)
            for v in ven_list:
                ven_idx[(v["pos"], v["amt"])].append(v)
            pairs = 0
            orphans = 0
            for a in vea_list:
                cands = ven_idx.get((a["pos"], a["amt"]), [])
                hit = False
                for v in cands:
                    try:
                        dt = abs((a["when"] - v["when"]).total_seconds())
                    except Exception:
                        continue
                    if dt <= 3:
                        hit = True
                        break
                if hit:
                    pairs += 1
                else:
                    orphans += 1
            print(f"  VEA={len(vea_list)} VEN={len(ven_list)}")
            print(f"  VEA con gemello VEN ±3s stesso €/POS: {pairs}")
            print(f"  VEA senza gemello (candidato non fiscale puro): {orphans}")
            if orphans and vea_list:
                print("  sample VEA senza gemello:")
                shown = 0
                for a in vea_list:
                    cands = ven_idx.get((a["pos"], a["amt"]), [])
                    hit = any(
                        abs((a["when"] - v["when"]).total_seconds()) <= 3
                        for v in cands
                        if hasattr(a["when"] - v["when"], "total_seconds")
                    )
                    if hit:
                        continue
                    print(f"    id={a['id']} POS={a['pos']} {a['when']} €{a['amt']:.2f}")
                    shown += 1
                    if shown >= 12:
                        break
        except Exception as exc:
            print(f"  ERRORE overlap: {exc}")

        # --- 5) Lista completa VEA recenti ---
        print(f"\n=== elenco VEA (ultimi {hours}h) ===")
        try:
            extra = [
                c
                for c in (
                    pay_col,
                    col_u.get("CODICEMOVIMENTO"),
                    col_u.get("NUMDOC"),
                    col_u.get("NUMERODOCUMENTO"),
                    col_u.get("LOGICDELETE"),
                    col_u.get("INGRESSOUSCITA"),
                )
                if c
            ]
            parts = [rid, store, ts_col, amt] + extra
            sql = (
                f"SELECT FIRST 200 {', '.join(parts)} FROM {table}"
                f"{where_sql} AND {doc} = 'VEA'"
                if where_sql
                else f"SELECT FIRST 200 {', '.join(parts)} FROM {table} WHERE {doc} = 'VEA'"
            )
            cur.execute(sql, params)
            print("cols:", ", ".join(parts))
            for r in cur.fetchall():
                print(" ", r)
        except Exception as exc:
            print(f"  ERRORE elenco: {exc}")

        print("\n=== interpretazione rapida ===")
        print("Se VEA ha pagamenti + nessun gemello VEN → quasi certo non fiscale / preventivo salvato.")
        print("Se VEA ha sempre gemello VEN ±3s → è copia/annullo, NON preventivo.")
        print("Confronta i totali VEA con la chiusura cassa: se NON sono in chiusura → non fiscali.")
        print("\n=== fine diagnose_vea ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
