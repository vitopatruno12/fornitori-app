"""Letture chiusura (carta / operatore): prevalgono sul GDB per contanti e POS.

I preventivi non fiscali restano nei scontrini e in Prima Nota dopo le 21:30;
lo Storico Analisi usa solo contanti + POS.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

# Zanardelli 5 ott 2026: Bancomat ATLAS già 2312,35; contanti carta 1366,10 (GDB 803,90).
PAPER_CLOSING_OVERRIDES: Dict[Tuple[str, date], Dict[str, Decimal]] = {
    ("via_zanardelli", date(2026, 10, 5)): {
        "contanti": Decimal("1366.10"),
        "pos": Decimal("2312.35"),
    },
}

MODEL_ID_TO_ACTIVITY = {
    "model-1": "risacca",
    "model-2": "via_abba",
    "model-3": "via_lattea",
    "model-4": "via_zanardelli",
    "model-5": "pg",
}


def _dec(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def activity_for_model_id(model_id: Optional[str]) -> str:
    mid = str(model_id or "").strip()
    return MODEL_ID_TO_ACTIVITY.get(mid, mid)


def _activity_key(activity: str) -> str:
    raw = str(activity or "").strip()
    return MODEL_ID_TO_ACTIVITY.get(raw, raw)


def paper_amounts(
    activity: str,
    day: date,
    cash: Decimal,
    card: Decimal,
    quote: Decimal,
) -> Tuple[Decimal, Decimal, Decimal]:
    extra = PAPER_CLOSING_OVERRIDES.get((_activity_key(activity), day)) or {}
    return (
        _dec(extra["contanti"]) if "contanti" in extra else cash,
        _dec(extra["pos"]) if "pos" in extra else card,
        _dec(extra["nc"]) if "nc" in extra else quote,
    )


def apply_paper_closing_hit(activity: str, day: date, hit: Dict[str, Any]) -> Dict[str, Any]:
    extra = PAPER_CLOSING_OVERRIDES.get((_activity_key(activity), day))
    if not extra:
        return hit
    cash, card, quote = paper_amounts(
        activity,
        day,
        _dec(hit.get("cash_eur")),
        _dec(hit.get("card_eur")),
        _dec(hit.get("quote_eur")),
    )
    out = dict(hit)
    out["cash_eur"] = cash
    out["card_eur"] = card
    out["quote_eur"] = quote
    out["incasso"] = (cash + card).quantize(Decimal("0.01"))
    return out


def apply_paper_closing_daily(
    model_id: Optional[str],
    by_day: Dict[date, Dict[str, Any]],
) -> Dict[date, Dict[str, Any]]:
    activity = activity_for_model_id(model_id)
    if not by_day:
        return by_day
    return {day: apply_paper_closing_hit(activity, day, hit or {}) for day, hit in by_day.items()}
