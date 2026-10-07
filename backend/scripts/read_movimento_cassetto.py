#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Legge i movimenti cassetto da EasyRetail (GDB Firebird).

Sul PC cassa (C:\\AtlasSync):

  py -u read_movimento_cassetto.py --day 2026-10-06
  py -u read_movimento_cassetto.py --day 2026-10-06 --schema

Tabelle EasyRetail:
  MOVIMENTICASSETTIT = testate (data, causale) ← lavanderia, spesa, …
  MOVIMENTICASSETTIR = righe importo/tagli (sommate per testata se T non ha IMPORTO)
  CODICIMOVIMENTI    = anagrafica causali

Non stampa la password del database.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
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


def _cell(value: Any, limit: int = 80) -> str:
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


def _parse_day(raw: Optional[str]) -> datetime:
    if not raw:
        raise SystemExit("Indica --day YYYY-MM-DD")
    return datetime.strptime(raw.strip()[:10], "%Y-%m-%d")


def _colmap(cols: Sequence[str]) -> Dict[str, str]:
    return {c.upper(): c for c in cols}


def _pick_exact(col_u: Dict[str, str], *names: str) -> Optional[str]:
    for name in names:
        if name in col_u:
            return col_u[name]
    return None


def _pick(col_u: Dict[str, str], *names: str) -> Optional[str]:
    hit = _pick_exact(col_u, *names)
    if hit:
        return hit
    # Prefer longest name match to avoid ID matching inside NUMEROPOSTAZIONE etc.
    best: Optional[Tuple[int, str]] = None
    for upper, real in col_u.items():
        for name in names:
            if name and name in upper:
                score = len(name)
                if best is None or score > best[0]:
                    best = (score, real)
    return best[1] if best else None


def _pick_amount(col_u: Dict[str, str]) -> Optional[str]:
    return _pick(
        col_u,
        "IMPORTOMOVIMENTO",
        "IMPORTOEURO",
        "TOTALEMOVIMENTO",
        "IMPORTOCASSA",
        "IMPORTOCASSETTO",
        "VALOREEURO",
        "IMPORTO",
        "VALORE",
        "TOTALE",
        "AMOUNTEUR",
        "AMOUNT",
    )


def _dump_schema(cur, tables: Sequence[str]) -> None:
    from app.services.easyretail_gdb_service import _table_columns

    print("\n=== schema tabelle cassetto ===")
    for name in tables:
        try:
            cols = _table_columns(cur, name)
        except Exception as exc:
            print(f"{name}: errore {exc}")
            continue
        print(f"\n{name} ({len(cols)} colonne)")
        print("  ", ", ".join(cols))
        if not cols:
            continue
        # Mostra tutte le colonne sui sample (max 16 per riga leggibile)
        show = list(cols[:16])
        try:
            cur.execute(f"SELECT FIRST 8 {', '.join(show)} FROM {name} ORDER BY 1 DESC")
            rows = cur.fetchall()
        except Exception:
            try:
                cur.execute(f"SELECT FIRST 8 {', '.join(show)} FROM {name}")
                rows = cur.fetchall()
            except Exception as exc:
                print(f"  sample saltato: {exc}")
                continue
        for row in rows:
            print("  ", " | ".join(_cell(v, 28) for v in row))
        try:
            cur.execute(f"SELECT COUNT(*) FROM {name}")
            print(f"  COUNT(*) = {cur.fetchone()[0]}")
        except Exception:
            pass


def _sum_righe_by_parent(cur) -> Dict[Any, Decimal]:
    """Somma IMPORTO delle righe MOVIMENTICASSETTIR per ogni testata."""
    from app.services.easyretail_gdb_service import _table_columns

    name = "MOVIMENTICASSETTIR"
    try:
        cols = _table_columns(cur, name)
    except Exception:
        return {}
    if not cols:
        return {}
    col_u = _colmap(cols)
    parent = _pick(
        col_u,
        "NUMEROMOVIMENTOCASSETTO",
        "NUMEROMOVIMENTO",
        "IDMOVIMENTOCASSETTO",
        "IDMOVIMENTO",
        "IDTESTATA",
    )
    amt = _pick_amount(col_u)
    if not parent or not amt:
        print(f"[righe] {name}: parent={parent} importo={amt} (skip somma)")
        return {}
    print(f"[righe] {name}: somma {amt} per {parent}")
    try:
        cur.execute(f"SELECT {parent}, SUM({amt}) FROM {name} GROUP BY {parent}")
        out: Dict[Any, Decimal] = {}
        for pid, total in cur.fetchall():
            out[pid] = _money(total)
        return out
    except Exception as exc:
        print(f"[righe] somma fallita: {exc}")
        return {}


