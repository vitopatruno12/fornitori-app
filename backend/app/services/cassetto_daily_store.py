"""Totali giornalieri movimento cassetto pushati dall'agent EasyRetail.

File: data/cassetto_daily.json
Chiave: (activity, day) → amount_uscita (euro usciti dal cassetto).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .paper_closing_overrides import activity_for_model_id

logger = logging.getLogger(__name__)

# Uscite cassetto verificate su carta (lettura). Il file JSON può sovrascrivere.
_MAX_OPS = 80
_MAX_TEXT = 180
_SKIP_LABELS = {"seed-carta", "seed"}
_ROME = ZoneInfo("Europe/Rome")
_SEED_CASSETTO: Dict[Tuple[str, date], Decimal] = {
    ("via_zanardelli", date(2026, 10, 7)): Decimal("297.10"),
    ("via_lattea", date(2026, 10, 7)): Decimal("236.80"),
    ("via_zanardelli", date(2026, 10, 10)): Decimal("156.60"),
}


def _dec(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _data_dir() -> Path:
    raw = (os.getenv("CASSETTO_DAILY_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve().parent
    return Path(__file__).resolve().parents[2] / "data"


def cassetto_daily_path() -> Path:
    raw = (os.getenv("CASSETTO_DAILY_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return _data_dir() / "cassetto_daily.json"


def _load() -> Dict[Tuple[str, date], Dict[str, Any]]:
    path = cassetto_daily_path()
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("cassetto_daily.json illeggibile: %s", exc)
        return {}
    out: Dict[Tuple[str, date], Dict[str, Any]] = {}
    for row in payload.get("rows") or []:
        if not isinstance(row, dict):
            continue
        act = activity_for_model_id(row.get("activity") or row.get("model_id"))
        day_raw = str(row.get("day") or "")[:10]
        try:
            day = date.fromisoformat(day_raw)
        except ValueError:
            continue
        if not act:
            continue
        out[(act, day)] = {
            "amount_uscita": _dec(row.get("amount_uscita")),
            "amount_net": _dec(row.get("amount_net")),
            "count": int(row.get("count") or 0),
            "causali": list(row.get("causali") or [])[:20],
            "operazioni": _clean_ops(row.get("operazioni")),
        }
    return out


def _save(data: Dict[Tuple[str, date], Dict[str, Any]]) -> None:
    path = cassetto_daily_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for (act, day), slot in sorted(data.items(), key=lambda x: (x[0][1], x[0][0])):
        rows.append(
            {
                "activity": act,
                "day": day.isoformat(),
                "amount_uscita": str(slot.get("amount_uscita") or "0.00"),
                "amount_net": str(slot.get("amount_net") or "0.00"),
                "count": int(slot.get("count") or 0),
                "causali": list(slot.get("causali") or [])[:20],
                "operazioni": _clean_ops(slot.get("operazioni")),
            }
        )
    payload = {
        "version": 1,
        "note": "Movimenti cassetto EasyRetail (agent). Usati in Prima Nota come MOVIMENTO_CASSETTO.",
        "rows": rows,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def upsert_cassetto_days(
    *,
    model_id: Optional[str],
    activity: Optional[str] = None,
    days: List[Dict[str, Any]],
) -> Dict[str, Any]:
    act = (activity or "").strip() or activity_for_model_id(model_id)
    if not act:
        raise ValueError("model_id / activity obbligatorio")
    store = _load()
    saved = 0
    for raw in days or []:
        if not isinstance(raw, dict):
            continue
        day_raw = str(raw.get("day") or "")[:10]
        try:
            day = date.fromisoformat(day_raw)
        except ValueError:
            continue
        prev = store.get((act, day)) or {}
        if "operazioni" in raw:
            incoming_ops = _clean_ops(raw.get("operazioni"))
        else:
            incoming_ops = _clean_ops(prev.get("operazioni"))
        store[(act, day)] = {
            "amount_uscita": _dec(raw.get("amount_uscita")),
            "amount_net": _dec(raw.get("amount_net")),
            "count": int(raw.get("count") or 0),
            "causali": [str(x)[:80] for x in (raw.get("causali") or []) if str(x).strip()][:20],
            "operazioni": incoming_ops,
        }
        saved += 1
    _save(store)
    return {"ok": True, "activity": act, "saved": saved}


def cassetto_amount(activity: str, day: date) -> Decimal:
    """Importo uscita cassetto per Prima Nota (0 se assente)."""
    act = activity_for_model_id(activity)
    # Seed carta prevale (es. Zanardelli/Lattea 7 ott).
    if (act, day) in _SEED_CASSETTO:
        return _SEED_CASSETTO[(act, day)]
    slot = _load().get((act, day)) or {}
    return _dec(slot.get("amount_uscita"))


def cassetto_meta(activity: str, day: date) -> Dict[str, Any]:
    act = activity_for_model_id(activity)
    if (act, day) in _SEED_CASSETTO:
        amt = _SEED_CASSETTO[(act, day)]
        return {
            "amount_uscita": amt,
            "amount_net": -amt,
            "count": 0,
            "causali": ["seed-carta"],
        }
    slot = dict(_load().get((act, day)) or {})
    slot.setdefault("operazioni", [])
    return slot


def _clean_text(value: Any) -> str:
    text = " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())
    return text[:_MAX_TEXT]


def join_operation_parts(*parts: Any) -> str:
    """Unisce causale, nota e operatore tenendo il testo più lungo."""
    kept: List[str] = []
    for part in parts:
        text = _clean_text(part)
        if not text or text.casefold() in _SKIP_LABELS:
            continue
        low = text.casefold()
        absorbed = False
        for index, existing in enumerate(kept):
            other = existing.casefold()
            if low == other or low in other:
                absorbed = True
                break
            if other in low:
                kept[index] = text
                absorbed = True
                break
        if not absorbed:
            kept.append(text)
    return " · ".join(kept)[:_MAX_TEXT]


def _clean_op(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    testo = join_operation_parts(raw.get("testo"))
    if not testo:
        return None
    ora = str(raw.get("ora") or "").strip()[:5]
    verso = str(raw.get("verso") or "").strip().lower()
    if verso not in {"entrata", "uscita"}:
        verso = ""
    importo = None
    if raw.get("importo") not in (None, ""):
        importo = float(_dec(raw.get("importo")))
    return {"ora": ora, "verso": verso, "importo": importo, "testo": testo}


def _clean_ops(raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for item in raw or []:
        op = _clean_op(item)
        if not op:
            continue
        out.append(op)
        if len(out) >= _MAX_OPS:
            break
    return out


def display_operazioni(meta: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Righe da mostrare in Prima Nota. Se mancano i dettagli, usa le causali già salvate."""
    data = meta or {}
    ops = _clean_ops(data.get("operazioni"))
    if ops:
        return ops
    out: List[Dict[str, Any]] = []
    for label in data.get("causali") or []:
        testo = join_operation_parts(label)
        if not testo:
            continue
        out.append({"ora": "", "verso": "", "importo": None, "testo": testo})
        if len(out) >= 20:
            break
    return out


