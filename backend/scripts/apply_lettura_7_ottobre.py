#!/usr/bin/env python3
"""Allinea Prima Nota alle letture carta seedate (7 ott 2026 e giorni seed).

Sul server preferisci:
  sudo bash deploy/apply-lettura-7-ottobre.sh
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
from app.services.cassetto_daily_store import cassetto_amount
from app.services.paper_closing_overrides import (
    _SEED_PAPER_CLOSINGS,
    get_paper_override,
    is_seed_paper_day,
)

ACTIVITIES = ("via_zanardelli", "via_abba", "via_lattea")


def main() -> int:
    days = sorted({d for (_act, d) in _SEED_PAPER_CLOSINGS})
    print(f"Giorni seed: {[d.isoformat() for d in days]}")
    db = SessionLocal()
    try:
        for act in ACTIVITIES:
            for day in days:
                if not is_seed_paper_day(act, day):
                    continue
                ov = get_paper_override(act, day)
                cass = cassetto_amount(act, day)
                print(
                    f"  {act} {day}: contanti={ov.get('contanti')} pos={ov.get('pos')} "
                    f"nc={ov.get('nc')} fatture={ov.get('fatture')} cassetto={cass}"
                )
        sync = cash_closing_sync.sync_daily_closings_to_prima_nota(
            db,
            activity=None,
            date_from=min(days),
            date_to=max(days),
            force_days=days,
        )
        print(f"sync={sync}")
        return 0 if sync.get("ok") else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