def _fetch_testate_rows(
    cur,
    *,
    ordered: List[str],
    ts_col: str,
    day: Optional[datetime],
    limit: int = 2000,
) -> Tuple[List[Any], str]:
    if day is not None:
        nxt = day + timedelta(days=1)
        attempts = [
            (f"{ts_col} >= ? AND {ts_col} < ?", [day, nxt]),
            (f"{ts_col} >= ? AND {ts_col} < ?", [day.date(), nxt.date()]),
            (f"CAST({ts_col} AS DATE) = ?", [day.date()]),
        ]
        for where, params in attempts:
            sql = (
                f"SELECT FIRST {limit} {', '.join(ordered)} FROM MOVIMENTICASSETTIT "
                f"WHERE {where} ORDER BY {ts_col}"
            )
            try:
                cur.execute(sql, params)
                return cur.fetchall(), where
            except Exception:
                continue
        # fallback python filter
        sql = (
            f"SELECT FIRST {limit} {', '.join(ordered)} FROM MOVIMENTICASSETTIT "
            f"ORDER BY {ts_col} DESC"
        )
        cur.execute(sql)
        raw = cur.fetchall()
        rows = []
        for row in raw:
            data = {ordered[i]: row[i] for i in range(len(ordered))}
            when = data.get(ts_col)
            if when is None:
                continue
            d = when.date() if hasattr(when, "date") else None
            if d == day.date() or str(when)[:10] == day.date().isoformat():
                rows.append(row)
        return rows, "python-filter"

    sql = (
        f"SELECT FIRST {limit} {', '.join(ordered)} FROM MOVIMENTICASSETTIT "
        f"ORDER BY {ts_col} DESC"
    )
    cur.execute(sql)
    return cur.fetchall(), "recent"


def _read_testate(
    cur,
    day: Optional[datetime],
    *,
    recent_if_empty: bool = True,
) -> Tuple[List[Dict[str, Any]], Decimal, bool]:
    """Legge MOVIMENTICASSETTIT; se manca IMPORTO somma le righe R."""
    from app.services.easyretail_gdb_service import _table_columns

    name = "MOVIMENTICASSETTIT"
    cols = _table_columns(cur, name)
    if not cols:
        print("ERRORE: tabella MOVIMENTICASSETTIT assente", file=sys.stderr)
        return [], Decimal("0.00"), False
    col_u = _colmap(cols)

    id_col = _pick(
        col_u,
        "NUMEROMOVIMENTOCASSETTO",
        "NUMEROMOVIMENTO",
        "IDMOVIMENTOCASSETTO",
        "IDMOVIMENTO",
        "PROGRESSIVO",
    )
    ts_col = _pick(col_u, "DATAORA", "DATAMOVIMENTO", "DATAORAMOVIMENTO", "TIMESTAMP", "DATA")
    amt_col = _pick_amount(col_u)
    segno_col = _pick(col_u, "SEGNO", "TIPOSEGNO", "ENTRAUSCITA", "DIREZIONE")
    code_col = _pick(col_u, "CODICEMOVIMENTO", "NUMEROCODICEMOVIMENTO", "CODICECAUSALE")
    desc_col = _pick(col_u, "DESCRIZIONE", "CAUSALE", "NOTE", "INTEST", "NOMEMOVIMENTO")
    store_col = _pick(col_u, "NUMEROPOSTAZIONE", "NUMEROPOS", "NUMEROCASSA", "CASSA")
    tipo_col = _pick(col_u, "TIPOMOVIMENTO", "TIPO", "TIPODOCUMENTO")

    print(f"[testate] {name}")
    print(
        f"  id={id_col} ts={ts_col} importo={amt_col} segno={segno_col} "
        f"codice={code_col} desc={desc_col} pos={store_col} tipo={tipo_col}"
    )
    if not ts_col:
        print("ERRORE: nessuna colonna data su MOVIMENTICASSETTIT", file=sys.stderr)
        return [], Decimal("0.00"), False

    select = [c for c in (id_col, ts_col, store_col, tipo_col, code_col, segno_col, amt_col, desc_col) if c]
    ordered: List[str] = []
    seen = set()
    for c in select:
        if c not in seen:
            seen.add(c)
            ordered.append(c)

    r_sums = _sum_righe_by_parent(cur) if not amt_col else {}
    if amt_col:
        # anche con importo su T, se è sempre 0 usiamo R come fallback per riga
        r_sums = _sum_righe_by_parent(cur)

    rows, used = _fetch_testate_rows(cur, ordered=ordered, ts_col=ts_col, day=day)
    print(f"  filtro={used} righe={len(rows)}")
    used_recent = False
    if not rows and day is not None and recent_if_empty:
        rows, used = _fetch_testate_rows(cur, ordered=ordered, ts_col=ts_col, day=None, limit=30)
        used_recent = True
        print(f"  giorno vuoto → ultimi movimenti ({used}) righe={len(rows)}")

    hits: List[Dict[str, Any]] = []
    total = Decimal("0.00")
    for row in rows:
        data = {ordered[i]: row[i] for i in range(len(ordered))}
        pid = data.get(id_col) if id_col else None
        amt = _money(data.get(amt_col) if amt_col else 0)
        if amt == 0 and pid in r_sums:
            amt = r_sums[pid]
            src = "R"
        else:
            src = "T" if amt_col else ("R" if pid in r_sums else "?")
        segno_raw = str(data.get(segno_col) or "").strip().upper() if segno_col else ""
        if segno_raw in {"-1", "-", "U", "USC", "USCITA", "OUT", "P"} or (
            segno_col and _money(data.get(segno_col)) < 0 and amt > 0
        ):
            if amt > 0:
                amt = -amt
        desc = _cell(data.get(desc_col) if desc_col else "", 60)
        hits.append(
            {
                "id": pid,
                "when": data.get(ts_col),
                "store": _cell(data.get(store_col) if store_col else "", 8),
                "tipo": _cell(data.get(tipo_col) if tipo_col else "", 16),
                "code": _cell(data.get(code_col) if code_col else "", 16),
                "segno": segno_raw,
                "amount": amt,
                "desc": desc,
                "src": src,
            }
        )
        total += amt
    return hits, total, used_recent