def cassetto_row_description(meta: Optional[Dict[str, Any]]) -> str:
    ops = display_operazioni(meta)
    if not ops:
        return "Movimenti cassetto (A)"
    return f"Movimenti cassetto · {len(ops)} operazioni (A)"[:255]


def cassetto_detail_lines(meta: Optional[Dict[str, Any]]) -> List[str]:
    lines: List[str] = []
    for op in display_operazioni(meta):
        bits: List[str] = []
        if op.get("ora"):
            bits.append(str(op["ora"]))
        if op.get("verso"):
            bits.append(str(op["verso"]))
        if op.get("importo") is not None:
            bits.append("€ " + f"{float(op['importo']):.2f}".replace(".", ","))
        bits.append(str(op["testo"]))
        lines.append(" · ".join(bits))
    return lines


def operazioni_for(activity: str, day: date) -> List[Dict[str, Any]]:
    return display_operazioni(cassetto_meta(activity, day))


def operazioni_for_entry(activity: Optional[str], when: Any) -> List[Dict[str, Any]]:
    if not activity or when is None:
        return []
    if isinstance(when, datetime):
        stamp = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
        day = stamp.astimezone(_ROME).date()
    elif isinstance(when, date):
        day = when
    else:
        try:
            day = date.fromisoformat(str(when)[:10])
        except ValueError:
            return []
    return operazioni_for(activity, day)
