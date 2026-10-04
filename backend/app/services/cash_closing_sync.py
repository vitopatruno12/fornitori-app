"""Dopo le 21:30 scrive in Prima Nota le chiusure fiscali (contanti / POS / NC) per ogni registro."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
import logging

from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from ..constants.prima_nota import PRIMA_NOTA_ACTIVITIES
from ..models.cash_entry import CashEntry
from .cash_service import CONTANTI_CONTO, NON_FISCALE_CONTO, POS_CONTO, normalize_activity
from .pos_receipts_service import load_pos_daily_incasso

logger = logging.getLogger(__name__)

ROME = ZoneInfo("Europe/Rome")
CLOSING_HOUR = 21
CLOSING_MINUTE = 30
AUTO_NOTE = "[auto-chiusura]"
MAX_BACKFILL_DAYS = 14

# Registro Prima Nota → (model_id EasyRetail/Poste, store_keys opzionali)
_ACTIVITY_POS_SOURCE = {
    "risacca": ("model-1", None),
    "via_abba": ("model-2", ("via_abba", "abba", "model-2")),
    "via_zanardelli": ("model-4", ("via_zanardelli", "zanardelli", "model-4")),
    "via_lattea": ("model-3", ("model-3", "via_lattea", "lattea", "mucche")),
    "pg": ("model-5", ("gazza_ladra", "gazza", "model-5")),
}

_KIND_META = {
    "contanti": {
        "conto": CONTANTI_CONTO,
        "description": "Chiusura fiscale · pagamenti contanti (A)",
    },
    "pos": {
        "conto": POS_CONTO,
        "description": "Chiusura fiscale · pagamenti POS (A)",
    },
    "nc": {
        "conto": NON_FISCALE_CONTO,
        "description": "Preventivi / non fiscali (A)",
    },
}


def _dec(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def rome_now() -> datetime:
    return datetime.now(ROME)


def day_is_closed(day: date, *, now: Optional[datetime] = None) -> bool:
    """Oggi solo dopo 21:30 (ora Italia); i giorni precedenti sono chiusi."""
    now = now or rome_now()
    today = now.date()
    if day > today:
        return False
    if day < today:
        return True
    cutoff = datetime.combine(today, time(CLOSING_HOUR, CLOSING_MINUTE), tzinfo=ROME)
    return now >= cutoff


def closing_entry_datetime(day: date) -> datetime:
    local = datetime.combine(day, time(CLOSING_HOUR, CLOSING_MINUTE), tzinfo=ROME)
    return local.astimezone(timezone.utc)


def _eligible_days(date_from: Optional[date], date_to: Optional[date]) -> List[date]:
    today = rome_now().date()
    end = min(date_to or today, today)
    start = date_from or (end - timedelta(days=MAX_BACKFILL_DAYS - 1))
    if start > end:
        return []
    if (end - start).days + 1 > MAX_BACKFILL_DAYS:
        start = end - timedelta(days=MAX_BACKFILL_DAYS - 1)
    days: List[date] = []
    cur = start
    while cur <= end:
        if day_is_closed(cur):
            days.append(cur)
        cur += timedelta(days=1)
    return days


def _day_bounds_utc(day: date) -> Tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=ROME).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=ROME).astimezone(timezone.utc)
    return start, end


def _find_auto_entry(
    db: Session,
    *,
    activity: str,
    day: date,
    conto: str,
) -> Optional[CashEntry]:
    day_start, day_end = _day_bounds_utc(day)
    return (
        db.query(CashEntry)
        .filter(
            CashEntry.activity == activity,
            CashEntry.conto == conto,
            CashEntry.entry_date >= day_start,
            CashEntry.entry_date < day_end,
            CashEntry.note.contains(AUTO_NOTE),
        )
        .order_by(CashEntry.id.asc())
        .first()
    )


def _upsert_auto_entry(
    db: Session,
    *,
    activity: str,
    day: date,
    kind: str,
    amount: Decimal,
) -> str:
    meta = _KIND_META[kind]
    conto = meta["conto"]
    if amount <= 0:
        existing = _find_auto_entry(db, activity=activity, day=day, conto=conto)
        if existing is not None:
            db.delete(existing)
            return "removed"
        return "skip"
    existing = _find_auto_entry(db, activity=activity, day=day, conto=conto)
    note = f"{AUTO_NOTE} {kind} {day.isoformat()}"
    if existing is not None:
        if _dec(existing.amount) == amount:
            return "unchanged"
        existing.amount = amount
        existing.type = "entrata"
        existing.description = meta["description"]
        existing.note = note
        existing.entry_date = closing_entry_datetime(day)
        return "updated"
    db.add(
        CashEntry(
            entry_date=closing_entry_datetime(day),
            type="entrata",
            amount=amount,
            description=meta["description"],
            note=note,
            conto=conto,
            activity=activity,
        )
    )
    return "created"


def sync_daily_closings_to_prima_nota(
    db: Session,
    *,
    activity: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Dict[str, Any]:
    """Crea/aggiorna movimenti automatici da scontrini (contanti, POS, preventivi NC)."""
    days = _eligible_days(date_from, date_to)
    if not days:
        return {"ok": True, "created": 0, "updated": 0, "removed": 0, "days": 0}

    if activity:
        activities = [normalize_activity(activity)]
    else:
        activities = list(PRIMA_NOTA_ACTIVITIES)

    created = 0
    updated = 0
    removed = 0
    range_from = days[0]
    range_to = days[-1]
    for act in activities:
        src = _ACTIVITY_POS_SOURCE.get(act)
        if not src:
            continue
        model_id, store_keys = src
        try:
            by_day = load_pos_daily_incasso(
                db,
                date_from=range_from,
                date_to=range_to,
                model_id=model_id,
                store_keys=store_keys,
            )
        except Exception:
            logger.warning("Lettura scontrini chiusura fallita %s", act, exc_info=True)
            continue
        for day in days:
            hit = (by_day or {}).get(day) or {}
            cash = _dec(hit.get("cash_eur"))
            card = _dec(hit.get("card_eur"))
            quote = _dec(hit.get("quote_eur"))
            for kind, amount in (("contanti", cash), ("pos", card), ("nc", quote)):
                action = _upsert_auto_entry(db, activity=act, day=day, kind=kind, amount=amount)
                if action == "created":
                    created += 1
                elif action == "updated":
                    updated += 1
                elif action == "removed":
                    removed += 1

    if created or updated or removed:
        db.commit()
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "removed": removed,
        "days": len(days),
        "activities": activities,
    }
