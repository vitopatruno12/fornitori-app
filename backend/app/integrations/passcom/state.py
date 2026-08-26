"""Stato locale agent Passcom (hash già inviati)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Set


def default_state_path(base: Path | None = None) -> Path:
  if base is not None:
    return Path(base) / "passcom_agent_state.json"
  return Path(__file__).resolve().parents[2] / "uploads" / "passcom_agent_state.json"


def load_state(path: Path) -> Dict[str, Any]:
  if not path.is_file():
    return {"sent_hashes": [], "last_run_at": None, "last_ok": None, "last_message": ""}
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
      return {"sent_hashes": [], "last_run_at": None, "last_ok": None, "last_message": ""}
    hashes = data.get("sent_hashes") or []
    if not isinstance(hashes, list):
      hashes = []
    return {
      "sent_hashes": [str(h) for h in hashes if h],
      "last_run_at": data.get("last_run_at"),
      "last_ok": data.get("last_ok"),
      "last_message": data.get("last_message") or "",
    }
  except Exception:
    return {"sent_hashes": [], "last_run_at": None, "last_ok": None, "last_message": ""}


def save_state(path: Path, state: Dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  hashes = state.get("sent_hashes") or []
  # Cap growth: keep last 5000
  if isinstance(hashes, list) and len(hashes) > 5000:
    hashes = hashes[-5000:]
  payload = {
    "sent_hashes": hashes,
    "last_run_at": state.get("last_run_at"),
    "last_ok": state.get("last_ok"),
    "last_message": state.get("last_message") or "",
  }
  path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sent_hash_set(state: Dict[str, Any]) -> Set[str]:
  return {str(h) for h in (state.get("sent_hashes") or []) if h}


def mark_sent(state: Dict[str, Any], sha256: str) -> None:
  hashes = list(state.get("sent_hashes") or [])
  if sha256 not in hashes:
    hashes.append(sha256)
  state["sent_hashes"] = hashes


def touch_run(state: Dict[str, Any], *, ok: bool, message: str) -> None:
  state["last_run_at"] = datetime.now(timezone.utc).isoformat()
  state["last_ok"] = bool(ok)
  state["last_message"] = (message or "")[:2000]
