"""Stato heartbeat agent EasyRetail (PC cassa → ATLAS)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

# Verde: agent ha contattato ATLAS di recente
_DEFAULT_OK_SEC = 15 * 60
# Giallo: ritardo / problemi comunicazione (oltre ok, sotto stale)
_DEFAULT_STALE_SEC = 45 * 60


def _heartbeat_path() -> Path:
    raw = (os.getenv("EASYRETAIL_AGENT_HEARTBEAT_PATH") or "").strip()
    if raw:
        return Path(raw)
    # backend/app/services → backend/data
    return Path(__file__).resolve().parents[2] / "data" / "easyretail_agent_heartbeat.json"


def _parse_iso(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def touch_agent_heartbeat(*, source: str = "ingest", meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Registra contatto riuscito dell'agent (o sync GDB server)."""
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "last_agent_at": now.isoformat(),
        "source": str(source or "ingest")[:64],
        "meta": meta or {},
    }
    path = _heartbeat_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return payload


def read_agent_heartbeat() -> Dict[str, Any]:
    path = _heartbeat_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _latest_receipt_created_at(db: Optional[Session]) -> Optional[datetime]:
    if db is None:
        return None
    try:
        from ..models.pos_receipt import PosReceipt

        value = db.query(func.max(PosReceipt.created_at)).scalar()
        return _parse_iso(value)
    except Exception:
        return None


def resolve_agent_light(*, age_sec: Optional[float], ok_sec: int, stale_sec: int) -> str:
    if age_sec is None:
        return "red"
    if age_sec <= ok_sec:
        return "green"
    if age_sec <= stale_sec:
        return "yellow"
    return "red"


def agent_cassa_status(db: Optional[Session] = None) -> Dict[str, Any]:
    """Semaforo agent cassa: green operativo, yellow comunicazione, red fermo."""
    ok_sec = max(60, int(os.getenv("EASYRETAIL_AGENT_OK_SEC", str(_DEFAULT_OK_SEC)) or _DEFAULT_OK_SEC))
    stale_sec = max(
        ok_sec + 60,
        int(os.getenv("EASYRETAIL_AGENT_STALE_SEC", str(_DEFAULT_STALE_SEC)) or _DEFAULT_STALE_SEC),
    )

    hb = read_agent_heartbeat()
    last_hb = _parse_iso(hb.get("last_agent_at"))
    last_receipt = _latest_receipt_created_at(db)

    # Contatto = heartbeat file, altrimenti fallback su ultimo scontrino inserito (agent vecchio).
    last_contact = last_hb or last_receipt
    contact_source = "heartbeat" if last_hb else ("receipt" if last_receipt else None)

    now = datetime.now(timezone.utc)
    age_sec: Optional[float] = None
    if last_contact is not None:
        age_sec = max(0.0, (now - last_contact).total_seconds())

    light = resolve_agent_light(age_sec=age_sec, ok_sec=ok_sec, stale_sec=stale_sec)
    labels = {
        "green": "Operativo — agent cassa attivo",
        "yellow": "In attesa / problemi di comunicazione cassa ↔ ATLAS",
        "red": "Fermo — agent non contatta ATLAS (PC cassa spento o agent fermo)",
    }

    return {
        "agent_light": light,
        "agent_label": labels[light],
        "last_agent_at": last_contact.isoformat() if last_contact else None,
        "last_heartbeat_at": last_hb.isoformat() if last_hb else None,
        "last_receipt_created_at": last_receipt.isoformat() if last_receipt else None,
        "contact_source": contact_source,
        "age_sec": int(age_sec) if age_sec is not None else None,
        "ok_sec": ok_sec,
        "stale_sec": stale_sec,
        "heartbeat_source": hb.get("source"),
    }
