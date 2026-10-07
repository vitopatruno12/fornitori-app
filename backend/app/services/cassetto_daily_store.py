"""Totali giornalieri movimento cassetto pushati dall'agent EasyRetail.

File: data/cassetto_daily.json
Chiave: (activity, day) → amount_uscita (euro usciti dal cassetto).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .paper_closing_overrides import activity_for_model_id

logger = logging.getLogger(__name__)


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
            "causali": list(row.get("causali") or [])[:12],
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
                "causali": list(slot.get("causali") or [])[:12],
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
        store[(act, day)] = {
            "amount_uscita": _dec(raw.get("amount_uscita")),
            "amount_net": _dec(raw.get("amount_net")),
            "count": int(raw.get("count") or 0),
            "causali": [str(x)[:40] for x in (raw.get("causali") or []) if str(x).strip()][:12],
        }
        saved += 1
    _save(store)
    return {"ok": True, "activity": act, "saved": saved}


def cassetto_amount(activity: str, day: date) -> Decimal:
    """Importo uscita cassetto per Prima Nota (0 se assente)."""
    slot = _load().get((activity_for_model_id(activity), day)) or {}
    return _dec(slot.get("amount_uscita"))


def cassetto_meta(activity: str, day: date) -> Dict[str, Any]:
    return dict(_load().get((activity_for_model_id(activity), day)) or {})
