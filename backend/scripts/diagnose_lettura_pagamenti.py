#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ricostruisce CONTANTI / BANCOMAT della lettura sommando PAGAMENTI.

  cd C:\\AtlasSync
  set DIAG_DAY=2026-10-07
  set DIAG_EXPECT_CONTANTI=1449.15
  set DIAG_EXPECT_BANCOMAT=1750.32
  set DIAG_EXPECT_FATTURE=80
  set DIAG_POS=2
  set DIAG_FROM_HHMM=0837
  set DIAG_TO_HHMM=2124
  py -u diagnose_lettura_pagamenti.py
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

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


def _money(v) -> Decimal:
    try:
        return Decimal(str(v or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _safe_close(cur) -> None:
    try:
        cur.close()
    except Exception:
        pass


def _hhmm(raw: str, default: time) -> time:
    s = (raw or "").strip()
    if len(s) == 4 and s.isdigit():
        return time(int(s[:2]), int(s[2:]))
    return default


def _bucket(nome: str, fid: int) -> str:
    u = (nome or "").upper()
    if "CONTANT" in u or fid == 1:
        return "contanti"
    if "BANCOM" in u or fid == 2:
        return "bancomat"
    if "CARTA" in u or "CREDITO" in u or fid == 3:
        return "carta"
    if "SCONTO" in u:
        return "sconto"
    return "altro"


def main() -> int:
    _load_dotenv()
    from app.services.easyretail_gdb_service import (
        classify_easyretail_ven_kind,
        connect_gdb,
        resolve_fbclient,
    )

    dsn = (os.getenv("EASYRETAIL_GDB_PATH") or os.getenv("EASYRETAIL_GDB_DSN") or "").strip()
    day_raw = (os.getenv("DIAG_DAY") or "").strip()[:10]
    if not dsn or not day_raw:
        print("ERRORE: serve EASYRETAIL_GDB_PATH e DIAG_DAY", file=sys.stderr)
        return 2

    day = datetime.strptime(day_raw, "%Y-%m-%d")
    nxt = day + timedelta(days=1)
    pos_filter = (os.getenv("DIAG_POS") or "").strip()
    t0 = _hhmm(os.getenv("DIAG_FROM_HHMM", ""), time(0, 0))
    t1 = _hhmm(os.getenv("DIAG_TO_HHMM", ""), time(23, 59, 59))
    start = datetime.combine(day.date(), t0)
    end = datetime.combine(day.date(), t1) + timedelta(seconds=1)

    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        print(f"gdb={dsn}")
        print(f"giorno={day_raw} pos_filter={pos_filter or '(tutti)'} ore={t0.strftime('%H:%M')}-{t1.strftime('%H:%M')}")

        forms: Dict[int, Dict[str, Any]] = {}
        cur = con.cursor()
        try:
            cur.execute(
                "SELECT NUMEROFORMAPAGAMENTO, CODICE, FORMAPAGAMENTO, POS, TOTALECASSETTO "
                "FROM FORMEPAGAMENTI"
            )
            for row in cur.fetchall():
                forms[int(row[0])] = {
                    "codice": str(row[1] or "").strip(),
                    "nome": str(row[2] or "").strip(),
                    "pos_flag": int(row[3] or 0),
                    "totale_cassetto": int(row[4] or 0),
                }
        finally:
            _safe_close(cur)

        cur = con.cursor()
        try:
            cur.execute(
                "SELECT NUMEROMOVIMENTO, TIPODOCUMENTO, NUMERODOCUMENTO, TOTALEDOCUMENTO, "
                "NUMEROPOS, DATAMOVIMENTO "
                "FROM MOVIMENTIT "
                "WHERE DATAMOVIMENTO >= ? AND DATAMOVIMENTO < ?",
                [day, nxt],
            )
            movs = cur.fetchall()
        finally:
            _safe_close(cur)

        # filtra pos + fascia oraria
        filtered = []
        pos_counts: Dict[str, int] = defaultdict(int)
        for mid, tipo, ndoc, tot, npos, when in movs:
            pos_s = "" if npos is None else str(npos).strip()
            pos_counts[pos_s or "(vuoto)"] += 1
            if pos_filter and pos_s != pos_filter:
                continue
            if when is not None and hasattr(when, "hour"):
                if when < start or when >= end:
                    continue
            filtered.append((mid, tipo, ndoc, tot, npos, when))

        print("\n=== NUMEROPOS nel giorno (prima del filtro) ===")
        for k, n in sorted(pos_counts.items(), key=lambda x: (-x[1], x[0])):
            print(f"  POS {k}: {n} movimenti")
        print(f"dopo filtro: {len(filtered)} movimenti")

        by_kind = defaultdict(lambda: {"n": 0, "tot": Decimal("0.00")})
        kind_of: Dict[str, str] = {}
        doc_tot: Dict[str, Decimal] = {}
        for mid, tipo, ndoc, tot, npos, when in filtered:
            key = str(mid).strip()
            kind = classify_easyretail_ven_kind(tipo, ndoc)
            kind_of[key] = kind
            doc_tot[key] = _money(tot)
            by_kind[kind]["n"] += 1
            by_kind[kind]["tot"] += _money(tot)

        print("\n=== MOVIMENTIT filtrati per tipo ===")
        for kind, slot in sorted(by_kind.items()):
            print(f"  {kind}: n={slot['n']} tot={slot['tot']}")

        ids = list(doc_tot.keys())
        pays = []
        if ids:
            # batch IN clause
            cur = con.cursor()
            try:
                chunk = 400
                for i in range(0, len(ids), chunk):
                    part = ids[i : i + chunk]
                    marks = ",".join("?" for _ in part)
                    cur.execute(
                        f"SELECT NUMEROMOVIMENTO, NUMEROFORMAPAGAMENTO, IMPORTO "
                        f"FROM PAGAMENTI WHERE NUMEROMOVIMENTO IN ({marks})",
                        part,
                    )
                    pays.extend(cur.fetchall())
            finally:
                _safe_close(cur)

        pay_sum_by_mov: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
        by_form_fiscal = defaultdict(lambda: Decimal("0.00"))
        by_form_invoice = defaultdict(lambda: Decimal("0.00"))
        by_form_all = defaultdict(lambda: Decimal("0.00"))
        for mid, form_id, imp in pays:
            key = str(mid).strip()
            amt = _money(imp)
            fid = int(form_id or 0)
            by_form_all[fid] += amt
            pay_sum_by_mov[key] += amt
            kind = kind_of.get(key, "other")
            if kind == "fattura":
                by_form_invoice[fid] += amt
            elif kind == "scontrino":
                by_form_fiscal[fid] += amt

        # integrita: pagamenti vs totale documento (solo scontrini)
        over = under = ok = 0
        over_amt = Decimal("0.00")
        for key, kind in kind_of.items():
            if kind != "scontrino":
                continue
            d = doc_tot.get(key, Decimal("0.00"))
            p = pay_sum_by_mov.get(key, Decimal("0.00"))
            if p == d:
                ok += 1
            elif p > d:
                over += 1
                over_amt += p - d
            else:
                under += 1
        print("\n=== Integrita PAGAMENTI vs TOTALEDOCUMENTO (scontrini) ===")
        print(f"  ok={ok} over={over} (extra={over_amt}) under={under}")

        print("\n=== PAGAMENTI per forma (filtrati) ===")
        for fid in sorted(by_form_all):
            nome = forms.get(fid, {}).get("nome") or f"#{fid}"
            print(f"  {fid} {nome}: {by_form_all[fid]}")

        buckets = defaultdict(lambda: Decimal("0.00"))
        print("\n=== Solo scontrini fiscali ===")
        for fid, amt in sorted(by_form_fiscal.items()):
            nome = forms.get(fid, {}).get("nome") or ""
            b = _bucket(nome, fid)
            buckets[b] += amt
            print(f"  {fid} {nome}: {amt} → {b}")

        cash = buckets["contanti"]
        bancom = buckets["bancomat"]
        carta = buckets["carta"]
        elettronico = bancom + carta
        print(f"  → CONTANTI {cash}")
        print(f"  → BANCOMAT {bancom}")
        print(f"  → CARTA {carta}")
        print(f"  → ELETTRONICO {elettronico}")
        print(f"  → SCONTO {buckets['sconto']}")
        print(f"  → ALTRO {buckets['altro']}")

        inv_pay = sum(by_form_invoice.values(), Decimal("0.00"))
        inv_doc = by_kind.get("fattura", {}).get("tot", Decimal("0.00"))
        print("\n=== Fatture ===")
        for fid, amt in sorted(by_form_invoice.items()):
            print(f"  {fid} {forms.get(fid, {}).get('nome')}: {amt}")
        print(f"  pagamenti fatture={inv_pay}  tot documenti fattura={inv_doc}")

        # Come fetch_lettura_operatore_daily: CONTANTI/BANCOMAT = tutti i PAGAMENTI
        # della cassa; POS Prima Nota = elettronico solo su scontrini; FATTURE a parte.
        cash_all = Decimal("0.00")
        bancom_all = Decimal("0.00")
        for fid, amt in by_form_all.items():
            nome = forms.get(fid, {}).get("nome") or ""
            b = _bucket(nome, fid)
            if b == "contanti":
                cash_all += amt
            elif b in ("bancomat", "carta"):
                bancom_all += amt

        print("\n=== Proposta Atlas (filtro applicato) ===")
        print(f"  CONTANTI (tutti i pagamenti forma 1): {cash_all}")
        print(f"  BANCOMAT carta (tutti forma 2/3): {bancom_all}")
        print(f"  POS Prima Nota (=bancomat+carta su scontrini): {elettronico}")
        print(f"  FATTURE (pagamenti): {inv_pay}")
        print(f"  INCASSO carta≈: {cash_all + bancom_all}")
        print(f"  (solo fiscali: CONTANTI {cash} BANCOMAT {bancom})")

        def _exp(name: str) -> Optional[Decimal]:
            raw = os.getenv(name)
            return _money(raw) if raw not in (None, "") else None

        print("\n=== Confronto carta ===")
        for label, got, env in (
            ("CONTANTI", cash_all, "DIAG_EXPECT_CONTANTI"),
            ("BANCOMAT", bancom_all, "DIAG_EXPECT_BANCOMAT"),
            ("POS_SCONTRINI", elettronico, "DIAG_EXPECT_ELETTRONICO"),
            ("FATTURE", inv_pay, "DIAG_EXPECT_FATTURE"),
        ):
            e = _exp(env)
            if e is None:
                continue
            print(f"  {label} carta {e} vs GDB {got} delta={got - e}")

        print("\nFine.")
        return 0
    finally:
        try:
            con.close()
        except Exception as exc:
            print(f"(close warning: {exc})")


if __name__ == "__main__":
    raise SystemExit(main())
