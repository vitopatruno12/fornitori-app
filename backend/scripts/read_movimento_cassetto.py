#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Legge i movimenti cassetto da EasyRetail (GDB Firebird).

Da eseguire sul PC cassa (stesso .env dell'agent AtlasSync):

  cd C:\\AtlasSync
  py -u read_movimento_cassetto.py
  py -u read_movimento_cassetto.py --day 2026-10-06
  py -u read_movimento_cassetto.py --day 2026-10-06 --store lattea

Cerca:
  1) documenti nel registro scontrini con tipo/codice/testo cassetto/prelievo/versamento
  2) tabelle GDB con nome/cassa/cassetto/prelievo

Stampa elenco e totale (utile per Prima Nota · MOVIMENTO_CASSETTO).
Non stampa la password del database.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

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
    "MOVIMENT",
)
_MATCH_WORDS = (
    "CASSET",
    "PRELIEV",
    "VERSAMENT",
    "FONDO",
    "MOV. CASSET",
    "MOV CASSET",
    "CONTANTI CASSET",
)
_SKIP_DOC = frozenset({"VEN", "VEA", "BIL"})


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


def _cell(value: Any, limit: int = 72) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _looks_cassetto(*parts: Any) -> bool:
    blob = " ".join(str(p or "").upper() for p in parts)
    return any(w in blob for w in _MATCH_WORDS)


def _parse_day(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    return datetime.strptime(raw.strip()[:10], "%Y-%m-%d")


def _build_period(
    day: Optional[datetime],
    hours: int,
    *,
    ts_col: Optional[str],
    is_timestamp: bool,
) -> Tuple[str, List[Any], str]:
    where: List[str] = []
    params: List[Any] = []
    if day is not None:
        nxt = day + timedelta(days=1)
        if ts_col:
            where.append(f"{ts_col} >= ? AND {ts_col} < ?")
            if is_timestamp:
                params.extend([day, nxt])
            else:
                params.extend([day.date(), nxt.date()])
        label = f"giorno={day.date().isoformat()}"
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=max(24, hours))
        if ts_col:
            where.append(f"{ts_col} >= ?")
            params.append(cutoff.replace(tzinfo=None) if is_timestamp else cutoff.date())
        label = f"lookback_h={hours}"
    sql = (" WHERE " + " AND ".join(where)) if where else ""
    return sql, params, label


def _scan_receipt_table(cur, mapping: Dict[str, Any], *, day: Optional[datetime], hours: int, store_filter: str) -> List[Dict[str, Any]]:
    table = mapping["table"]
    cols = list(mapping.get("columns") or [])
    col_u = {c.upper(): c for c in cols}
    ts_col = mapping.get("ts") or mapping.get("date")
    amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO") or col_u.get("TOTALEIVATO")
    doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
    store = mapping.get("store") or col_u.get("NUMEROPOS")
    code = col_u.get("CODICEMOVIMENTO")
    code_n = col_u.get("NUMEROCODICEMOVIMENTO")
    text_cols = [c for c in cols if any(h in c.upper() for h in ("DESCR", "CAUSAL", "NOTE", "INTEST", "NOME", "MOVIMENTO"))][:5]
    where_sql, params, label = _build_period(
        day,
        hours,
        ts_col=ts_col,
        is_timestamp=bool(mapping.get("ts")),
    )
    print(f"[scontrini] table={table} {label}")
    select = [c for c in (ts_col, store, doc, code, code_n, amt, *text_cols) if c]
    seen = set()
    ordered: List[str] = []
    for c in select:
        if c not in seen:
            seen.add(c)
            ordered.append(c)
    if not ordered:
        return []
    sql = f"SELECT FIRST 20000 {', '.join(ordered)} FROM {table}{where_sql}"
    if ts_col:
        sql += f" ORDER BY {ts_col} DESC"
    cur.execute(sql, params)
    rows = cur.fetchall()
    out: List[Dict[str, Any]] = []
    for row in rows:
        data = {ordered[i]: row[i] for i in range(len(ordered))}
        dtype = str(data.get(doc) or "").strip().upper() if doc else ""
        store_v = str(data.get(store) or "").strip() if store else ""
        if store_filter and store_filter not in store_v.lower() and store_filter not in " ".join(
            str(v or "") for v in row
        ).lower():
            continue
        texts = [data.get(c) for c in text_cols]
        codes = [data.get(code), data.get(code_n)]
        is_cassetto = _looks_cassetto(dtype, *codes, *texts)
        looks_cash_doc = bool(dtype) and dtype not in _SKIP_DOC and any(
            k in dtype for k in ("CAS", "PRE", "VER", "FON")
        )
        if not is_cassetto and not looks_cash_doc:
            continue
        out.append(
            {
                "source": table,
                "when": data.get(ts_col),
                "store": store_v,
                "doc": dtype or "(vuoto)",
                "code": " / ".join(_cell(v, 24) for v in codes if v not in (None, "")),
                "amount": _money(data.get(amt) if amt else 0),
                "text": " · ".join(_cell(v, 40) for v in texts if v not in (None, "")),
            }
        )
    return out


