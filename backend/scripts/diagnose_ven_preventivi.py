#!/usr/bin/env python3
# -*- coding: ascii -*-
"""I Preventivi del PDF sono DENTRO TIPODOCUMENTO=VEN.

PDF Abba 08/09:
  Scontrini 294 x 3705.44
  Preventivi 149 x 1352.75
  Fatture      8 x  302.67
  Totale     451 x 5360.86
GDB: VEN n=451 EUR 5360.86  (match esatto)

Cerca discriminatore (NUMERODOCUMENTO prefix, ecc.)

  cd C:\\AtlasSync
  set DIAG_DAY=2026-09-08
  set DIAG_POS=1
  py -u diagnose_ven_preventivi.py
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
    pos_filter = (os.getenv("DIAG_POS") or "1").strip()
    day_dt = datetime.strptime(day, "%Y-%m-%d")
    day_next = day_dt + timedelta(days=1)

    targets = {
        "scontrini": (294, 3705.44),
        "preventivi": (149, 1352.75),
        "fatture": (8, 302.67),
    }

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
        ts = col_u.get("DATAMOVIMENTO")
        amt = col_u.get("TOTALEDOCUMENTO")
        doc = col_u.get("TIPODOCUMENTO")
        store = col_u.get("NUMEROPOS")
        rid = col_u.get("NUMEROMOVIMENTO")

        # pull wide VEN rows
        extra = [
            "NUMDOC",
            "NUMDOCLOCALE",
            "NUMERODOCUMENTO",
            "PROFORMA",
            "NUMEROPROFORMA",
            "DATAPROFORMA",
            "DOCUMENTOACCONTO",
            "VARIANTE",
            "NUMEROMODELLOSTAMPA",
            "CODICEMOVIMENTO",
            "NUMEROCODICEMOVIMENTO",
            "CLIFOR",
            "INGRESSOUSCITA",
            "PARTITAIVA",
            "CODICEFISCALE",
            "INTESTAZIONE",
            "NUMEROAZIENDA",
            "TIPOPROVENIENZA",
            "NUMEROPROVENIENZA",
            "FLAGANNULLATO",
            "LOGICDELETE",
            "SINCROFIELD",
            "NUMEROMOVIMENTOCONTABILE",
        ]
        use = [c for c in [rid, doc, store, ts, amt] if c]
        for name in extra:
            if name in col_u and col_u[name] not in use:
                use.append(col_u[name])

        cur.execute(
            "SELECT FIRST 20000 %s FROM %s WHERE %s >= ? AND %s < ? AND %s = 'VEN' AND %s = ?"
            % (", ".join(use), table, ts, ts, doc, store),
            [day_dt, day_next, int(pos_filter)],
        )
        raw = cur.fetchall()
        idx = {c.upper(): i for i, c in enumerate([u.upper() for u in use])}
        # fix: use actual column names upper
        idx = {}
        for i, c in enumerate(use):
            idx[c.upper()] = i

        def g(r, name):
            i = idx.get(name.upper())
            return None if i is None else r[i]

        print("dsn=%s day=%s POS=%s VEN_n=%s" % (dsn, day, pos_filter, len(raw)))
        tot = sum(_f(g(r, "TOTALEDOCUMENTO")) for r in raw)
        print("VEN tot EUR %.2f (PDF totale 5360.86)" % tot)

        # --- NUMERODOCUMENTO string analysis ---
        print("\n=== NUMERODOCUMENTO: lunghezze / prefissi ===")
        by_len = Counter()
        by_p1 = defaultdict(lambda: {"n": 0, "tot": 0.0, "samples": []})
        by_p2 = defaultdict(lambda: {"n": 0, "tot": 0.0, "samples": []})
        by_p3 = defaultdict(lambda: {"n": 0, "tot": 0.0, "samples": []})
        by_p4 = defaultdict(lambda: {"n": 0, "tot": 0.0, "samples": []})
        null_n = 0
        null_tot = 0.0
        for r in raw:
            nd = g(r, "NUMERODOCUMENTO")
            val = _f(g(r, "TOTALEDOCUMENTO"))
            if nd is None or str(nd).strip() == "":
                null_n += 1
                null_tot += val
                continue
            s = str(int(nd)) if isinstance(nd, (int, float)) else str(nd).strip()
            # normalize float-like
            if s.endswith(".0"):
                s = s[:-2]
            by_len[len(s)] += 1
            for pref_map, nchar in ((by_p1, 1), (by_p2, 2), (by_p3, 3), (by_p4, 4)):
                p = s[:nchar]
                pref_map[p]["n"] += 1
                pref_map[p]["tot"] += val
                if len(pref_map[p]["samples"]) < 3:
                    pref_map[p]["samples"].append(
                        (s, val, g(r, "NUMDOC"), g(r, "NUMEROMOVIMENTO"))
                    )

        print("  null/empty: n=%s EUR %.2f" % (null_n, null_tot))
        print("  lengths:", dict(by_len))

        def show_pref(label, mp):
            print("\n--- prefisso %s ---" % label)
            for p, hit in sorted(mp.items(), key=lambda kv: -kv[1]["n"]):
                mark = ""
                for name, (tn, te) in targets.items():
                    if abs(hit["n"] - tn) <= 2 and abs(hit["tot"] - te) < 5:
                        mark = "  <== PDF %s" % name
                    elif abs(hit["n"] - tn) <= 2 or abs(hit["tot"] - te) < 5:
                        mark = "  ~%s?" % name
                print(
                    "  '%s': n=%s EUR %.2f samples=%s%s"
                    % (p, hit["n"], hit["tot"], hit["samples"], mark)
                )

        show_pref("1 cifra", by_p1)
        show_pref("2 cifre", by_p2)
        show_pref("3 cifre", by_p3)
        show_pref("4 cifre", by_p4)

        # suffix / last 3-4 digits vs NUMDOC
        print("\n=== NUMERODOCUMENTO ultimi digit vs NUMDOC ===")
        agree = 0
        disagree = 0
        for r in raw:
            nd = g(r, "NUMERODOCUMENTO")
            numdoc = g(r, "NUMDOC")
            if nd is None or numdoc is None:
                continue
            s = str(int(nd)) if isinstance(nd, (int, float)) else str(nd).strip()
            if s.endswith(".0"):
                s = s[:-2]
            if not s.isdigit():
                # fatture tipo 1253/A/2026
                continue
            try:
                last = int(s[-4:])
                last3 = int(s[-3:])
                ndi = int(numdoc)
                last5 = int(s[-5:]) if len(s) >= 5 else -1
            except Exception:
                continue
            if last == ndi or last3 == ndi or last5 == ndi:
                agree += 1
            else:
                disagree += 1
        print("  suffix match NUMDOC: agree~%s disagree~%s" % (agree, disagree))

        # decode candidate: digits groups
        print("\n=== split NUMERODOCUMENTO (len 13 tipico) ===")
        # e.g. 2990070900011 / 5990070901497
        groups = defaultdict(lambda: {"n": 0, "tot": 0.0, "min_tail": None, "max_tail": None})
        for r in raw:
            nd = g(r, "NUMERODOCUMENTO")
            if nd is None:
                continue
            s = str(int(nd)) if isinstance(nd, (int, float)) else str(nd).strip()
            if s.endswith(".0"):
                s = s[:-2]
            if len(s) < 10:
                key = "short:%s" % s
                tail = 0
            else:
                # try tipo(1) + rest
                key = "t%s|mid=%s" % (s[0], s[1:9])
                try:
                    tail = int(s[9:])
                except Exception:
                    tail = -1
            val = _f(g(r, "TOTALEDOCUMENTO"))
            groups[key]["n"] += 1
            groups[key]["tot"] += val
            if groups[key]["min_tail"] is None or (tail >= 0 and tail < groups[key]["min_tail"]):
                groups[key]["min_tail"] = tail
            if groups[key]["max_tail"] is None or tail > groups[key]["max_tail"]:
                groups[key]["max_tail"] = tail

        for key, hit in sorted(groups.items(), key=lambda kv: -kv[1]["n"]):
            mark = ""
            for name, (tn, te) in targets.items():
                if abs(hit["n"] - tn) <= 2 and abs(hit["tot"] - te) < 5:
                    mark = "  <== PDF %s" % name
            print(
                "  %s: n=%s EUR %.2f tail=%s..%s%s"
                % (key, hit["n"], hit["tot"], hit["min_tail"], hit["max_tail"], mark)
            )

        # other discriminator fields: distinct value counts matching targets
        print("\n=== altri campi: valori con n~149 o n~8 o n~294 ===")
        skip = {
            "NUMEROMOVIMENTO",
            "DATAMOVIMENTO",
            "TOTALEDOCUMENTO",
            "TIPODOCUMENTO",
            "NUMEROPOS",
            "NUMERODOCUMENTO",
            "NUMDOC",
            "NUMDOCLOCALE",
        }
        for col in use:
            cu = col.upper()
            if cu in skip:
                continue
            by = defaultdict(lambda: {"n": 0, "tot": 0.0})
            for r in raw:
                v = g(r, cu)
                key = "(null)" if v is None or str(v).strip() == "" else str(v).strip()[:40]
                by[key]["n"] += 1
                by[key]["tot"] += _f(g(r, "TOTALEDOCUMENTO"))
            interesting = []
            for key, hit in by.items():
                for name, (tn, te) in targets.items():
                    if abs(hit["n"] - tn) <= 2 or abs(hit["tot"] - te) < 3:
                        interesting.append((name, key, hit))
            if interesting:
                print("  FIELD %s:" % cu)
                for name, key, hit in interesting:
                    print(
                        "    %s -> '%s' n=%s EUR %.2f"
                        % (name, key, hit["n"], hit["tot"])
                    )

        # PAGAMENTI: preventivi often have NO payment?
        tables = {t.upper(): t for t in _list_user_tables(cur)}
        pay = tables.get("PAGAMENTI")
        if pay and rid:
            print("\n=== VEN con / senza PAGAMENTI ===")
            try:
                pcols = {c.upper(): c for c in _table_columns(cur, pay)}
                pmov = pcols.get("NUMEROMOVIMENTO")
                ids = [g(r, "NUMEROMOVIMENTO") for r in raw]
                paid = set()
                for i in range(0, len(ids), 800):
                    chunk = [x for x in ids[i : i + 800] if x is not None]
                    if not chunk:
                        continue
                    marks = ",".join("?" * len(chunk))
                    cur.execute(
                        "SELECT DISTINCT %s FROM %s WHERE %s IN (%s)"
                        % (pmov, pay, pmov, marks),
                        chunk,
                    )
                    for (mid,) in cur.fetchall():
                        paid.add(mid)
                with_p = {"n": 0, "tot": 0.0}
                without = {"n": 0, "tot": 0.0}
                for r in raw:
                    mid = g(r, "NUMEROMOVIMENTO")
                    val = _f(g(r, "TOTALEDOCUMENTO"))
                    if mid in paid:
                        with_p["n"] += 1
                        with_p["tot"] += val
                    else:
                        without["n"] += 1
                        without["tot"] += val
                print("  con PAGAMENTI: n=%s EUR %.2f" % (with_p["n"], with_p["tot"]))
                print(
                    "  SENZA PAGAMENTI: n=%s EUR %.2f"
                    % (without["n"], without["tot"])
                )
                for name, (tn, te) in targets.items():
                    if abs(without["n"] - tn) <= 2 and abs(without["tot"] - te) < 5:
                        print("  <== SENZA PAGAMENTI = PDF %s" % name)
                    if abs(with_p["n"] - tn) <= 2 and abs(with_p["tot"] - te) < 5:
                        print("  <== CON PAGAMENTI = PDF %s" % name)
            except Exception as exc:
                print("  ERRORE:", exc)

        # sample 5 of each prefix-1 if we found 2/5
        print("\n=== sample 5 per prefisso 1a cifra NUMERODOCUMENTO ===")
        by_first = defaultdict(list)
        for r in raw:
            nd = g(r, "NUMERODOCUMENTO")
            if nd is None:
                by_first["null"].append(r)
                continue
            s = str(int(nd)) if isinstance(nd, (int, float)) else str(nd).strip()
            if s.endswith(".0"):
                s = s[:-2]
            by_first[s[0]].append(r)
        for first, lst in sorted(by_first.items()):
            print("  first=%s n=%s" % (first, len(lst)))
            for r in lst[:5]:
                nd = g(r, "NUMERODOCUMENTO")
                print(
                    "    id=%s EUR=%.2f NUMDOC=%s NUMDOCLOC=%s NUMERODOC=%s PIVA=%s INT=%s"
                    % (
                        g(r, "NUMEROMOVIMENTO"),
                        _f(g(r, "TOTALEDOCUMENTO")),
                        g(r, "NUMDOC"),
                        g(r, "NUMDOCLOCALE"),
                        nd,
                        g(r, "PARTITAIVA"),
                        (str(g(r, "INTESTAZIONE") or "")[:30] or None),
                    )
                )

        print("\n=== lettura ===")
        print("Cerca <== PDF preventivi. Quello e' il discriminatore da usare in sync.")
        print("=== fine ===")
        return 0
    finally:
        try:
            con.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
