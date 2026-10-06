"""Dopo le 21:30 scrive in Prima Nota le chiusure fiscali (contanti / POS / NC) per ogni registro."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
import logging

from sqlalchemy.orm import Session
from sqlalchemy import or_
from zoneinfo import ZoneInfo

from ..constants.prima_nota import PRIMA_NOTA_ACTIVITIES
from ..models.cash_entry import CashEntry
from .cash_service import (
    CONTANTI_CONTO,
    NON_FISCALE_CONTO,
    POS_CONTO,
    REFILL_CONTO,
    STACKER_SVUOTAMENTO_CONTO,
    VERSAMENTO_BANCA_CONTO,
    normalize_activity,
)
from .paper_closing_overrides import paper_amounts as _paper_amounts
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

_PROTECTED_CONTI = (
    CONTANTI_CONTO,
    POS_CONTO,
    NON_FISCALE_CONTO,
    REFILL_CONTO,
    STACKER_SVUOTAMENTO_CONTO,
    VERSAMENTO_BANCA_CONTO,
)

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
    db.flush()
    return "created"


def _is_auto_entry(entry: CashEntry) -> bool:
    return AUTO_NOTE in str(entry.note or "")


def _rome_day(entry: CashEntry) -> Optional[date]:
    when = entry.entry_date
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(ROME).date()


def remove_manual_closing_duplicates(
    db: Session,
    *,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    activity: Optional[str] = None,
) -> int:
    """Se esiste la riga sync, elimina le copie inserite a mano (stesso giorno/registro/conto)."""
    today = rome_now().date()
    end = min(date_to or today, today)
    start = date_from or (end - timedelta(days=MAX_BACKFILL_DAYS - 1))
    if start > end:
        return 0
    day_start, _ = _day_bounds_utc(start)
    _, day_end = _day_bounds_utc(end)

    q = db.query(CashEntry).filter(
        CashEntry.entry_date >= day_start,
        CashEntry.entry_date < day_end,
        CashEntry.type == "entrata",
        CashEntry.conto.in_(tuple(_KIND_META[k]["conto"] for k in _KIND_META)),
    )
    if activity:
        act = normalize_activity(activity)
        if act == "via_abba":
            q = q.filter(CashEntry.activity.in_((act, "mediazione")))
        else:
            q = q.filter(CashEntry.activity == act)
    rows = q.all()
    groups: Dict[Tuple[str, date, Optional[str]], List[CashEntry]] = {}
    for entry in rows:
        day = _rome_day(entry)
        if day is None:
            continue
        act = normalize_activity(entry.activity)
        groups.setdefault((act, day, entry.conto), []).append(entry)

    deleted = 0
    auto_amounts: Dict[Tuple[str, date, Optional[str]], Decimal] = {}
    for (_act, _day, _conto), items in groups.items():
        autos = [e for e in items if _is_auto_entry(e)]
        manuals = [e for e in items if not _is_auto_entry(e)]
        if not autos:
            continue
        autos.sort(key=lambda e: e.id or 0)
        keep_id = autos[0].id
        for extra in autos[1:]:
            db.delete(extra)
            deleted += 1
        for manual in manuals:
            if manual.id == keep_id:
                continue
            db.delete(manual)
            deleted += 1
        keep = autos[0]
        auto_amounts[(normalize_activity(keep.activity), _rome_day(keep), keep.conto)] = _dec(keep.amount)

    fiscale_q = db.query(CashEntry).filter(
        CashEntry.entry_date >= day_start,
        CashEntry.entry_date < day_end,
        CashEntry.type == "entrata",
        or_(CashEntry.conto.is_(None), CashEntry.conto.notin_(_PROTECTED_CONTI)),
    )
    if activity:
        act = normalize_activity(activity)
        if act == "via_abba":
            fiscale_q = fiscale_q.filter(CashEntry.activity.in_((act, "mediazione")))
        else:
            fiscale_q = fiscale_q.filter(CashEntry.activity == act)
    for entry in fiscale_q.all():
        if _is_auto_entry(entry):
            continue
        day = _rome_day(entry)
        if day is None:
            continue
        act = normalize_activity(entry.activity)
        cash_auto = auto_amounts.get((act, day, CONTANTI_CONTO))
        if cash_auto is not None and _dec(entry.amount) == cash_auto:
            db.delete(entry)
            deleted += 1
    return deleted


def sync_daily_closings_to_prima_nota(
    db: Session,
    *,
    activity: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Dict[str, Any]:
    """Crea/aggiorna movimenti automatici da scontrini (contanti, POS, preventivi NC)."""
    days = _eligible_days(date_from, date_to)
    act_filter = normalize_activity(activity) if activity else None
    if not days:
        deduped = remove_manual_closing_duplicates(
            db, date_from=date_from, date_to=date_to, activity=act_filter
        )
        if deduped:
            db.commit()
        return {
            "ok": True,
            "created": 0,
            "updated": 0,
            "removed": 0,
            "deduped_manual": deduped,
            "days": 0,
        }

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
            cash, card, quote = _paper_amounts(act, day, cash, card, quote)
            for kind, amount in (("contanti", cash), ("pos", card), ("nc", quote)):
                action = _upsert_auto_entry(db, activity=act, day=day, kind=kind, amount=amount)
                if action == "created":
                    created += 1
                elif action == "updated":
                    updated += 1
                elif action == "removed":
                    removed += 1

    deduped = remove_manual_closing_duplicates(
        db,
        date_from=date_from or range_from,
        date_to=date_to or range_to,
        activity=None if not activity else activities[0],
    )
    if created or updated or removed or deduped:
        db.commit()
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "removed": removed,
        "deduped_manual": deduped,
        "days": len(days),
        "activities": activities,
    }
