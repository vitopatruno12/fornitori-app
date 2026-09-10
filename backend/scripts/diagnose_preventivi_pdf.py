#!/usr/bin/env python3
# -*- coding: ascii -*-
"""Cerca i Preventivi del Rapporto Complessivo Abba.

PDF 08/09/2026 Via Abba:
  Preventivi - da 1 a 149 | qta=149 | tot=1352.75

  cd C:\\AtlasSync
  set DIAG_DAY=2026-09-08
  py -u diagnose_preventivi_pdf.py
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

    day = (os.getenv("DIAG_DAY") or "2026-09-08").strip()
    day_dt = datetime.strptime(day, "%Y-%m-%d")
    day_next = day_dt + timedelta(days=1)
    target_n = int(os.getenv("DIAG_TARGET_N") or "149")
    target_eur = float(os.getenv("DIAG_TARGET_EUR") or "1352.75")
    pos_filter = (os.getenv("DIAG_POS") or "1").strip()  # Abba=1

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
        ts = mapping.get("ts") or col_u.get("DATAMOVIMENTO")
        amt = mapping.get("amount") or col_u.get("TOTALEDOCUMENTO")
        doc = mapping.get("doc_type") or col_u.get("TIPODOCUMENTO")
        rid = mapping.get("id") or col_u.get("NUMEROMOVIMENTO")
        store = mapping.get("store") or col_u.get("NUMEROPOS")
        tables = {t.upper(): t for t in _list_user_tables(cur)}

        print("dsn=%s day=%s POS=%s" % (dsn, day, pos_filter))
        print("PDF target: Preventivi n=%s EUR %.2f" % (target_n, target_eur))

        # load all columns for the day+POS (wide)
        want = [
            "NUMEROMOVIMENTO",
            "TIPODOCUMENTO",
            "CODICEMOVIMENTO",
            "NUMEROCODICEMOVIMENTO",
            "NUMEROPOS",
            "DATAMOVIMENTO",
            "TOTALEDOCUMENTO",
            "NUMDOC",
            "NUMDOCLOCALE",
            "NUMERODOCUMENTO",
            "PROFORMA",
            "NUMEROPROFORMA",
            "DATAPROFORMA",
            "NUMEROMODELLOSTAMPA",
            "DOCUMENTOACCONTO",
            "VARIANTE",
            "FLAGANNULLATO",
            "LOGICDELETE",
            "NUMEROGIORNOPOS",
        ]
        use = [col_u[c] for c in want if c in col_u]
        cur.execute(
            "SELECT FIRST 20000 %s FROM %s WHERE %s >= ? AND %s < ?"
            % (", ".join(use), table, ts, ts),
            [day_dt, day_next],
        )
        raw = cur.fetchall()
        idx = {c.upper(): i for i, c in enumerate(use)}

        def g(r, name):
            i = idx.get(name)
            return None if i is None else r[i]

        rows = []
        for r in raw:
            pos = g(r, "NUMEROPOS")
            p = str(pos).strip() if pos is not None else "(vuoto)"
            if pos_filter and pos_filter != "*" and p != pos_filter:
                # also keep POS=0 BIL for compare
                if p not in (pos_filter, "0"):
                    continue
            rows.append(r)

        print("rows day (POS %s or 0): %s" % (pos_filter, len(rows)))

        # group by TIPODOCUMENTO
        print("\n=== per TIPODOCUMENTO (POS=%s) ===" % pos_filter)
        by_doc = defaultdict(lambda: {"n": 0, "tot": 0.0, "numdoc_max": 0, "numdoc_vals": []})
        for r in rows:
            p = str(g(r, "NUMEROPOS")).strip() if g(r, "NUMEROPOS") is not None else "(vuoto)"
            if p != pos_filter:
                continue
            dtype = str(g(r, "TIPODOCUMENTO") or "").strip()
            val = _f(g(r, "TOTALEDOCUMENTO"))
            by_doc[dtype]["n"] += 1
            by_doc[dtype]["tot"] += val
            nd = g(r, "NUMDOC")
            try:
                ndi = int(nd or 0)
                by_doc[dtype]["numdoc_max"] = max(by_doc[dtype]["numdoc_max"], ndi)
                if ndi:
                    by_doc[dtype]["numdoc_vals"].append(ndi)
            except Exception:
                pass
        for dtype, hit in sorted(by_doc.items(), key=lambda kv: -kv[1]["tot"]):
            nds = sorted(hit["numdoc_vals"])
            rng = ""
            if nds:
                rng = " numdoc=%s..%s" % (nds[0], nds[-1])
            mark = ""
            if abs(hit["n"] - target_n) <= 2 or abs(hit["tot"] - target_eur) < 5:
                mark = "  <== VICINO AL PDF"
            print(
                "  %s: n=%s EUR %.2f maxNUMDOC=%s%s%s"
                % (dtype, hit["n"], hit["tot"], hit["numdoc_max"], rng, mark)
            )

        # hunt: any field sequence 1..149 and tot ~1352
        print("\n=== caccia campi numerazione (range ~1..149) ===")
        for field in (
            "NUMDOC",
            "NUMDOCLOCALE",
            "NUMERODOCUMENTO",
            "NUMEROPROFORMA",
            "NUMEROGIORNOPOS",
            "NUMEROMODELLOSTAMPA",
        ):
            if field not in idx:
                continue
            vals = []
            tot = 0.0
            n = 0
            docs = Counter()
            for r in rows:
                p = str(g(r, "NUMEROPOS")).strip() if g(r, "NUMEROPOS") is not None else "(vuoto)"
                if p != pos_filter:
                    continue
                try:
                    v = int(g(r, field) or 0)
                except Exception:
                    continue
                if v <= 0:
                    continue
                vals.append(v)
                tot += _f(g(r, "TOTALEDOCUMENTO"))
                n += 1
                docs[str(g(r, "TIPODOCUMENTO") or "")] += 1
            if not vals:
                print("  %s: (vuoto)" % field)
                continue
            vals_s = sorted(set(vals))
            print(
                "  %s: n=%s unique=%s min=%s max=%s totEUR=%.2f docs=%s"
                % (field, n, len(vals_s), vals_s[0], vals_s[-1], tot, dict(docs))
            )
            # subset where field in 1..149
            sub_n = 0
            sub_tot = 0.0
            sub_docs = Counter()
            for r in rows:
                p = str(g(r, "NUMEROPOS")).strip() if g(r, "NUMEROPOS") is not None else "(vuoto)"
                if p != pos_filter:
                    continue
                try:
                    v = int(g(r, field) or 0)
                except Exception:
                    continue
                if v < 1 or v > target_n + 5:
                    continue
                sub_n += 1
                sub_tot += _f(g(r, "TOTALEDOCUMENTO"))
                sub_docs[str(g(r, "TIPODOCUMENTO") or "")] += 1
            mark = ""
            if abs(sub_n - target_n) <= 5 or abs(sub_tot - target_eur) < 20:
                mark = "  <== CANDIDATO"
            print(
                "    filtra 1..%s: n=%s EUR %.2f docs=%s%s"
                % (target_n + 5, sub_n, sub_tot, dict(sub_docs), mark)
            )

        # NUMDOC=0 with amount: all types POS
        print("\n=== POS=%s NUMDOC=0 con importo>0 ===" % pos_filter)
        z = defaultdict(lambda: {"n": 0, "tot": 0.0})
        for r in rows:
            p = str(g(r, "NUMEROPOS")).strip() if g(r, "NUMEROPOS") is not None else "(vuoto)"
            if p != pos_filter:
                continue
            if _f(g(r, "NUMDOC")) != 0:
                continue
            val = _f(g(r, "TOTALEDOCUMENTO"))
            if val <= 0:
                continue
            dtype = str(g(r, "TIPODOCUMENTO") or "")
            z[dtype]["n"] += 1
            z[dtype]["tot"] += val
        for dtype, hit in sorted(z.items(), key=lambda kv: -kv[1]["tot"]):
            mark = "  <==" if abs(hit["n"] - target_n) <= 5 or abs(hit["tot"] - target_eur) < 20 else ""
            print("  %s: n=%s EUR %.2f%s" % (dtype, hit["n"], hit["tot"], mark))
        if not z:
            print("  (nessuno)")

        # VEA detail
        print("\n=== VEA POS=%s ===" % pos_filter)
        n = 0
        tot = 0.0
        for r in rows:
            p = str(g(r, "NUMEROPOS")).strip() if g(r, "NUMEROPOS") is not None else "(vuoto)"
            if p != pos_filter:
                continue
            if str(g(r, "TIPODOCUMENTO") or "") != "VEA":
                continue
            n += 1
            tot += _f(g(r, "TOTALEDOCUMENTO"))
            if n <= 12:
                print(
                    "  id=%s EUR %.2f numdoc=%s numdocloc=%s numdocum=%s proforma=%s"
                    % (
                        g(r, "NUMEROMOVIMENTO"),
                        _f(g(r, "TOTALEDOCUMENTO")),
                        g(r, "NUMDOC"),
                        g(r, "NUMDOCLOCALE"),
                        g(r, "NUMERODOCUMENTO"),
                        g(r, "NUMEROPROFORMA"),
                    )
                )
        print("  TOT VEA: n=%s EUR %.2f" % (n, tot))

        # search tables with PREVENT in name + counts
        print("\n=== tabelle *PREVENT* / *PROFORMA* / *QUOTE* ===")
        for u, t in sorted(tables.items()):
            if not any(k in u for k in ("PREVENT", "PROFORMA", "QUOTE", "NONFISC")):
                continue
            try:
                tcols = _table_columns(cur, t)
                cur.execute("SELECT COUNT(*) FROM %s" % t)
                cnt = cur.fetchone()[0]
                print("  %s count=%s cols=%s" % (t, cnt, ", ".join(tcols[:25])))
            except Exception as exc:
                print("  %s ERRORE %s" % (t, exc))

        # STAT / report tables?
        print("\n=== tabelle nome *STAT* / *RAPPORTO* / *CHIUSUR* (sample) ===")
        hits = [
            t
            for u, t in sorted(tables.items())
            if any(k in u for k in ("STAT", "RAPPORTO", "CHIUSUR", "TOTALI", "XREPORT", "ZREPORT"))
        ]
        for t in hits[:40]:
            print(" ", t)

        print("\n=== lettura ===")
        print("PDF Abba 08/09: Preventivi 149 x 1352.75")
        print("Se nessuna riga ha <== CANDIDATO, i Preventivi NON sono in MOVIMENTIT.")
        print("=== fine ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
