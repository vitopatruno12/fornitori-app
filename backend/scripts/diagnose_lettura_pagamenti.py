#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ricostruisce CONTANTI / BANCOMAT / CARTA della lettura sommando PAGAMENTI.

Confronta con la carta (es. Zanardelli 7/10: contanti 1449,15 · bancomat 1750,32).

  cd C:\\AtlasSync
  set DIAG_DAY=2026-10-07
  py -u diagnose_lettura_pagamenti.py

Opzionale (attesi carta):
  set DIAG_EXPECT_CONTANTI=1449.15
  set DIAG_EXPECT_BANCOMAT=1750.32
  set DIAG_EXPECT_CARTA=0
  set DIAG_EXPECT_FATTURE=80
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
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
        print("ERRORE: serve EASYRETAIL_GDB_PATH e DIAG_DAY=YYYY-MM-DD", file=sys.stderr)
        return 2

    day = datetime.strptime(day_raw, "%Y-%m-%d")
    nxt = day + timedelta(days=1)

    con = connect_gdb(
        dsn,
        user=os.getenv("EASYRETAIL_GDB_USER", "SYSDBA") or "SYSDBA",
        password=os.getenv("EASYRETAIL_GDB_PASSWORD", "masterkey") or "masterkey",
        fbclient=os.getenv("EASYRETAIL_FBCLIENT") or resolve_fbclient(),
        charset=os.getenv("EASYRETAIL_GDB_CHARSET", "WIN1252") or "WIN1252",
    )
    try:
        print(f"gdb={dsn}")
        print(f"giorno={day_raw}")

        # Forme pagamento
        forms = {}
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

        print("\n=== FORMEPAGAMENTI ===")
        for fid in sorted(forms):
            f = forms[fid]
            print(
                f"  {fid}: {f['nome']!r} codice={f['codice']!r} "
                f"POS={f['pos_flag']} TOTALECASSETTO={f['totale_cassetto']}"
            )

        # Movimenti del giorno
        cur = con.cursor()
        try:
            cur.execute(
                "SELECT NUMEROMOVIMENTO, TIPODOCUMENTO, NUMERODOCUMENTO, TOTALEDOCUMENTO, NUMEROPOS "
                "FROM MOVIMENTIT "
                "WHERE DATAMOVIMENTO >= ? AND DATAMOVIMENTO < ?",
                [day, nxt],
            )
            movs = cur.fetchall()
        finally:
            _safe_close(cur)

        by_kind = defaultdict(lambda: {"n": 0, "tot": Decimal("0.00")})
        ids_by_kind = defaultdict(list)
        for mid, tipo, ndoc, tot, npos in movs:
            kind = classify_easyretail_ven_kind(tipo, ndoc)
            by_kind[kind]["n"] += 1
            by_kind[kind]["tot"] += _money(tot)
            ids_by_kind[kind].append(str(mid).strip())

        print("\n=== MOVIMENTIT per tipo documento ===")
        for kind, slot in sorted(by_kind.items()):
            print(f"  {kind}: n={slot['n']} tot={slot['tot']}")

        # Pagamenti collegati
        cur = con.cursor()
        try:
            cur.execute(
                "SELECT P.NUMEROMOVIMENTO, P.NUMEROFORMAPAGAMENTO, P.IMPORTO "
                "FROM PAGAMENTI P "
                "JOIN MOVIMENTIT M ON M.NUMEROMOVIMENTO = P.NUMEROMOVIMENTO "
                "WHERE M.DATAMOVIMENTO >= ? AND M.DATAMOVIMENTO < ?",
                [day, nxt],
            )
            pays = cur.fetchall()
        finally:
            _safe_close(cur)

        # classifica ogni movimento
        kind_of = {}
        for mid, tipo, ndoc, tot, npos in movs:
            kind_of[str(mid).strip()] = classify_easyretail_ven_kind(tipo, ndoc)

        by_form = defaultdict(lambda: Decimal("0.00"))
        by_form_fiscal = defaultdict(lambda: Decimal("0.00"))
        by_form_invoice = defaultdict(lambda: Decimal("0.00"))
        unmatched = Decimal("0.00")
        for mid, form_id, imp in pays:
            key = str(mid).strip()
            amt = _money(imp)
            fid = int(form_id or 0)
            by_form[fid] += amt
            kind = kind_of.get(key, "other")
            if kind == "fattura":
                by_form_invoice[fid] += amt
            elif kind == "scontrino":
                by_form_fiscal[fid] += amt
            else:
                unmatched += amt  # preventivo/vea/other still counted in by_form

        print("\n=== PAGAMENTI per forma (tutti i doc del giorno) ===")
        tot_all = Decimal("0.00")
        for fid in sorted(by_form):
            nome = forms.get(fid, {}).get("nome") or f"#{fid}"
            print(f"  {fid} {nome}: {by_form[fid]}")
            tot_all += by_form[fid]
        print(f"  TOT pagamenti: {tot_all}")

        print("\n=== Solo scontrini fiscali (esclude fatture/preventivi) ===")
        cash = card = other = Decimal("0.00")
        for fid, amt in sorted(by_form_fiscal.items()):
            nome = (forms.get(fid, {}).get("nome") or "").upper()
            print(f"  {fid} {forms.get(fid, {}).get('nome')}: {amt}")
            if "CONTANT" in nome or fid == 1:
                cash += amt
            elif "BANCOM" in nome or "CARTA" in nome or "CREDITO" in nome or "PREPAG" in nome:
                card += amt
            else:
                other += amt
        print(f"  → CONTANTI~ {cash}")
        print(f"  → ELETTRONICO~ {card}")
        print(f"  → ALTRO fiscale~ {other}")

        print("\n=== Fatture (pagamenti su doc fattura) ===")
        inv = Decimal("0.00")
        for fid, amt in sorted(by_form_invoice.items()):
            print(f"  {fid} {forms.get(fid, {}).get('nome')}: {amt}")
            inv += amt
        print(f"  → FATTURE pagamenti~ {inv}")
        print(f"  → doc fattura tot MOVIMENTIT~ {by_kind.get('fattura', {}).get('tot', 0)}")

        # proposta chiusura Atlas
        pos_net = card  # già senza fatture se escluse sopra
        print("\n=== Proposta chiusura Atlas (da GDB) ===")
        print(f"  CONTANTI (IN CASSA): {cash}")
        print(f"  POS (elettronico senza fatture): {pos_net}")
        print(f"  FATTURE EMESSE: {by_kind.get('fattura', {}).get('tot', Decimal('0.00'))}")
        print(f"  INCASSO contanti+pos: {(cash + pos_net)}")

        exp_c = os.getenv("DIAG_EXPECT_CONTANTI")
        exp_b = os.getenv("DIAG_EXPECT_BANCOMAT")
        exp_k = os.getenv("DIAG_EXPECT_CARTA")
        exp_f = os.getenv("DIAG_EXPECT_FATTURE")
        if any([exp_c, exp_b, exp_k, exp_f]):
            print("\n=== Confronto carta ===")
            if exp_c:
                e = _money(exp_c)
                print(f"  CONTANTI carta {e} vs GDB {cash} delta={cash - e}")
            if exp_b:
                e = _money(exp_b)
                # carta bancomat spesso = bancomat+carta credito+fatture
                bancom_only = by_form_fiscal.get(2, Decimal("0.00"))
                print(f"  BANCOMAT carta {e} vs forma2 fiscale {bancom_only} delta={bancom_only - e}")
                print(f"  BANCOMAT carta {e} vs elettronico fiscale {card} delta={card - e}")
            if exp_k:
                e = _money(exp_k)
                carta_only = by_form_fiscal.get(3, Decimal("0.00"))
                print(f"  CARTA carta {e} vs forma3 fiscale {carta_only} delta={carta_only - e}")
            if exp_f:
                e = _money(exp_f)
                ft = by_kind.get("fattura", {}).get("tot", Decimal("0.00"))
                print(f"  FATTURE carta {e} vs GDB doc {ft} delta={ft - e}")

        print("\nFine. Incolla questo output.")
        return 0
    finally:
        try:
            con.close()
        except Exception as exc:
            print(f"(close warning: {exc})")


if __name__ == "__main__":
    raise SystemExit(main())
