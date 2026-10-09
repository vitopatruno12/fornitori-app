"""Lettura operatore (carta chiusura): fonte ufficiale per contanti e POS.

Priorità:
1. Letture salvate (file data/paper_closings.json) — inserite da Prima Nota / API
2. Seed noti (giorni già verificati a mano)
3. Fallback scontrini EasyRetail (GDB)

I preventivi / NC restano dagli scontrini e in Prima Nota dopo le 21:30.
Le fatture restano fuori da contanti/POS (campo fatture / invoice_eur).
Lo Storico Analisi usa solo contanti + POS (senza arancio).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Seed verificati su carta (lettura operatore). Il file JSON può sovrascriverli.
_SEED_PAPER_CLOSINGS: Dict[Tuple[str, date], Dict[str, Decimal]] = {
    # Zanardelli 5 ott 2026: contanti carta 1366,10 (GDB 803,90); POS ok.
    ("via_zanardelli", date(2026, 10, 5)): {
        "contanti": Decimal("1366.10"),
        "pos": Decimal("2312.35"),
    },
    # Zanardelli 6 ott 2026: lettura CONTANTI 1403,15 · BANCOMAT 2016,77
    # di cui FATTURE 143,99 → POS chiusura elettronico 1872,78 (senza fatture).
    ("via_zanardelli", date(2026, 10, 6)): {
        "contanti": Decimal("1403.15"),
        "pos": Decimal("1872.78"),
        "fatture": Decimal("143.99"),
    },
    # Abba 6 ott 2026: CONTANTI 2216,99 · CARTA 2816,81 · FATTURE 128,73
    # → POS = carta − fatture (niente doppio conteggio).
    ("via_abba", date(2026, 10, 6)): {
        "contanti": Decimal("2216.99"),
        "pos": Decimal("2688.08"),
        "fatture": Decimal("128.73"),
    },
    # Via Lattea 6 ott 2026 (lettura finanziaria): BANCOMAT 703,90 ok;
    # CONTANTI 1162,90 − CASSETTO 230,60 = IN CASSA 932,30 (usa IN CASSA).
    ("via_lattea", date(2026, 10, 6)): {
        "contanti": Decimal("932.30"),
        "pos": Decimal("703.90"),
        "fatture": Decimal("12.30"),
    },
    # Zanardelli 7 ott 2026 — chiusura fiscale CONTANTI 776,85 · ELETTRONICO 1702,62;
    # lettura FATTURE 80; preventivi GDB 640,15 → NC entrata.
    # (carta CONTANTI 1449,15 = 776,85 + 640,15 + quota fatture contanti)
    ("via_zanardelli", date(2026, 10, 7)): {
        "contanti": Decimal("776.85"),
        "pos": Decimal("1702.62"),
        "fatture": Decimal("80.00"),
        "nc": Decimal("640.15"),
    },
    # Abba 7 ott 2026 — LETTURA OPERATORE CONTANTI 1989,70 · CARTA 2674,61.
    ("via_abba", date(2026, 10, 7)): {
        "contanti": Decimal("1989.70"),
        "pos": Decimal("2674.61"),
        "fatture": Decimal("0.00"),
    },
    # Via Lattea 7 ott 2026 — IN CASSA 693,30 · BANCOMAT 603,00.
    ("via_lattea", date(2026, 10, 7)): {
        "contanti": Decimal("693.30"),
        "pos": Decimal("603.00"),
        "fatture": Decimal("0.00"),
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


def _data_dir() -> Path:
    raw = (os.getenv("PAPER_CLOSINGS_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve().parent
    return Path(__file__).resolve().parents[2] / "data"


def paper_closings_path() -> Path:
    raw = (os.getenv("PAPER_CLOSINGS_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _data_dir() / "paper_closings.json"


def _parse_day(value: Any) -> Optional[date]:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()[:10]
    if len(text) != 10:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _load_file_overrides() -> Dict[Tuple[str, date], Dict[str, Decimal]]:
    path = paper_closings_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("File letture operatore illeggibile: %s", path, exc_info=True)
        return {}
    rows = raw.get("rows") if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        return {}
    out: Dict[Tuple[str, date], Dict[str, Decimal]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        act = _activity_key(str(row.get("activity") or ""))
        day = _parse_day(row.get("day") or row.get("date"))
        if not act or day is None:
            continue
        slot: Dict[str, Decimal] = {}
        if row.get("contanti") is not None:
            slot["contanti"] = _dec(row.get("contanti"))
        if row.get("pos") is not None:
            slot["pos"] = _dec(row.get("pos"))
        if row.get("nc") is not None:
            slot["nc"] = _dec(row.get("nc"))
        if row.get("fatture") is not None:
            slot["fatture"] = _dec(row.get("fatture"))
        if slot:
            out[(act, day)] = slot
    return out


def all_paper_overrides() -> Dict[Tuple[str, date], Dict[str, Decimal]]:
    # Seed carta verificati prevalgono sul file (agent GDB non deve ribaltare il 7 ott…).
    merged = dict(_load_file_overrides())
    merged.update(_SEED_PAPER_CLOSINGS)
    return merged


def is_seed_paper_day(activity: str, day: date) -> bool:
    return (_activity_key(activity), day) in _SEED_PAPER_CLOSINGS


def get_paper_override(activity: str, day: date) -> Dict[str, Decimal]:
    return dict(all_paper_overrides().get((_activity_key(activity), day)) or {})


def has_paper_override(activity: str, day: date) -> bool:
    return bool(get_paper_override(activity, day))


def list_paper_closings(
    *,
    activity: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> List[Dict[str, Any]]:
    act_filter = _activity_key(activity) if activity else ""
    file_map = _load_file_overrides()
    rows: List[Dict[str, Any]] = []
    for (act, day), amounts in sorted(all_paper_overrides().items(), key=lambda x: (x[0][1], x[0][0])):
        if act_filter and act != act_filter:
            continue
        if date_from and day < date_from:
            continue
        if date_to and day > date_to:
            continue
        rows.append(
            {
                "activity": act,
                "day": day.isoformat(),
                "contanti": amounts.get("contanti"),
                "pos": amounts.get("pos"),
                "nc": amounts.get("nc"),
                "fatture": amounts.get("fatture"),
                "source": "seed" if (act, day) in _SEED_PAPER_CLOSINGS else "file",
            }
        )
    return rows


def upsert_paper_closing(
    activity: str,
    day: date,
    *,
    contanti: Optional[Any] = None,
    pos: Optional[Any] = None,
    nc: Optional[Any] = None,
    fatture: Optional[Any] = None,
) -> Dict[str, Any]:
    """Salva la lettura operatore (CONTANTI / BANCOMAT senza fatture / FATTURE)."""
    act = _activity_key(activity)
    if not act:
        raise ValueError("Attività non valida")
    path = paper_closings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    file_map = _load_file_overrides()
    slot = dict(file_map.get((act, day)) or {})
    if contanti is not None:
        slot["contanti"] = _dec(contanti)
    if pos is not None:
        slot["pos"] = _dec(pos)
    if nc is not None:
        slot["nc"] = _dec(nc)
    if fatture is not None:
        slot["fatture"] = _dec(fatture)
    if not slot:
        raise ValueError("Indica almeno contanti o POS della lettura")
    file_map[(act, day)] = slot
    payload = {
        "version": 1,
        "note": (
            "Letture operatore Prima Nota / Analisi. Prevalgono sul GDB per contanti e POS. "
            "Il POS è senza fatture; le fatture vanno nel campo fatture."
        ),
        "rows": [
            {
                "activity": a,
                "day": d.isoformat(),
                **{k: str(v) for k, v in am.items()},
            }
            for (a, d), am in sorted(file_map.items(), key=lambda x: (x[0][1], x[0][0]))
        ],
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return {
        "ok": True,
        "activity": act,
        "day": day.isoformat(),
        "contanti": slot.get("contanti"),
        "pos": slot.get("pos"),
        "nc": slot.get("nc"),
        "fatture": slot.get("fatture"),
    }


def paper_amounts(
    activity: str,
    day: date,
    cash: Decimal,
    card: Decimal,
    quote: Decimal,
) -> Tuple[Decimal, Decimal, Decimal]:
    extra = get_paper_override(activity, day)
    return (
        _dec(extra["contanti"]) if "contanti" in extra else cash,
        _dec(extra["pos"]) if "pos" in extra else card,
        _dec(extra["nc"]) if "nc" in extra else quote,
    )


def paper_fatture(activity: str, day: date) -> Decimal:
    """Importo FATTURE EMESSE della lettura. Resta fuori dal bancomat/POS."""
    extra = get_paper_override(activity, day)
    if "fatture" not in extra:
        return Decimal("0.00")
    return _dec(extra["fatture"])


def apply_paper_closing_hit(activity: str, day: date, hit: Dict[str, Any]) -> Dict[str, Any]:
    extra = get_paper_override(activity, day)
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
    if "fatture" in extra:
        out["invoice_eur"] = _dec(extra["fatture"])
    out["incasso"] = (cash + card).quantize(Decimal("0.01"))
    out["paper_closing"] = True
    return out


def apply_paper_closing_daily(
    model_id: Optional[str],
    by_day: Dict[date, Dict[str, Any]],
) -> Dict[date, Dict[str, Any]]:
    activity = activity_for_model_id(model_id)
    if not by_day:
        return by_day
    return {day: apply_paper_closing_hit(activity, day, hit or {}) for day, hit in by_day.items()}
