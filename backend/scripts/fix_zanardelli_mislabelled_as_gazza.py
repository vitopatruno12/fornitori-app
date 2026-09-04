#!/usr/bin/env python3
"""Corregge / pulisce scontrini etichettati come Gazza Ladra per errore.

Causa storica:
  PC Zanardelli sincronizzava con EASYRETAIL_MODEL_ID=model-4 quando
  sul server model-4 era ancora mappato a Gazza Ladra (store_key=gazza_ladra).

Gazza Ladra NON ha agent EasyRetail (sarà POS Poste / model-5).
Qualsiasi riga source=easyretail con store_key=gazza_ladra è falsa.

Uso sul server (venv backend):
  cd /opt/fornitori-app/backend   # o path deploy
  source venv/bin/activate
  python scripts/fix_zanardelli_mislabelled_as_gazza.py
  python scripts/fix_zanardelli_mislabelled_as_gazza.py --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Esegui UPDATE (default: solo conteggio)")
    args = parser.parse_args()

    from app.database import SessionLocal
    from app.models.pos_receipt import PosReceipt
    from sqlalchemy import func

    db = SessionLocal()
    try:
        # Panoramica
        print("=== Conteggi pos_receipts per store_key / model_id (source=easyretail) ===")
        rows = (
            db.query(
                PosReceipt.store_key,
                PosReceipt.model_id,
                PosReceipt.model_label,
                func.count(PosReceipt.id),
            )
            .filter(PosReceipt.source == "easyretail")
            .group_by(PosReceipt.store_key, PosReceipt.model_id, PosReceipt.model_label)
            .order_by(func.count(PosReceipt.id).desc())
            .all()
        )
        for sk, mid, lab, n in rows:
            print(f"  store_key={sk!r} model_id={mid!r} label={lab!r} → {n}")

        q = db.query(PosReceipt).filter(
            PosReceipt.source == "easyretail",
            PosReceipt.store_key == "gazza_ladra",
        )
        n = q.count()
        print(f"\nScontrini EasyRetail falsi su gazza_ladra: {n}")
        if n == 0:
            print("Niente da correggere.")
            return 0

        if not args.apply:
            print("Dry-run: rilancia con --apply per rietichettare come Zanardelli (via_zanardelli / model-4).")
            return 0

        updated = q.update(
            {
                PosReceipt.store_key: "via_zanardelli",
                PosReceipt.model_id: "model-4",
                PosReceipt.model_label: "Mani in Pasta (Via Zanardelli)",
            },
            synchronize_session=False,
        )
        db.commit()
        print(f"OK aggiornati={updated} → via_zanardelli / model-4")
        return 0
    except Exception as e:
        db.rollback()
        print(f"ERRORE: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
