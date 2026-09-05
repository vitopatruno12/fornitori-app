#!/usr/bin/env python3
"""Rimuove scontrini EasyRetail duplicati.

1) Stesso model_id + external_id (store_key diversi: model-2 vs via_abba)
2) Opzionale: coppie VEN+BIL (stesso importo entro 3 secondi) → tiene 1

Uso (sul server, in backend/ con venv):
  python scripts/dedupe_pos_receipts.py
  python scripts/dedupe_pos_receipts.py --apply
  python scripts/dedupe_pos_receipts.py --pair-near --apply
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _dedupe_external(db, *, model_id: str, apply: bool) -> int:
    from sqlalchemy import func

    from app.models.pos_receipt import PosReceipt

    q = (
        db.query(
            PosReceipt.source,
            PosReceipt.model_id,
            PosReceipt.external_id,
            func.count(PosReceipt.id),
            func.min(PosReceipt.id),
        )
        .filter(PosReceipt.source == "easyretail")
        .filter(PosReceipt.external_id.isnot(None))
        .filter(PosReceipt.external_id != "")
    )
    if model_id:
        q = q.filter(PosReceipt.model_id == model_id)
    groups = (
        q.group_by(PosReceipt.source, PosReceipt.model_id, PosReceipt.external_id)
        .having(func.count(PosReceipt.id) > 1)
        .all()
    )
    print(f"[external_id] gruppi duplicati: {len(groups)}")
    to_delete = 0
    for source, mid, ext, n, keep_id in groups:
        extras = (
            db.query(PosReceipt)
            .filter(
                PosReceipt.source == source,
                PosReceipt.model_id == mid,
                PosReceipt.external_id == ext,
                PosReceipt.id != keep_id,
            )
            .all()
        )
        print(f"  model={mid!r} external_id={ext!r} n={n} keep={keep_id} del={len(extras)}")
        to_delete += len(extras)
        if apply:
            for row in extras:
                db.delete(row)
    return to_delete


def _dedupe_near_pairs(db, *, model_id: str, apply: bool) -> int:
    """Stesso importo entro 3s → tipico VEN+BIL; tiene la riga con pagamento valorizzato."""
    from app.models.pos_receipt import PosReceipt

    q = db.query(PosReceipt).filter(PosReceipt.source == "easyretail").filter(PosReceipt.is_void == 0)
    if model_id:
        q = q.filter(PosReceipt.model_id == model_id)
    rows = q.order_by(PosReceipt.model_id.asc(), PosReceipt.receipt_at.asc(), PosReceipt.id.asc()).all()
    by_model = defaultdict(list)
    for r in rows:
        by_model[r.model_id or ""].append(r)

    to_delete_ids = set()
    for mid, items in by_model.items():
        i = 0
        while i < len(items) - 1:
            a = items[i]
            if a.id in to_delete_ids:
                i += 1
                continue
            b = items[i + 1]
            if b.id in to_delete_ids:
                i += 1
                continue
            if not a.receipt_at or not b.receipt_at:
                i += 1
                continue
            dt = abs((b.receipt_at - a.receipt_at).total_seconds())
            amt_a = Decimal(str(a.amount_eur or 0))
            amt_b = Decimal(str(b.amount_eur or 0))
            if dt <= 3 and amt_a > 0 and amt_a == amt_b and a.external_id != b.external_id:
                def score(r):
                    return (
                        1 if (r.cash_amount_eur is not None or r.card_amount_eur is not None) else 0,
                        1 if (r.payment_type or "") not in ("", "unknown") else 0,
                        -r.id,
                    )

                keep, drop = (a, b) if score(a) >= score(b) else (b, a)
                to_delete_ids.add(drop.id)
                print(
                    f"  pair model={mid!r} {amt_a}€ Δ{dt:.1f}s "
                    f"keep={keep.external_id} drop={drop.external_id}"
                )
            i += 1

    print(f"[near-pair] da eliminare: {len(to_delete_ids)}")
    if apply and to_delete_ids:
        for rid in to_delete_ids:
            row = db.query(PosReceipt).filter(PosReceipt.id == rid).one_or_none()
            if row:
                db.delete(row)
    return len(to_delete_ids)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Esegue DELETE (default: dry-run)")
    parser.add_argument("--model-id", default="", help="Limita a un model_id (es. model-2)")
    parser.add_argument(
        "--pair-near",
        action="store_true",
        help="Elimina anche coppie stesso importo entro 3s (VEN+BIL)",
    )
    args = parser.parse_args()

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        n1 = _dedupe_external(db, model_id=args.model_id.strip(), apply=args.apply)
        n2 = 0
        if args.pair_near:
            n2 = _dedupe_near_pairs(db, model_id=args.model_id.strip(), apply=args.apply)
        if args.apply:
            db.commit()
            print(f"eliminati totali: {n1 + n2}")
        else:
            print(f"dry-run: verrebbero eliminati ~{n1 + n2} (rilancia con --apply)")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
