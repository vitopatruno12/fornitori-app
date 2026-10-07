#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cerca nel GDB EasyRetail i totali della LETTURA OPERATORE (carta).

Sul PC cassa (C:\\AtlasSync):

  py -u diagnose_lettura_giornate.py
  set DIAG_DAY=2026-10-07
  py -u diagnose_lettura_giornate.py

Non stampa la password del database.
"""

from __future__ import annotations

import os
import sys
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

_FOCUS = (
    "GIORNATEPOS",
    "GIORNATE",
    "FORMEPAGAMENTI",
    "STAMPEGIORNATAT",
    "STAMPEGIORNATAR",
)

_MONEY = (
    "CONTANT",
    "BANCOM",
    "CARTA",
    "INCASS",
    "CASSA",
    "TOTALE",
    "IMPORTO",
    "ELETTRON",
    "FATTUR",
    "POS",
    "PAGAMENT",
    "VALORE",
    "NETTO",
    "LORDO",
)


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


def _cell(value, limit: int = 36) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _safe_close(cur) -> None:
    try:
        cur.close()
    except Exception:
        pass


def _columns(con, table: str):
    cur = con.cursor()
    try:
        cur.execute(
            "SELECT TRIM(RF.RDB$FIELD_NAME) FROM RDB$RELATION_FIELDS RF "
            "WHERE TRIM(RF.RDB$RELATION_NAME) = ? "
            "ORDER BY RF.RDB$FIELD_POSITION",
            (table.upper(),),
        )
        return [str(r[0]).strip().upper() for r in cur.fetchall() if r and r[0]]
    finally:
        _safe_close(cur)


def _list_tables(con):
    cur = con.cursor()
    try:
        cur.execute(
            "SELECT TRIM(RDB$RELATION_NAME) FROM RDB$RELATIONS "
            "WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL "
            "ORDER BY 1"
        )
        return [str(r[0]).strip() for r in cur.fetchall() if r and r[0]]
    finally:
        _safe_close(cur)


def _dump_table(con, name: str, day_raw: str) -> None:
    try:
        cols = _columns(con, name)
    except Exception as exc:
        print(f"\n=== {name}: errore colonne {exc} ===")
        return
    if not cols:
        print(f"\n=== {name}: assente ===")
        return

    interesting = [c for c in cols if any(n in c for n in _MONEY)]
    print(f"\n=== {name} ({len(cols)} col) ===")
    print("  colonne:", ", ".join(cols))
    if interesting:
        print("  € candidate:", ", ".join(interesting))

    show = (interesting or cols)[:14]
    order = next((c for c in cols if "DATA" in c or c.endswith("ORA") or "GIORN" in c), show[0])

    cur = con.cursor()
    try:
        sql = f"SELECT FIRST 8 {', '.join(show)} FROM {name} ORDER BY {order} DESC"
        cur.execute(sql)
        rows = cur.fetchall()
        print(f"  ultimi (ORDER BY {order}):")
        for row in rows:
            print("  ", " | ".join(_cell(v) for v in row))
    except Exception as exc:
        print(f"  sample fallito: {exc}")
        _safe_close(cur)
        cur = con.cursor()
        try:
            cur.execute(f"SELECT FIRST 5 {', '.join(show)} FROM {name}")
            for row in cur.fetchall():
                print("  ", " | ".join(_cell(v) for v in row))
        except Exception as exc2:
            print(f"  sample2 fallito: {exc2}")
    finally:
        _safe_close(cur)

    if not day_raw:
        return

    # prova filtri data comuni
    day = datetime.strptime(day_raw, "%Y-%m-%d")
    nxt = day + timedelta(days=1)
    date_cols = [c for c in cols if "DATA" in c or c.endswith("ORA")]
    for dc in date_cols[:3]:
        cur = con.cursor()
        try:
            cur.execute(
                f"SELECT FIRST 15 {', '.join(show)} FROM {name} "
                f"WHERE {dc} >= ? AND {dc} < ? ORDER BY {dc}",
                [day, nxt],
            )
            rows = cur.fetchall()
            print(f"  filtro {dc}={day_raw}: {len(rows)} righe")
            for row in rows[:10]:
                print("   *", " | ".join(_cell(v) for v in row))
        except Exception as exc:
            print(f"  filtro {dc}: {exc}")
        finally:
            _safe_close(cur)

    # GIORNATEPOS a volte ha solo NUMEROGIORNATA / chiavi senza timestamp
    for key in ("NUMEROGIORNATA", "NUMEROGIORNOPOS", "ANNO", "MESE"):
        if key not in cols:
            continue
        cur = con.cursor()
        try:
            if key == "ANNO" and "MESE" in cols:
                cur.execute(
                    f"SELECT FIRST 20 {', '.join(show)} FROM {name} "
                    f"WHERE ANNO = ? AND MESE = ?",
                    [day.year, day.month],
                )
            elif key.startswith("NUMERO"):
                # ultimi record: non filtriamo per giorno numerico
                continue
            else:
                continue
            rows = cur.fetchall()
            print(f"  filtro {key} mese: {len(rows)} righe")
            for row in rows[:10]:
                print("   *", " | ".join(_cell(v) for v in row))
        except Exception as exc:
            print(f"  filtro {key}: {exc}")
        finally:
            _safe_close(cur)


def _scan_money_columns(con, tables) -> None:
    print("\n=== scan colonne CONTANTI/BANCOMAT/INCASSO in tutto il GDB ===")
    hits = []
    for t in tables:
        try:
            cols = _columns(con, t)
        except Exception:
            continue
        money = [
            c
            for c in cols
            if any(x in c for x in ("CONTANT", "BANCOM", "INCASS", "INCASSA", "IN_CASSA", "TOTCASSA"))
        ]
        if money:
            hits.append((t, money))
            print(f"  {t}: {', '.join(money)}")
    if not hits:
        print("  nessuna colonna CONTANTI/BANCOMAT/INCASSO trovata nei nomi campo")


def main() -> int:
    _load_dotenv()
    from app.services.easyretail_gdb_service import connect_gdb, resolve_fbclient

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    if not dsn:
        print("ERRORE: EASYRETAIL_GDB_PATH mancante", file=sys.stderr)
        return 2

    day_raw = (os.getenv("DIAG_DAY") or "").strip()[:10]
    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        tables = _list_tables(con)
        print(f"gdb={dsn}")
        print(f"tabelle={len(tables)} day_filter={day_raw or '(nessuno)'}")

        focus = [t for t in tables if t.upper() in {x.upper() for x in _FOCUS}]
        # aggiungi altre GIORN*/CHIUSUR*
        for t in tables:
            u = t.upper()
            if u in {x.upper() for x in focus}:
                continue
            if any(h in u for h in ("GIORNAT", "CHIUSUR", "TOTALI", "RAPPORTO", "LETTURA")):
                focus.append(t)

        print("\n=== focus ===")
        for t in focus:
            print(" ", t)

        for name in focus:
            _dump_table(con, name, day_raw)

        _scan_money_columns(con, tables)

        print(
            "\nFine. Incolla l'output (soprattutto GIORNATEPOS + scan CONTANTI/BANCOMAT)."
        )
        return 0
    finally:
        try:
            con.close()
        except Exception as exc:
            print(f"(close warning: {exc})")


if __name__ == "__main__":
    raise SystemExit(main())
