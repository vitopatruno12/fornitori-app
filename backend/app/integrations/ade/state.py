"""Stato locale agent AdE (hash già inviati, per profilo)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Set


def default_state_path(base: Path | None = None) -> Path:
  if base is not None:
    return Path(base) / "ade_agent_state.json"
  return Path(__file__).resolve().parents[2] / "uploads" / "ade_agent_state.json"


def load_state(path: Path) -> Dict[str, Any]:
  if not path.is_file():
    return {"profiles": {}, "last_run_at": None, "last_ok": None, "last_message": ""}
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
      return {"profiles": {}, "last_run_at": None, "last_ok": None, "last_message": ""}
    profiles = data.get("profiles") or {}
    if not isinstance(profiles, dict):
      profiles = {}
    return {
      "profiles": profiles,
      "last_run_at": data.get("last_run_at"),
      "last_ok": data.get("last_ok"),
      "last_message": data.get("last_message") or "",
    }
  except Exception:
    return {"profiles": {}, "last_run_at": None, "last_ok": None, "last_message": ""}


def save_state(path: Path, state: Dict[str, Any]) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  profiles = state.get("profiles") or {}
  if isinstance(profiles, dict):
    for pid, pdata in list(profiles.items()):
      if not isinstance(pdata, dict):
        continue
      hashes = pdata.get("sent_hashes") or []
      if isinstance(hashes, list) and len(hashes) > 5000:
        pdata["sent_hashes"] = hashes[-5000:]
      profiles[pid] = pdata
  payload = {
    "profiles": profiles,
    "last_run_at": state.get("last_run_at"),
    "last_ok": state.get("last_ok"),
    "last_message": state.get("last_message") or "",
  }
  path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def profile_hashes(state: Dict[str, Any], profile_id: str) -> Set[str]:
  profiles = state.get("profiles") or {}
  pdata = profiles.get(profile_id) or {}
  if not isinstance(pdata, dict):
    return set()
  return {str(h) for h in (pdata.get("sent_hashes") or []) if h}


def mark_sent(state: Dict[str, Any], profile_id: str, sha256: str) -> None:
  profiles = state.setdefault("profiles", {})
  pdata = profiles.setdefault(profile_id, {"sent_hashes": []})
  hashes = list(pdata.get("sent_hashes") or [])
  if sha256 not in hashes:
    hashes.append(sha256)
  pdata["sent_hashes"] = hashes
  profiles[profile_id] = pdata


def touch_run(state: Dict[str, Any], *, ok: bool, message: str) -> None:
  state["last_run_at"] = datetime.now(timezone.utc).isoformat()
  state["last_ok"] = bool(ok)
  state["last_message"] = (message or "")[:2000]
