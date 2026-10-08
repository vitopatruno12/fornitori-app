#!/usr/bin/env python3
"""Allinea Prima Nota 7 ott 2026 alle letture operatore (foto carta).

Esegui sul server (dopo deploy):
  cd /path/to/backend && .venv/bin/python scripts/apply_lettura_7_ottobre.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.database import SessionLocal
from app.services import cash_closing_sync
from app.services.paper_closing_overrides import get_paper_override, is_seed_paper_day
from app.services.cassetto_daily_store import cassetto_amount

DAY = date(2026, 10, 7)
ACTIVITIES = ("via_zanardelli", "via_abba", "via_lattea")


def main() -> int:
    db = SessionLocal()
    try:
        for act in ACTIVITIES:
            ov = get_paper_override(act, DAY)
            cass = cassetto_amount(act, DAY)
            print(
                f"{act}: seed={is_seed_paper_day(act, DAY)} "
                f"contanti={ov.get('contanti')} pos={ov.get('pos')} "
                f"fatture={ov.get('fatture')} nc={ov.get('nc')} cassetto={cass}"
            )
        sync = cash_closing_sync.sync_daily_closings_to_prima_nota(
            db,
            activity=None,
            date_from=DAY,
            date_to=DAY,
            force_days=[DAY],
        )
        print(f"sync={sync}")
        return 0 if sync.get("ok") else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