def _read_codici(cur) -> None:
    from app.services.easyretail_gdb_service import _table_columns

    name = "CODICIMOVIMENTI"
    try:
        cols = _table_columns(cur, name)
    except Exception:
        return
    if not cols:
        return
    col_u = _colmap(cols)
    code = _pick(col_u, "CODICEMOVIMENTO", "CODICE", "NUMEROCODICEMOVIMENTO")
    desc = _pick(col_u, "DESCRIZIONE", "INLABEL", "NOME")
    segno = _pick(col_u, "SEGNO", "TIPOSEGNO")
    select = [c for c in (code, desc, segno) if c]
    if not select:
        return
    print("\n=== causali CODICIMOVIMENTI (cassetto/versamento/prelievo) ===")
    try:
        cur.execute(f"SELECT FIRST 200 {', '.join(select)} FROM {name}")
        rows = cur.fetchall()
    except Exception as exc:
        print(f"  saltato: {exc}")
        return
    for row in rows:
        line = " | ".join(_cell(v, 40) for v in row)
        up = line.upper()
        if any(k in up for k in ("CASSET", "PRELIEV", "VERSAMENT", "FONDO", "IVA", "BANCA", "LAVAND", "SPESA")):
            print(" ", line)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Legge movimenti cassetto EasyRetail")
    parser.add_argument("--day", required=True, help="Giorno YYYY-MM-DD")
    parser.add_argument("--schema", action="store_true", help="Stampa colonne/sample delle tabelle cassetto")
    args = parser.parse_args(argv)

    _load_dotenv()
    from app.services.easyretail_gdb_service import connect_gdb, resolve_fbclient

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante nel .env", file=sys.stderr)
        return 2

    day = _parse_day(args.day)
    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        cur = con.cursor()
        print(f"gdb={dsn}")
        print(f"giorno={day.date().isoformat()}")

        if args.schema:
            _dump_schema(
                cur,
                ("MOVIMENTICASSETTIT", "MOVIMENTICASSETTIR", "CODICIMOVIMENTI"),
            )

        hits, total, used_recent = _read_testate(cur, day)
        _read_codici(cur)

        label = day.date().isoformat()
        if used_recent:
            print(f"\n=== nessun movimento il {label}: ultimi in GDB ({len(hits)}) ===")
            print("(Su Via Lattea quel giorno puo essere vuoto: controlla data lettura / altra cassa.)")
        else:
            print(f"\n=== movimenti cassetto del {label} ({len(hits)}) ===")

        if not hits:
            print("Nessuna testata in MOVIMENTICASSETTIT.")
            print("Rilancia con --schema e incolla l'output.")
            return 0

        print(f"{'quando':19} {'pos':5} {'importo':>10}  {'src':3}  descrizione")
        for hit in hits:
            when = hit["when"]
            when_s = when.strftime("%Y-%m-%d %H:%M") if hasattr(when, "strftime") else _cell(when, 19)
            print(
                f"{when_s:19} {hit['store']:5} {hit['amount']:>10}  "
                f"{hit['src']:3}  {hit['desc'] or hit['code'] or hit['tipo']}"
            )

        print(f"\nTOTALE: {total}")
        print("src=T importo in testata; src=R somma righe MOVIMENTICASSETTIR.")
        print("Usa questo totale per CONTANTI CASSETTO / MOVIMENTO_CASSETTO in Prima Nota.")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())