def _scan_hint_tables(cur, tables: Dict[str, str], *, day: Optional[datetime], hours: int, store_filter: str) -> List[Dict[str, Any]]:
    from app.services.easyretail_gdb_service import _table_columns

    hits: List[Dict[str, Any]] = []
    hinted = [name for upper, name in sorted(tables.items()) if any(h in upper for h in _TABLE_HINTS)]
    print(f"[tabelle] candidate={len(hinted)}")
    for name in hinted[:30]:
        tcols = _table_columns(cur, name)
        if not tcols:
            continue
        col_u = {c.upper(): c for c in tcols}
        ts_col = (
            col_u.get("DATAORA")
            or col_u.get("DATAMOVIMENTO")
            or col_u.get("DATA")
            or col_u.get("TIMESTAMP")
            or next((c for c in tcols if "DATA" in c.upper() or "ORA" in c.upper()), None)
        )
        amt = (
            col_u.get("IMPORTO")
            or col_u.get("TOTALE")
            or col_u.get("VALORE")
            or col_u.get("QUANTITA")
            or next((c for c in tcols if "IMPORTO" in c.upper() or "TOTALE" in c.upper()), None)
        )
        text_cols = [c for c in tcols if any(h in c.upper() for h in ("DESCR", "CAUSAL", "NOTE", "INTEST", "NOME", "TIPO", "CODICE", "MOVIMENTO"))][:6]
        store = col_u.get("NUMEROPOS") or col_u.get("NEGOZIO") or col_u.get("CASSA")
        where_sql, params, _label = _build_period(
            day,
            hours,
            ts_col=ts_col,
            is_timestamp=bool(ts_col and ("ORA" in ts_col.upper() or "TIME" in ts_col.upper())),
        )
        select = [c for c in (ts_col, store, amt, *text_cols) if c]
        if not select:
            continue
        sql = f"SELECT FIRST 500 {', '.join(select)} FROM {name}{where_sql}"
        try:
            cur.execute(sql, params)
            rows = cur.fetchall()
        except Exception as exc:
            print(f"  {name}: lettura saltata ({exc})")
            continue
        local = 0
        for row in rows:
            data = {select[i]: row[i] for i in range(len(select))}
            texts = [data.get(c) for c in text_cols]
            store_v = str(data.get(store) or "").strip() if store else ""
            if store_filter and store_filter not in store_v.lower() and store_filter not in " ".join(_cell(v) for v in row).lower():
                continue
            if not _looks_cassetto(name, *texts, store_v) and "CASSET" not in name.upper():
                continue
            hits.append(
                {
                    "source": name,
                    "when": data.get(ts_col),
                    "store": store_v,
                    "doc": name,
                    "code": "",
                    "amount": _money(data.get(amt) if amt else 0),
                    "text": " · ".join(_cell(v, 40) for v in texts if v not in (None, "")),
                }
            )
            local += 1
        if local:
            print(f"  {name}: {local} righe cassetto")
    return hits


def _print_hits(hits: Sequence[Dict[str, Any]]) -> Decimal:
    if not hits:
        print("\nNessun movimento cassetto trovato nel periodo.")
        return Decimal("0.00")
    print(f"\n=== movimenti cassetto ({len(hits)}) ===")
    print(f"{'quando':19} {'pos':6} {'importo':>10}  fonte / codice / testo")
    total = Decimal("0.00")
    for hit in hits:
        when = hit.get("when")
        when_s = when.strftime("%Y-%m-%d %H:%M") if hasattr(when, "strftime") else _cell(when, 19)
        amt = _money(hit.get("amount"))
        total += amt
        bits = [hit.get("source") or "", hit.get("doc") or "", hit.get("code") or "", hit.get("text") or ""]
        detail = " · ".join(b for b in bits if b)
        print(f"{when_s:19} {_cell(hit.get('store'), 6):6} {amt:>10}  {_cell(detail, 90)}")
    print(f"\nTOTALE MOVIMENTO CASSETTO: {total}")
    print("Usa questo totale in Prima Nota (conto MOVIMENTO_CASSETTO) se è un prelievo/versamento cassetto.")
    return total


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Legge movimenti cassetto da EasyRetail GDB")
    parser.add_argument("--day", help="Giorno YYYY-MM-DD (es. 2026-10-06)")
    parser.add_argument("--hours", type=int, default=0, help="Lookback ore se --day assente (default env o 72)")
    parser.add_argument("--store", default="", help="Filtro cassa/POS (es. lattea, 1, abba)")
    args = parser.parse_args(argv)

    _load_dotenv()
    from app.services.easyretail_gdb_service import (
        _list_user_tables,
        connect_gdb,
        discover_receipt_mapping,
        resolve_fbclient,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante nel .env di AtlasSync", file=sys.stderr)
        return 2

    day = _parse_day(args.day or os.getenv("DIAG_DAY") or "")
    hours = args.hours or int(os.getenv("EASYRETAIL_GDB_LOOKBACK_HOURS") or "72")
    store_filter = (args.store or os.getenv("EASYRETAIL_STORE_FILTER") or "").strip().lower()

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
        print(f"gdb={dsn}")
        if store_filter:
            print(f"store_filter={store_filter}")

        hits: List[Dict[str, Any]] = []
        hits.extend(_scan_receipt_table(cur, mapping, day=day, hours=hours, store_filter=store_filter))
        hits.extend(_scan_hint_tables(cur, tables, day=day, hours=hours, store_filter=store_filter))

        # dedupe grezzo
        seen = set()
        unique: List[Dict[str, Any]] = []
        for hit in hits:
            key = (
                str(hit.get("when")),
                str(hit.get("store")),
                str(hit.get("amount")),
                str(hit.get("doc")),
                str(hit.get("text"))[:40],
            )
            if key in seen:
                continue
            seen.add(key)
            unique.append(hit)
        unique.sort(key=lambda h: str(h.get("when") or ""), reverse=True)
        _print_hits(unique)
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
