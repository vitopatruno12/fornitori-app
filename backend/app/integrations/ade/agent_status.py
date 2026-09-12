"""Stato agent AdE (progress UI Atlas + file locale)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def _uploads_root() -> Path:
  return Path(__file__).resolve().parents[2] / "uploads" / "ade"


def status_path() -> Path:
  raw = (os.getenv("ADE_AGENT_STATUS_PATH") or "").strip()
  if raw:
    return Path(raw)
  return _uploads_root() / "agent_status.json"


def _now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def default_status() -> Dict[str, Any]:
  return {
    "phase": "idle",
    "mode": "",
    "message": "",
    "profile_id": "",
    "progress": 0,
    "running": False,
    "ok": None,
    "error": "",
    "updated_at": _now_iso(),
    "finished_at": None,
  }


def read_status() -> Dict[str, Any]:
  path = status_path()
  if not path.is_file():
    return default_status()
  try:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
      return default_status()
    base = default_status()
    base.update(data)
    return base
  except Exception:
    return default_status()


def write_status(*, push_remote: bool = True, **fields: Any) -> Dict[str, Any]:
  path = status_path()
  path.parent.mkdir(parents=True, exist_ok=True)
  current = read_status()
  current.update({k: v for k, v in fields.items() if v is not None})
  current["updated_at"] = _now_iso()
  if fields.get("running") is False and not fields.get("finished_at"):
    current["finished_at"] = _now_iso()
  path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
  if push_remote:
    _push_remote(current)
  return current


def report(
  phase: str,
  message: str,
  *,
  mode: str = "",
  profile_id: str = "",
  progress: Optional[int] = None,
  running: bool = True,
  ok: Optional[bool] = None,
  error: str = "",
) -> Dict[str, Any]:
  payload: Dict[str, Any] = {
    "phase": phase,
    "message": message,
    "running": running,
    "error": error or "",
  }
  if mode:
    payload["mode"] = mode
  if profile_id:
    payload["profile_id"] = profile_id
  if progress is not None:
    payload["progress"] = max(0, min(100, int(progress)))
  if ok is not None:
    payload["ok"] = ok
  if not running:
    payload["finished_at"] = _now_iso()
  return write_status(**payload)


def _push_remote(status: Dict[str, Any]) -> None:
  """Opzionale: pubblica stato su Atlas (stesso PC o remoto)."""
  base = (os.getenv("ATLAS_API_BASE") or "").rstrip("/")
  if not base:
    return
  if os.getenv("ADE_STATUS_PUSH", "1").strip().lower() in ("0", "false", "no"):
    return
  url = f"{base}/ade/agent/status"
  headers = {
    "Content-Type": "application/json",
    "User-Agent": "atlas-ade-agent/1.0",
  }
  tok = (os.getenv("SDI_RECEIVE_TOKEN") or "").strip()
  if tok:
    headers["Authorization"] = f"Bearer {tok}"
  try:
    req = urllib.request.Request(
      url,
      data=json.dumps(status).encode("utf-8"),
      method="PUT",
      headers=headers,
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
      resp.read()
  except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
    pass
