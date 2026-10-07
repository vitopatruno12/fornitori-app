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
    FATTURE_EMESSE_CONTO,
    MOVIMENTO_CASSETTO_CONTO,
    NON_FISCALE_CONTO,
    POS_CONTO,
    REFILL_CONTO,
    STACKER_SVUOTAMENTO_CONTO,
    VERSAMENTO_BANCA_CONTO,
    normalize_activity,
)
from .cassetto_daily_store import cassetto_amount as _cassetto_amount
from .cassetto_daily_store import cassetto_meta as _cassetto_meta
from .paper_closing_overrides import (
    get_paper_override,
    has_paper_override,
    paper_amounts as _paper_amounts,
    paper_fatture as _paper_fatture,
)
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
    FATTURE_EMESSE_CONTO,
    NON_FISCALE_CONTO,
    REFILL_CONTO,
    STACKER_SVUOTAMENTO_CONTO,
    VERSAMENTO_BANCA_CONTO,
    MOVIMENTO_CASSETTO_CONTO,
)

_KIND_META = {
    "contanti": {
        "conto": CONTANTI_CONTO,
        "description": "Chiusura lettura · pagamenti contanti (A)",
        "description_gdb": "Chiusura scontrini · pagamenti contanti (A)",
    },
    "pos": {
        "conto": POS_CONTO,
        "description": "Chiusura lettura · pagamenti POS (A)",
        "description_gdb": "Chiusura scontrini · pagamenti POS (A)",
    },
    "fatture": {
        "conto": FATTURE_EMESSE_CONTO,
        "description": "Chiusura lettura · fatture emesse (A)",
        "description_gdb": "Chiusura scontrini · fatture emesse (A)",
    },
    "nc": {
        "conto": NON_FISCALE_CONTO,
        "description": "Preventivi / non fiscali (A)",
        "description_gdb": "Preventivi / non fiscali (A)",
    },
    "cassetto": {
        "conto": MOVIMENTO_CASSETTO_CONTO,
        "description": "Movimenti cassetto EasyRetail (A)",
        "description_gdb": "Movimenti cassetto EasyRetail (A)",
        "entry_type": "uscita",
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


def _eligible_days(
    date_from: Optional[date],
    date_to: Optional[date],
    *,
    force_days: Optional[List[date]] = None,
) -> List[date]:
    today = rome_now().date()
    end = min(date_to or today, today)
    start = date_from or (end - timedelta(days=MAX_BACKFILL_DAYS - 1))
    if start > end:
        days: List[date] = []
    else:
        if (end - start).days + 1 > MAX_BACKFILL_DAYS:
            start = end - timedelta(days=MAX_BACKFILL_DAYS - 1)
        days = []
        cur = start
        while cur <= end:
            if day_is_closed(cur):
                days.append(cur)
            cur += timedelta(days=1)
    # Lettura operatore: allinea subito anche se il giorno non è ancora "chiuso" (prima delle 21:30).
    forced: List[date] = []
    for d in force_days or []:
        if d is None or d > today:
            continue
        if d not in days:
            forced.append(d)
    if forced:
        days = sorted(set(days) | set(forced))
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
    entry_type = meta.get("entry_type") or "entrata"
    if kind == "fatture":
        from_paper = "fatture" in get_paper_override(activity, day)
    else:
        from_paper = has_paper_override(activity, day) and kind in ("contanti", "pos")
    description = meta["description"] if from_paper or kind == "nc" else meta.get("description_gdb") or meta["description"]
    if kind == "cassetto":
        causali = [str(x) for x in (_cassetto_meta(activity, day).get("causali") or []) if str(x).strip()]
        if causali:
            description = f"Movimenti cassetto · {', '.join(causali[:4])} (A)"
    if amount <= 0:
        existing = _find_auto_entry(db, activity=activity, day=day, conto=conto)
        if existing is not None:
            db.delete(existing)
            return "removed"
        return "skip"
    existing = _find_auto_entry(db, activity=activity, day=day, conto=conto)
    note = f"{AUTO_NOTE} {kind} {day.isoformat()}"
    if existing is not None:
        same_amount = _dec(existing.amount) == amount
        same_desc = str(existing.description or "") == description
        same_type = str(existing.type or "") == entry_type
        if same_amount and same_desc and same_type:
            return "unchanged"
        existing.amount = amount
        existing.type = entry_type
        existing.description = description
        existing.note = note
        existing.entry_date = closing_entry_datetime(day)
        return "updated"
    db.add(
        CashEntry(
            entry_date=closing_entry_datetime(day),
            type=entry_type,
            amount=amount,
            description=description,
            note=note,
            conto=conto,
            activity=activity,
        )
    )
    db.flush()
    return "created"


def upsert_cassetto_auto_entries(
    db: Session,
    *,
    activity: str,
    days: Optional[List[date]] = None,
) -> Dict[str, Any]:
    """Scrive solo MOVIMENTO_CASSETTO dagli importi agent (senza toccare contanti/POS)."""
    act = normalize_activity(activity)
    if days is None:
        days = _eligible_days(None, None)
    else:
        today = rome_now().date()
        days = [d for d in days if d is not None and d <= today and (day_is_closed(d) or d < today)]
        # Oggi solo dopo 21:30; i giorni passati sempre
        if not days:
            return {"ok": True, "created": 0, "updated": 0, "removed": 0, "days": 0}
    created = updated = removed = 0
    for day in days:
        amount = _cassetto_amount(act, day)
        action = _upsert_auto_entry(db, activity=act, day=day, kind="cassetto", amount=amount)
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
        "activity": act,
    }


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
    """Se esiste la riga sync, elimina le copie inserite a mano (stesso giorno/registro).

    Con auto presente si cancellano tutte le manuali sullo stesso conto (anche importo diverso),
    così non restano doppie «incasso contanti» vs chiusura lettura.
    """
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
    days_with_cash_auto: set = set()
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
        if keep.conto == CONTANTI_CONTO:
            day = _rome_day(keep)
            if day is not None:
                days_with_cash_auto.add((normalize_activity(keep.activity), day))

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
        if (act, day) not in days_with_cash_auto:
            continue
        desc = str(entry.description or "").strip().lower()
        if (
            "incasso contanti" in desc
            or "incasso cassa" in desc
            or desc.startswith("chiusura")
            or "pagamenti contanti" in desc
        ):
            db.delete(entry)
            deleted += 1
    return deleted


def sync_daily_closings_to_prima_nota(
    db: Session,
    *,
    activity: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    force_days: Optional[List[date]] = None,
) -> Dict[str, Any]:
    """Crea/aggiorna movimenti automatici (contanti, POS, fatture emesse, preventivi NC)."""
    days = _eligible_days(date_from, date_to, force_days=force_days)
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
            # Lettura operatore (campo fatture) prevale sul totale GDB invoice_eur.
            paper = get_paper_override(act, day)
            if "fatture" in paper:
                fatture = _dec(paper["fatture"])
            elif hit:
                fatture = _dec(hit.get("invoice_eur"))
            else:
                fatture = _paper_fatture(act, day)
            cassetto = _cassetto_amount(act, day)
            for kind, amount in (
                ("contanti", cash),
                ("pos", card),
                ("nc", quote),
                ("fatture", fatture),
                ("cassetto", cassetto),
            ):
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
